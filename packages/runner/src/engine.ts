// Types come from -core (the canonical source both hosts re-export), so the
// Node runner and the browser worker agree on one identity for these.
import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerCase,
  type RunnerCaseResult,
  type RunnerDiagnostic,
  type RunnerRequest,
  type RunnerResponse,
  type RunnerStatus,
} from '@devpractice/contracts';
import { ConsoleBuffer, deepCopyJson, evaluateCase, utf8Length } from './compare.js';
import { compileTypeScript, type LibProvider } from './ts-compile.js';

/**
 * Bounded execution engine (spec section 7).
 *
 * Learner source is evaluated ONLY by the QuickJS-WASM interpreter. It never
 * reaches host eval, new Function, dynamic import or the host realm. The
 * interpreter is given no DOM, no Node APIs, no filesystem, no sockets, no
 * fetch, no storage and no platform services — only bounded console capture and
 * an adapter that calls the named entrypoint with copied JSON values.
 *
 * Expected values and the comparison live in this host module, outside the
 * interpreter, so learner code cannot overwrite a result object.
 */

export interface EngineDeps {
  /** Loads the pinned QuickJS WASM module. Cached by the caller. */
  loadQuickJS: () => Promise<QuickJSWASMModule>;
  /** Supplies lib.d.ts text for TypeScript semantic diagnostics. */
  loadLibProvider: () => Promise<LibProvider>;
  now?: () => number;
}

/** Cooperative cancellation for the outer watchdog / Stop button. */
export interface CancelToken {
  cancelled: boolean;
}

const ENTRYPOINT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Captures pristine JSON and Function.apply BEFORE learner code runs, so an
 * accidental (or deliberate) override of JSON.stringify cannot corrupt the
 * host/interpreter boundary. This is robustness, not anti-cheat: per spec 7.1
 * browser results are client-reported and are never treated as proctored.
 */
const PRELUDE = `
(function () {
  var P = JSON.parse, S = JSON.stringify, A = Function.prototype.apply;
  Object.defineProperty(globalThis, '__dp_mk', {
    value: function (fn) {
      return function (argsJson) {
        var a = P(argsJson);
        var r = A.call(fn, null, a);
        return S({ v: r, a: a });
      };
    },
    writable: false, enumerable: false, configurable: false
  });
})();
`;

function buildHarness(entrypoint: string): string {
  return `
;(function () {
  if (typeof ${entrypoint} !== 'function') {
    throw new Error('Expected a function named "${entrypoint}" to be defined.');
  }
  globalThis.__dp_call = globalThis.__dp_mk(${entrypoint});
})();
`;
}

function response(
  request: RunnerRequest,
  status: RunnerStatus,
  startedAt: number,
  now: () => number,
  extra: Partial<RunnerResponse> = {},
): RunnerResponse {
  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runId: request.runId,
    status,
    durationMs: Math.round(now() - startedAt),
    diagnostics: [],
    consoleOutput: [],
    consoleTruncated: false,
    caseResults: [],
    ...extra,
  };
}

export async function executeRequest(
  request: RunnerRequest,
  deps: EngineDeps,
  cancel: CancelToken = { cancelled: false },
): Promise<RunnerResponse> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const { limits } = request;

  if (request.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
    return response(request, 'unsupported', startedAt, now, {
      message: 'This exercise needs a newer version of the app. Reload the page.',
    });
  }
  if (!ENTRYPOINT_PATTERN.test(request.entrypoint)) {
    return response(request, 'unsupported', startedAt, now, {
      message: 'This exercise has an invalid entrypoint name.',
    });
  }
  if (utf8Length(request.source) > limits.maxSourceBytes) {
    return response(request, 'unsupported', startedAt, now, {
      message: `Your code is larger than the ${Math.floor(limits.maxSourceBytes / 1024)} KiB limit for browser exercises.`,
    });
  }
  if (request.cases.length === 0 || request.cases.length > limits.maxCases) {
    return response(request, 'unsupported', startedAt, now, {
      message: 'This exercise has an unsupported number of test cases.',
    });
  }

  /* ---------------------- compile step (TypeScript) ---------------------- */

  let javascript = request.source;
  let diagnostics: RunnerDiagnostic[] = [];

  if (request.language === 'typescript') {
    const libs = await deps.loadLibProvider();
    if (cancel.cancelled) return response(request, 'cancelled', startedAt, now);
    const compiled = compileTypeScript(request.source, libs);
    diagnostics = compiled.diagnostics;
    if (compiled.unsupported) {
      return response(request, 'unsupported', startedAt, now, {
        message: compiled.unsupported,
        diagnostics,
      });
    }
    if (!compiled.ok || compiled.js === undefined) {
      // A type error can never reach the case runner (acceptance A08).
      return response(request, 'compile_error', startedAt, now, {
        diagnostics,
        message: 'TypeScript reported errors. Fix the types before running.',
      });
    }
    javascript = compiled.js;
  }

  /* ------------------------- interpreter execution ------------------------ */

  const quickjs = await deps.loadQuickJS();
  if (cancel.cancelled) return response(request, 'cancelled', startedAt, now);

  const consoleBuffer = new ConsoleBuffer(limits.maxConsoleLines, limits.maxConsoleBytes);

  let runtime: QuickJSRuntime | undefined;
  let context: QuickJSContext | undefined;

  // Hoisted so the catch below can tell an interrupt apart from a real fault:
  // quickjs-emscripten may either return an error result or throw, depending on
  // where the interrupt lands.
  let deadline = Number.POSITIVE_INFINITY;
  let interruptedByTimeout = false;

  try {
    runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(limits.memoryLimitBytes);
    runtime.setMaxStackSize(limits.stackSizeBytes);

    context = runtime.newContext();
    installConsole(context, consoleBuffer, limits.maxOutputBytes);

    // 1. Trusted prelude. Deliberately NOT interruptible: a slow WASM cold
    //    start must not spend the learner's execution budget.
    const preludeResult = context.evalCode(PRELUDE, 'prelude.js');
    if (preludeResult.error) {
      preludeResult.error.dispose();
      return response(request, 'runtime_error', startedAt, now, {
        message: 'The exercise runtime failed to start. Try again.',
        consoleOutput: consoleBuffer.output,
        consoleTruncated: consoleBuffer.truncated,
      });
    }
    preludeResult.value.dispose();

    // The learner's wall-clock budget starts here, once setup is complete.
    deadline = now() + limits.timeoutMs;
    runtime.setInterruptHandler(() => {
      if (cancel.cancelled) return true;
      if (now() > deadline) {
        interruptedByTimeout = true;
        return true;
      }
      return false;
    });

    // 2. Learner source plus the harness, in ONE evaluation so the harness can
    //    see const/let declarations, which never land on globalThis.
    const program = `${javascript}\n${buildHarness(request.entrypoint)}`;
    const loadResult = context.evalCode(program, 'main.js');
    if (loadResult.error) {
      const err = describeError(context, loadResult.error);
      loadResult.error.dispose();
      if (cancel.cancelled) return response(request, 'cancelled', startedAt, now);
      if (interruptedByTimeout) {
        return response(request, 'timed_out', startedAt, now, {
          message: `Your code ran longer than ${limits.timeoutMs} ms. Look for a loop that never ends.`,
          consoleOutput: consoleBuffer.output,
          consoleTruncated: consoleBuffer.truncated,
        });
      }
      // A parse failure surfaces as a compile error for both languages.
      const status: RunnerStatus = err.isSyntaxError ? 'compile_error' : 'runtime_error';
      return response(request, status, startedAt, now, {
        message: err.message,
        diagnostics,
        consoleOutput: consoleBuffer.output,
        consoleTruncated: consoleBuffer.truncated,
      });
    }
    loadResult.value.dispose();

    /* ------------------------------ run cases ----------------------------- */

    const caseResults: RunnerCaseResult[] = [];
    const callHandle = context.getProp(context.global, '__dp_call');

    try {
      for (const testCase of request.cases) {
        if (cancel.cancelled) {
          callHandle.dispose();
          return response(request, 'cancelled', startedAt, now);
        }
        const outcome = runSingleCase(
          context,
          callHandle,
          testCase,
          request.assertInputUnchanged,
          limits,
          now,
        );
        if (outcome.kind === 'timeout' || interruptedByTimeout) {
          callHandle.dispose();
          return response(request, 'timed_out', startedAt, now, {
            message: `Your code ran longer than ${limits.timeoutMs} ms. Look for a loop that never ends.`,
            consoleOutput: consoleBuffer.output,
            consoleTruncated: consoleBuffer.truncated,
            caseResults,
          });
        }
        if (outcome.kind === 'oversized') {
          callHandle.dispose();
          return response(request, 'runtime_error', startedAt, now, {
            message: `A result was larger than the ${Math.floor(limits.maxOutputBytes / 1024)} KiB output limit.`,
            consoleOutput: consoleBuffer.output,
            consoleTruncated: consoleBuffer.truncated,
            caseResults,
          });
        }
        caseResults.push(outcome.result);
      }
    } finally {
      callHandle.dispose();
    }

    const allPassed = caseResults.every((c) => c.passed);
    return response(request, allPassed ? 'passed' : 'failed', startedAt, now, {
      diagnostics,
      consoleOutput: consoleBuffer.output,
      consoleTruncated: consoleBuffer.truncated,
      caseResults,
    });
  } catch (error) {
    // An interrupt can surface as a thrown host error rather than an error
    // result, so classify cancellation and the time limit before anything else.
    if (cancel.cancelled) return response(request, 'cancelled', startedAt, now);

    const message = error instanceof Error ? error.message : String(error);
    if (interruptedByTimeout || now() > deadline || /interrupt/i.test(message)) {
      return response(request, 'timed_out', startedAt, now, {
        message: `Your code ran longer than ${limits.timeoutMs} ms. Look for a loop that never ends.`,
        consoleOutput: consoleBuffer.output,
        consoleTruncated: consoleBuffer.truncated,
      });
    }
    // Out-of-memory and internal interpreter faults land here.
    return response(request, 'runtime_error', startedAt, now, {
      message: normaliseHostError(message, limits.memoryLimitBytes),
      consoleOutput: consoleBuffer.output,
      consoleTruncated: consoleBuffer.truncated,
    });
  } finally {
    // Fresh runtime per run: always disposed, even on failure.
    try {
      context?.dispose();
    } catch {
      /* already disposed */
    }
    try {
      runtime?.dispose();
    } catch {
      /* already disposed */
    }
  }
}

type CaseOutcome =
  | { kind: 'result'; result: RunnerCaseResult }
  | { kind: 'timeout' }
  | { kind: 'oversized' };

function runSingleCase(
  context: QuickJSContext,
  callHandle: QuickJSHandle,
  testCase: RunnerCase,
  assertInputUnchanged: boolean,
  limits: RunnerRequest['limits'],
  now: () => number,
): CaseOutcome {
  const caseStart = now();

  // Each case gets an independent copy of its inputs.
  const argsCopy = deepCopyJson(testCase.args);
  let argsJson: string;
  try {
    argsJson = JSON.stringify(argsCopy);
  } catch {
    return {
      kind: 'result',
      result: {
        caseId: testCase.id,
        passed: false,
        hidden: testCase.hidden,
        error: 'This case has inputs that cannot be sent to the runner.',
        durationMs: 0,
      },
    };
  }
  if (utf8Length(argsJson) > limits.maxInputBytes) {
    return { kind: 'oversized' };
  }

  const argHandle = context.newString(argsJson);
  try {
    const callResult = context.callFunction(callHandle, context.undefined, argHandle);

    if (callResult.error) {
      const err = describeError(context, callResult.error);
      callResult.error.dispose();
      if (err.isInterrupt) return { kind: 'timeout' };
      return {
        kind: 'result',
        result: evaluateCase({
          testCase,
          actual: undefined,
          assertInputUnchanged,
          durationMs: Math.round(now() - caseStart),
          error: err.message,
          maxOutputBytes: limits.maxOutputBytes,
        }),
      };
    }

    let payloadJson: string;
    try {
      payloadJson = context.getString(callResult.value);
    } finally {
      callResult.value.dispose();
    }

    if (utf8Length(payloadJson) > limits.maxOutputBytes) {
      return { kind: 'oversized' };
    }

    let parsed: { v?: unknown; a?: unknown[] };
    try {
      parsed = JSON.parse(payloadJson) as { v?: unknown; a?: unknown[] };
    } catch {
      return {
        kind: 'result',
        result: evaluateCase({
          testCase,
          actual: undefined,
          assertInputUnchanged,
          durationMs: Math.round(now() - caseStart),
          error: 'The returned value could not be represented as JSON.',
          maxOutputBytes: limits.maxOutputBytes,
        }),
      };
    }

    return {
      kind: 'result',
      result: evaluateCase({
        testCase,
        actual: parsed.v,
        argsAfter: parsed.a,
        assertInputUnchanged,
        durationMs: Math.round(now() - caseStart),
        maxOutputBytes: limits.maxOutputBytes,
      }),
    };
  } finally {
    argHandle.dispose();
  }
}

interface DescribedError {
  message: string;
  isSyntaxError: boolean;
  isInterrupt: boolean;
}

function describeError(context: QuickJSContext, handle: QuickJSHandle): DescribedError {
  let dumped: unknown;
  try {
    dumped = context.dump(handle);
  } catch {
    dumped = undefined;
  }
  if (dumped && typeof dumped === 'object') {
    const record = dumped as { name?: unknown; message?: unknown };
    const name = typeof record.name === 'string' ? record.name : 'Error';
    const message = typeof record.message === 'string' ? record.message : '';
    const text = message ? `${name}: ${message}` : name;
    return {
      message: text,
      isSyntaxError: name === 'SyntaxError',
      isInterrupt: /interrupted/i.test(text),
    };
  }
  const text = typeof dumped === 'string' ? dumped : 'The code threw a value that is not an Error.';
  return {
    message: text,
    isSyntaxError: /SyntaxError/i.test(text),
    isInterrupt: /interrupted/i.test(text),
  };
}

function normaliseHostError(message: string, memoryLimitBytes: number): string {
  if (/out of memory|allocation failed|memory/i.test(message)) {
    return `Your code used more than the ${Math.floor(memoryLimitBytes / (1024 * 1024))} MB memory limit for browser exercises.`;
  }
  if (/stack overflow|maximum call stack/i.test(message)) {
    return 'Your code recursed too deeply. Check the base case.';
  }
  return 'The exercise runtime stopped unexpectedly. Try running again.';
}

/**
 * The ONLY host capability granted to the interpreter. There is deliberately no
 * fetch, no timers, no storage, no process and no module loader.
 */
function installConsole(
  context: QuickJSContext,
  buffer: ConsoleBuffer,
  maxOutputBytes: number,
): void {
  const consoleObj = context.newObject();
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const fn = context.newFunction(level, (...args: QuickJSHandle[]) => {
      const parts = args.map((handle) => formatHandle(context, handle, maxOutputBytes));
      buffer.push(parts.join(' '));
      return context.undefined;
    });
    context.setProp(consoleObj, level, fn);
    fn.dispose();
  }
  context.setProp(context.global, 'console', consoleObj);
  consoleObj.dispose();
}

function formatHandle(context: QuickJSContext, handle: QuickJSHandle, maxBytes: number): string {
  let value: unknown;
  try {
    value = context.dump(handle);
  } catch {
    return '[unprintable value]';
  }
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value) ?? String(value);
    return utf8Length(text) > maxBytes ? `${text.slice(0, maxBytes)}…` : text;
  } catch {
    return '[circular value]';
  }
}
