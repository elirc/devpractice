/// <reference lib="webworker" />
import {
  RUNNER_PROTOCOL_VERSION,
  runnerRequestSchema,
  type RunnerWorkerInbound,
  type RunnerWorkerOutbound,
} from '@devpractice/contracts';
import { executeRequest, type CancelToken } from './engine.js';
import { loadBrowserLibProvider } from './lib-browser.js';
import { utf8Length } from './compare.js';

/**
 * Dedicated Web Worker entry point.
 *
 * The Worker is an isolation convenience, not the security boundary: the
 * boundary is the QuickJS interpreter plus the fact that nothing capable is
 * exposed to it. This worker itself holds no session token, no API wrapper and
 * no credentialed fetch helper, so learner code has nothing to reach for.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Hard ceiling on an inbound message, independent of the request's own limits. */
const MAX_MESSAGE_BYTES = 1_048_576;

let quickJSModulePromise:
  | Promise<import('quickjs-emscripten-core').QuickJSWASMModule>
  | undefined;

/**
 * Loaded lazily so the interpreter and its .wasm are fetched only on first run.
 * Uses the Vite-resolved variant (see quickjs-browser.ts) rather than
 * getQuickJS(), whose default wasm location is not an emitted asset.
 */
function loadQuickJS(): Promise<import('quickjs-emscripten-core').QuickJSWASMModule> {
  if (!quickJSModulePromise) {
    quickJSModulePromise = import('./quickjs-browser.js').then((m) => m.loadBrowserQuickJS());
  }
  return quickJSModulePromise;
}

const cancelTokens = new Map<string, CancelToken>();

function post(message: RunnerWorkerOutbound): void {
  scope.postMessage(message);
}

scope.addEventListener('message', (event: MessageEvent<RunnerWorkerInbound>) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'cancel') {
    const token = cancelTokens.get(data.runId);
    if (token) token.cancelled = true;
    return;
  }

  if (data.type === 'dispose') {
    for (const token of cancelTokens.values()) token.cancelled = true;
    cancelTokens.clear();
    scope.close();
    return;
  }

  if (data.type !== 'run') return;

  void handleRun(data);
});

async function handleRun(message: Extract<RunnerWorkerInbound, { type: 'run' }>): Promise<void> {
  let raw: string;
  try {
    raw = JSON.stringify(message.request);
  } catch {
    return;
  }
  if (utf8Length(raw) > MAX_MESSAGE_BYTES) {
    post({
      type: 'result',
      response: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runId: String((message.request as { runId?: unknown }).runId ?? ''),
        status: 'unsupported',
        durationMs: 0,
        diagnostics: [],
        consoleOutput: [],
        consoleTruncated: false,
        caseResults: [],
        message: 'This exercise sent more data than the runner accepts.',
      },
    });
    return;
  }

  const parsed = runnerRequestSchema.safeParse(message.request);
  if (!parsed.success) {
    post({
      type: 'result',
      response: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runId: String((message.request as { runId?: unknown }).runId ?? ''),
        status: 'unsupported',
        durationMs: 0,
        diagnostics: [],
        consoleOutput: [],
        consoleTruncated: false,
        caseResults: [],
        message: 'This exercise could not be prepared for the runner.',
      },
    });
    return;
  }

  const request = parsed.data;
  const token: CancelToken = { cancelled: false };
  cancelTokens.set(request.runId, token);

  try {
    const response = await executeRequest(
      request,
      { loadQuickJS, loadLibProvider: loadBrowserLibProvider },
      token,
    );
    post({ type: 'result', response });
  } catch (error) {
    post({
      type: 'result',
      response: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runId: request.runId,
        status: 'runtime_error',
        durationMs: 0,
        diagnostics: [],
        consoleOutput: [],
        consoleTruncated: false,
        caseResults: [],
        message:
          error instanceof Error && /declarations are not bundled/.test(error.message)
            ? error.message
            : 'The exercise runtime stopped unexpectedly. Try running again.',
      },
    });
  } finally {
    cancelTokens.delete(request.runId);
  }
}

post({ type: 'ready' });
