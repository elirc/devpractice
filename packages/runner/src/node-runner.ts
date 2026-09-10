import { getQuickJS } from 'quickjs-emscripten';
import {
  DEFAULT_RUNNER_LIMITS,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCase,
  type RunnerResponse,
} from '@devpractice/contracts';
import { executeRequest, type CancelToken } from './engine.js';
import { createNodeLibProvider } from './lib-node.js';

/**
 * Node-side runner used by the content CLI and tests.
 *
 * It shares engine.ts and compare.ts with the browser worker, so an authored
 * solution is verified through exactly the same contract the learner meets —
 * including semantic TypeScript checking.
 */

export interface NodeRunInput {
  source: string;
  language: 'javascript' | 'typescript';
  entrypoint: string;
  cases: RunnerCase[];
  assertInputUnchanged?: boolean;
  exerciseId?: string;
  exerciseVersionId?: string;
  limits?: Partial<typeof DEFAULT_RUNNER_LIMITS>;
  runId?: string;
}

let libProvider: ReturnType<typeof createNodeLibProvider> | undefined;

function nextRunId(): string {
  // Node 22 has global crypto.
  return crypto.randomUUID();
}

export async function runInNode(
  input: NodeRunInput,
  cancel?: CancelToken,
): Promise<RunnerResponse> {
  const limits = { ...DEFAULT_RUNNER_LIMITS, ...input.limits };
  return executeRequest(
    {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runId: input.runId ?? nextRunId(),
      exerciseId: input.exerciseId ?? 'node-runner',
      exerciseVersionId: input.exerciseVersionId ?? '00000000-0000-0000-0000-000000000000',
      source: input.source,
      language: input.language,
      entrypoint: input.entrypoint,
      assertInputUnchanged: input.assertInputUnchanged ?? false,
      cases: input.cases,
      limits: {
        timeoutMs: limits.timeoutMs,
        maxSourceBytes: limits.maxSourceBytes,
        maxCases: limits.maxCases,
        maxInputBytes: limits.maxInputBytes,
        maxOutputBytes: limits.maxOutputBytes,
        maxConsoleLines: limits.maxConsoleLines,
        maxConsoleBytes: limits.maxConsoleBytes,
        memoryLimitBytes: limits.memoryLimitBytes,
        stackSizeBytes: limits.stackSizeBytes,
      },
    },
    {
      loadQuickJS: () => getQuickJS(),
      loadLibProvider: async () => {
        if (!libProvider) libProvider = createNodeLibProvider();
        return libProvider;
      },
    },
    cancel ?? { cancelled: false },
  );
}
