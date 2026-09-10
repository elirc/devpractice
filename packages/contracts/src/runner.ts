import { z } from 'zod';

/**
 * Bounded browser execution protocol (spec section 7).
 *
 * Learner source NEVER reaches host eval / new Function / dynamic import.
 * It is passed to a QuickJS-WASM interpreter inside a dedicated Web Worker.
 * The Worker is an isolation convenience; the interpreter plus the absence of
 * exposed host capabilities is the actual boundary.
 */

export const RUNNER_PROTOCOL_VERSION = 1;

export const DEFAULT_RUNNER_LIMITS = {
  /** Per-run execution budget once the runtime is initialised. */
  timeoutMs: 2000,
  /** Separate budget for first-time WASM + compiler initialisation. */
  initTimeoutMs: 10_000,
  maxSourceBytes: 65_536,
  maxCases: 25,
  maxInputBytes: 65_536,
  maxOutputBytes: 65_536,
  maxConsoleLines: 100,
  maxConsoleBytes: 16_384,
  /** QuickJS runtime memory ceiling; verify on the pinned build. */
  memoryLimitBytes: 32 * 1024 * 1024,
  stackSizeBytes: 512 * 1024,
} as const;

export type RunnerLimits = typeof DEFAULT_RUNNER_LIMITS;

export const runnerCaseSchema = z.object({
  id: z.string(),
  args: z.array(z.unknown()),
  expected: z.unknown(),
  tolerance: z.number().positive().optional(),
  hidden: z.boolean().default(false),
});
export type RunnerCase = z.infer<typeof runnerCaseSchema>;

export const runnerRequestSchema = z.object({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  runId: z.string().uuid(),
  exerciseId: z.string(),
  exerciseVersionId: z.string(),
  source: z.string(),
  language: z.enum(['javascript', 'typescript']),
  entrypoint: z.string(),
  assertInputUnchanged: z.boolean().default(false),
  /** Trusted, pinned case data supplied by the app's runner adapter. */
  cases: z.array(runnerCaseSchema),
  limits: z.object({
    timeoutMs: z.number().int().positive(),
    maxSourceBytes: z.number().int().positive(),
    maxCases: z.number().int().positive(),
    maxInputBytes: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxConsoleLines: z.number().int().positive(),
    maxConsoleBytes: z.number().int().positive(),
    memoryLimitBytes: z.number().int().positive(),
    stackSizeBytes: z.number().int().positive(),
  }),
});
export type RunnerRequest = z.infer<typeof runnerRequestSchema>;

export type RunnerStatus =
  | 'passed'
  | 'failed'
  | 'compile_error'
  | 'runtime_error'
  | 'timed_out'
  | 'cancelled'
  | 'unsupported';

export interface RunnerDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
  column?: number;
}

export interface RunnerCaseResult {
  caseId: string;
  passed: boolean;
  hidden: boolean;
  /** Omitted for hidden cases so the learner reasons rather than pattern-matches. */
  expectedJson?: string;
  actualJson?: string;
  error?: string;
  inputMutated?: boolean;
  durationMs: number;
}

export interface RunnerResponse {
  protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  runId: string;
  status: RunnerStatus;
  durationMs: number;
  diagnostics: RunnerDiagnostic[];
  consoleOutput: string[];
  consoleTruncated: boolean;
  caseResults: RunnerCaseResult[];
  /** Present for compile_error / runtime_error / timed_out. */
  message?: string;
}

export type RunnerWorkerInbound =
  | { type: 'run'; request: RunnerRequest }
  | { type: 'cancel'; runId: string }
  | { type: 'dispose' };

export type RunnerWorkerOutbound =
  | { type: 'ready' }
  | { type: 'result'; response: RunnerResponse }
  | { type: 'init-error'; message: string };

/** Structural JSON equality: array order matters, object key order does not. */
export function jsonEqual(a: unknown, b: unknown, tolerance?: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (tolerance !== undefined) return Math.abs(a - b) <= tolerance;
    return Object.is(a, b) || a === b;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    return arrA.every((v, i) => jsonEqual(v, arrB[i], tolerance));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA).sort();
  const keysB = Object.keys(objB).sort();
  if (keysA.length !== keysB.length) return false;
  if (!keysA.every((k, i) => k === keysB[i])) return false;
  return keysA.every((k) => jsonEqual(objA[k], objB[k], tolerance));
}
