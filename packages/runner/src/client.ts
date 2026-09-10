import {
  DEFAULT_RUNNER_LIMITS,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCase,
  type RunnerRequest,
  type RunnerResponse,
  type RunnerWorkerOutbound,
} from '@devpractice/contracts';

/**
 * Main-thread controller for the runner worker (spec 7.3).
 *
 * Responses are accepted ONLY from the currently active worker and only for a
 * matching runId, so a cancelled or superseded run can never overwrite the
 * result on screen.
 */

export type RunnerPhase = 'idle' | 'initialising' | 'running';

export interface RunnerClientOptions {
  /** Creates the dedicated worker. Injected so tests can supply a fake. */
  createWorker: () => Worker;
  limits?: typeof DEFAULT_RUNNER_LIMITS;
  onPhaseChange?: (phase: RunnerPhase) => void;
  now?: () => number;
}

export interface RunInput {
  runId: string;
  exerciseId: string;
  exerciseVersionId: string;
  source: string;
  language: 'javascript' | 'typescript';
  entrypoint: string;
  assertInputUnchanged: boolean;
  cases: RunnerCase[];
}

interface PendingRun {
  runId: string;
  resolve: (response: RunnerResponse) => void;
  watchdog: ReturnType<typeof setTimeout>;
}

export class RunnerClient {
  private worker: Worker | undefined;
  private pending: PendingRun | undefined;
  private ready = false;
  private readyWaiters: (() => void)[] = [];
  private initTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly limits: typeof DEFAULT_RUNNER_LIMITS;

  constructor(private readonly options: RunnerClientOptions) {
    this.limits = options.limits ?? DEFAULT_RUNNER_LIMITS;
  }

  private setPhase(phase: RunnerPhase): void {
    this.options.onPhaseChange?.(phase);
  }

  /** Spawns the worker on first use so the WASM payload stays lazy. */
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.setPhase('initialising');
    const worker = this.options.createWorker();
    this.worker = worker;
    this.ready = false;

    worker.addEventListener('message', (event: MessageEvent<RunnerWorkerOutbound>) => {
      // Ignore anything from a worker we have already replaced.
      if (this.worker !== worker) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ready') {
        this.ready = true;
        if (this.initTimer) clearTimeout(this.initTimer);
        this.readyWaiters.splice(0).forEach((fn) => fn());
        return;
      }
      if (data.type === 'init-error') {
        this.failPending('runtime_error', data.message);
        return;
      }
      if (data.type === 'result') {
        // Stale or superseded response: drop it.
        if (!this.pending || data.response.runId !== this.pending.runId) return;
        if (data.response.protocolVersion !== RUNNER_PROTOCOL_VERSION) return;
        this.settle(data.response);
      }
    });

    worker.addEventListener('error', () => {
      this.failPending('runtime_error', 'The exercise runtime stopped unexpectedly.');
      this.terminate();
    });

    return worker;
  }

  private settle(response: RunnerResponse): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.watchdog);
    this.pending = undefined;
    this.setPhase('idle');

    // A fault can leave the WASM instance in an aborted state — QuickJS raises
    // a JS_FreeRuntime assertion after a stack overflow, which poisons the
    // cached module for every later run in that worker. Drop the worker so the
    // next run gets a genuinely clean interpreter.
    if (response.status === 'runtime_error' || response.status === 'timed_out') {
      this.terminate();
    }

    pending.resolve(response);
  }

  private failPending(status: RunnerResponse['status'], message: string): void {
    if (!this.pending) return;
    this.settle({
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runId: this.pending.runId,
      status,
      durationMs: 0,
      diagnostics: [],
      consoleOutput: [],
      consoleTruncated: false,
      caseResults: [],
      message,
    });
  }

  private waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.readyWaiters.push(resolve);
      this.initTimer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((fn) => fn !== resolve);
        reject(new Error('init-timeout'));
      }, this.limits.initTimeoutMs);
    });
  }

  async run(input: RunInput): Promise<RunnerResponse> {
    // A new run supersedes any run still in flight.
    if (this.pending) this.cancel();

    const worker = this.ensureWorker();

    try {
      await this.waitForReady();
    } catch {
      this.terminate();
      return {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runId: input.runId,
        status: 'timed_out',
        durationMs: this.limits.initTimeoutMs,
        diagnostics: [],
        consoleOutput: [],
        consoleTruncated: false,
        caseResults: [],
        message: 'The code runner took too long to start. Check your connection and try again.',
      };
    }

    this.setPhase('running');

    const request: RunnerRequest = {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runId: input.runId,
      exerciseId: input.exerciseId,
      exerciseVersionId: input.exerciseVersionId,
      source: input.source,
      language: input.language,
      entrypoint: input.entrypoint,
      assertInputUnchanged: input.assertInputUnchanged,
      cases: input.cases,
      limits: {
        timeoutMs: this.limits.timeoutMs,
        maxSourceBytes: this.limits.maxSourceBytes,
        maxCases: this.limits.maxCases,
        maxInputBytes: this.limits.maxInputBytes,
        maxOutputBytes: this.limits.maxOutputBytes,
        maxConsoleLines: this.limits.maxConsoleLines,
        maxConsoleBytes: this.limits.maxConsoleBytes,
        memoryLimitBytes: this.limits.memoryLimitBytes,
        stackSizeBytes: this.limits.stackSizeBytes,
      },
    };

    return new Promise<RunnerResponse>((resolve) => {
      // Outer watchdog: if the interpreter's own interrupt handler cannot stop
      // the run, terminate the worker outright.
      const watchdog = setTimeout(() => {
        this.terminate();
        const pending = this.pending;
        this.pending = undefined;
        this.setPhase('idle');
        pending?.resolve({
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          runId: input.runId,
          status: 'timed_out',
          durationMs: this.limits.timeoutMs * 2,
          diagnostics: [],
          consoleOutput: [],
          consoleTruncated: false,
          caseResults: [],
          message: 'Your code did not finish. The runner was stopped.',
        });
      }, this.limits.timeoutMs * 2 + 1000);

      this.pending = { runId: input.runId, resolve, watchdog };
      worker.postMessage({ type: 'run', request });
    });
  }

  /** Stop: terminates the worker and resolves the run as cancelled. */
  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.terminate();
    this.pending = undefined;
    this.setPhase('idle');
    clearTimeout(pending.watchdog);
    pending.resolve({
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runId: pending.runId,
      status: 'cancelled',
      durationMs: 0,
      diagnostics: [],
      consoleOutput: [],
      consoleTruncated: false,
      caseResults: [],
    });
  }

  /** Drops the worker; the next run starts a clean runtime. */
  terminate(): void {
    if (this.initTimer) clearTimeout(this.initTimer);
    this.readyWaiters = [];
    this.ready = false;
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
  }

  dispose(): void {
    this.cancel();
    this.terminate();
  }
}
