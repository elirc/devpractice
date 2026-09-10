import { describe, expect, it, vi } from 'vitest';
import { RunnerClient } from '../src/client.js';
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerResponse,
  type RunnerWorkerOutbound,
} from '@devpractice/contracts';

/**
 * Message discipline (spec 7.3): responses are accepted only from the ACTIVE
 * worker and only for a MATCHING runId, so a cancelled or superseded run can
 * never overwrite the current result.
 */

class FakeWorker {
  readonly posted: unknown[] = [];
  terminated = false;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate the worker emitting a message. */
  emit(data: RunnerWorkerOutbound): void {
    for (const handler of this.listeners['message'] ?? []) handler({ data });
  }

  emitError(): void {
    for (const handler of this.listeners['error'] ?? []) handler({});
  }
}

function makeResponse(runId: string, overrides: Partial<RunnerResponse> = {}): RunnerResponse {
  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runId,
    status: 'passed',
    durationMs: 5,
    diagnostics: [],
    consoleOutput: [],
    consoleTruncated: false,
    caseResults: [],
    ...overrides,
  };
}

const RUN_INPUT = {
  exerciseId: 'ex-1',
  exerciseVersionId: 'v-1',
  source: 'function f() { return 1; }',
  language: 'javascript' as const,
  entrypoint: 'f',
  assertInputUnchanged: false,
  cases: [{ id: 'a', args: [], expected: 1, hidden: false }],
};

function newClient() {
  let worker!: FakeWorker;
  const client = new RunnerClient({
    createWorker: () => {
      worker = new FakeWorker();
      // Ready on the next tick, mirroring the real worker's startup message.
      queueMicrotask(() => worker.emit({ type: 'ready' }));
      return worker as unknown as Worker;
    },
  });
  return { client, getWorker: () => worker };
}

describe('RunnerClient message discipline', () => {
  it('resolves a matching runId', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-1', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));
    getWorker().emit({ type: 'result', response: makeResponse('run-1') });
    await expect(promise).resolves.toMatchObject({ runId: 'run-1', status: 'passed' });
    client.dispose();
  });

  it('ignores a response whose runId does not match the pending run', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-2', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));

    // A stale response from a superseded run must not settle this one.
    getWorker().emit({ type: 'result', response: makeResponse('run-STALE', { status: 'failed' }) });

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    getWorker().emit({ type: 'result', response: makeResponse('run-2') });
    await expect(promise).resolves.toMatchObject({ status: 'passed' });
    client.dispose();
  });

  it('ignores a response with a mismatched protocol version', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-3', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));

    getWorker().emit({
      type: 'result',
      response: { ...makeResponse('run-3'), protocolVersion: 99 as unknown as 1 },
    });
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    getWorker().emit({ type: 'result', response: makeResponse('run-3') });
    await expect(promise).resolves.toMatchObject({ status: 'passed' });
    client.dispose();
  });

  it('cancel terminates the worker and resolves as cancelled', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-4', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));
    const worker = getWorker();

    client.cancel();
    await expect(promise).resolves.toMatchObject({ status: 'cancelled', runId: 'run-4' });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it('a superseding run cancels the one in flight', async () => {
    const { client, getWorker } = newClient();
    const first = client.run({ runId: 'run-5', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));

    const second = client.run({ runId: 'run-6', ...RUN_INPUT });
    await expect(first).resolves.toMatchObject({ status: 'cancelled' });

    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));
    getWorker().emit({ type: 'result', response: makeResponse('run-6') });
    await expect(second).resolves.toMatchObject({ runId: 'run-6', status: 'passed' });
    client.dispose();
  });

  it('drops the worker after a fault so the next run gets a clean runtime', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-7', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));
    const first = getWorker();

    first.emit({
      type: 'result',
      response: makeResponse('run-7', { status: 'runtime_error', message: 'boom' }),
    });
    await expect(promise).resolves.toMatchObject({ status: 'runtime_error' });
    expect(first.terminated).toBe(true);

    const next = client.run({ runId: 'run-8', ...RUN_INPUT });
    // Wait until the run has actually been posted to the replacement worker:
    // a fresh worker exists synchronously, but the client only registers the
    // pending run after it reports ready, so emitting sooner would be dropped.
    await vi.waitFor(() => {
      expect(getWorker()).not.toBe(first);
      expect(getWorker().posted.length).toBe(1);
    });
    getWorker().emit({ type: 'result', response: makeResponse('run-8') });
    await expect(next).resolves.toMatchObject({ status: 'passed' });
    client.dispose();
  });

  it('a worker error settles the pending run instead of hanging', async () => {
    const { client, getWorker } = newClient();
    const promise = client.run({ runId: 'run-9', ...RUN_INPUT });
    await vi.waitFor(() => expect(getWorker().posted.length).toBe(1));
    getWorker().emitError();
    await expect(promise).resolves.toMatchObject({ status: 'runtime_error' });
    client.dispose();
  });
});
