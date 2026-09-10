import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RUNNER_LIMITS,
  jsonEqual,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCase,
  type RunnerCaseResult,
  type RunnerRequest,
  type RunnerResponse,
} from '@devpractice/contracts';

/**
 * Build-time solution verifier.
 *
 * The CLI speaks the SAME protocol as the browser runner (RunnerRequest ->
 * RunnerResponse from @devpractice/contracts) so an exercise that passes here
 * is graded by identical comparison rules in the browser.
 *
 * Backends, in preference order:
 *   1. @devpractice/runner/node — the QuickJS-WASM runner, identical engine to
 *      the browser. Used whenever the package is available.
 *   2. node:vm fallback — build-time only. `vm` is NOT a security boundary and
 *      is never used for learner code; it only executes content the author
 *      already controls, inside the release pipeline. It shares the SAME
 *      comparison logic (jsonEqual) so verdicts match.
 */

export interface SolutionRunner {
  readonly name: string;
  run(request: RunnerRequest): Promise<RunnerResponse>;
  dispose(): Promise<void>;
}

export function buildRequest(
  source: string,
  language: 'javascript' | 'typescript',
  entrypoint: string,
  cases: RunnerCase[],
  assertInputUnchanged: boolean,
): RunnerRequest {
  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runId: randomUUID(),
    exerciseId: 'content-tools-verify',
    exerciseVersionId: '00000000-0000-4000-8000-000000000000',
    source,
    language,
    entrypoint,
    assertInputUnchanged,
    cases,
    limits: { ...DEFAULT_RUNNER_LIMITS },
  };
}

/* -------------------------- node:vm fallback ----------------------------- */

interface CompiledTs {
  js: string;
  diagnostics: { message: string; line?: number }[];
}

/** Compile TS with FULL semantic diagnostics; a type error must never pass. */
async function compileTypeScript(source: string): Promise<CompiledTs | null> {
  let ts: typeof import('typescript');
  try {
    ts = (await import('typescript')).default ?? (await import('typescript'));
  } catch {
    return null; // typescript unavailable -> caller reports skipped, not passed
  }
  const fileName = 'exercise.ts';
  const options: import('typescript').CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    noEmitOnError: false,
    lib: ['lib.es2022.d.ts'],
  };
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const defaultHost = ts.createCompilerHost(options, true);
  const host: import('typescript').CompilerHost = {
    ...defaultHost,
    getSourceFile: (name, languageVersion, onError, shouldCreate) =>
      name === fileName
        ? sourceFile
        : defaultHost.getSourceFile(name, languageVersion, onError, shouldCreate),
    writeFile: () => undefined,
    fileExists: (name) => name === fileName || defaultHost.fileExists(name),
    readFile: (name) => (name === fileName ? source : defaultHost.readFile(name)),
  };
  const program = ts.createProgram([fileName], options, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];
  if (diagnostics.length > 0) {
    return {
      js: '',
      diagnostics: diagnostics.map((d) => ({
        message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
        line:
          d.file && d.start !== undefined
            ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
            : undefined,
      })),
    };
  }
  const out = ts.transpileModule(source, { compilerOptions: options });
  return { js: out.outputText, diagnostics: [] };
}

class VmRunner implements SolutionRunner {
  readonly name = 'node:vm (build-time fallback)';

  async run(request: RunnerRequest): Promise<RunnerResponse> {
    const started = Date.now();
    const consoleOutput: string[] = [];
    const base: Omit<RunnerResponse, 'status'> = {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runId: request.runId,
      durationMs: 0,
      diagnostics: [],
      consoleOutput,
      consoleTruncated: false,
      caseResults: [],
    };

    if (Buffer.byteLength(request.source, 'utf8') > request.limits.maxSourceBytes) {
      return { ...base, status: 'unsupported', message: 'source exceeds size limit' };
    }

    let js = request.source;
    if (request.language === 'typescript') {
      const compiled = await compileTypeScript(request.source);
      if (compiled === null) {
        return {
          ...base,
          status: 'unsupported',
          message: 'typescript compiler unavailable in this backend',
        };
      }
      if (compiled.diagnostics.length > 0) {
        return {
          ...base,
          status: 'compile_error',
          durationMs: Date.now() - started,
          diagnostics: compiled.diagnostics.map((d) => ({
            severity: 'error' as const,
            message: d.message,
            ...(d.line !== undefined ? { line: d.line } : {}),
          })),
          message: compiled.diagnostics[0]?.message ?? 'type error',
        };
      }
      js = compiled.js;
    }

    // Minimal sandbox surface: no require, no process, no fetch, no timers.
    const sandbox: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => {
          if (consoleOutput.length < request.limits.maxConsoleLines) {
            consoleOutput.push(args.map((a) => safeToString(a)).join(' '));
          }
        },
      },
    };
    const context = createContext(sandbox, { name: 'content-verify' });

    let entry: unknown;
    try {
      runInContext(`${js}\n;globalThis.__entry = ${request.entrypoint};`, context, {
        timeout: request.limits.timeoutMs,
      });
      entry = (context as Record<string, unknown>).__entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /script execution timed out/i.test(message);
      return {
        ...base,
        status: timedOut ? 'timed_out' : 'compile_error',
        durationMs: Date.now() - started,
        message,
      };
    }

    if (typeof entry !== 'function') {
      return {
        ...base,
        status: 'runtime_error',
        durationMs: Date.now() - started,
        message: `entrypoint '${request.entrypoint}' is not a function`,
      };
    }

    const caseResults: RunnerCaseResult[] = [];
    for (const testCase of request.cases) {
      const caseStarted = Date.now();
      // Each case gets an independent deep copy so mutation cannot leak across
      // cases and so post-call comparison detects input mutation.
      const args = structuredClone(testCase.args);
      const argsBefore = structuredClone(testCase.args);
      try {
        const actual = (entry as (...a: unknown[]) => unknown)(...args);
        const matched = jsonEqual(actual, testCase.expected, testCase.tolerance);
        const mutated = request.assertInputUnchanged && !jsonEqual(args, argsBefore);
        caseResults.push({
          caseId: testCase.id,
          passed: matched && !mutated,
          hidden: testCase.hidden,
          expectedJson: JSON.stringify(testCase.expected),
          actualJson: safeStringify(actual),
          ...(mutated ? { inputMutated: true } : {}),
          durationMs: Date.now() - caseStarted,
        });
      } catch (error) {
        caseResults.push({
          caseId: testCase.id,
          passed: false,
          hidden: testCase.hidden,
          expectedJson: JSON.stringify(testCase.expected),
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - caseStarted,
        });
      }
    }

    return {
      ...base,
      status: caseResults.every((c) => c.passed) ? 'passed' : 'failed',
      durationMs: Date.now() - started,
      caseResults,
    };
  }

  async dispose(): Promise<void> {
    /* nothing to release */
  }
}

function safeToString(value: unknown): string {
  if (typeof value === 'string') return value;
  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Resolve the best available backend. Prefers the shared QuickJS runner so the
 * CLI and the browser execute learner-facing code identically.
 */
export async function resolveRunner(preferFallback = false): Promise<SolutionRunner> {
  if (!preferFallback) {
    try {
      const mod: unknown = await import('@devpractice/runner/node');
      const factory = (mod as { createNodeRunner?: () => SolutionRunner }).createNodeRunner;
      if (typeof factory === 'function') return factory();

      // The runner package exports a plain function rather than a factory.
      // Adapt it, so the CLI verifies authored solutions on the SAME QuickJS
      // engine the learner meets instead of silently dropping to node:vm.
      const runInNode = (
        mod as {
          runInNode?: (input: NodeRunInput) => Promise<RunnerResponse>;
        }
      ).runInNode;
      if (typeof runInNode === 'function') {
        return {
          name: 'quickjs (@devpractice/runner)',
          async run(request: RunnerRequest): Promise<RunnerResponse> {
            return runInNode({
              source: request.source,
              language: request.language,
              entrypoint: request.entrypoint,
              cases: request.cases,
              assertInputUnchanged: request.assertInputUnchanged,
              exerciseId: request.exerciseId,
              exerciseVersionId: request.exerciseVersionId,
              runId: request.runId,
            });
          },
          async dispose(): Promise<void> {
            /* the node runner owns its own module lifetime */
          },
        };
      }
      throw new Error(
        `@devpractice/runner/node exports neither createNodeRunner nor runInNode (saw: ${Object.keys(
          mod as object,
        ).join(', ')})`,
      );
    } catch (error) {
      // Never fail silently: a hidden fallback means the gate is not testing
      // the engine we claim it tests.
      process.emitWarning(
        `content-tools: falling back to node:vm because the QuickJS runner could not be loaded — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return new VmRunner();
}

interface NodeRunInput {
  source: string;
  language: 'javascript' | 'typescript';
  entrypoint: string;
  cases: RunnerCase[];
  assertInputUnchanged?: boolean;
  exerciseId?: string;
  exerciseVersionId?: string;
  runId?: string;
}
