import { useCallback, useEffect, useRef, useState } from 'react';
import { RunnerClient, type RunnerPhase } from '@devpractice/runner';
import type { RunnerCase, RunnerResponse } from '@devpractice/contracts';

/**
 * Owns one RunnerClient per mounted exercise.
 *
 * The worker is created lazily on first run so the WASM interpreter and the
 * TypeScript compiler stay out of the initial bundle (spec 14.3).
 */

export interface UseRunnerResult {
  phase: RunnerPhase;
  result: RunnerResponse | null;
  /** Set when the runtime itself could not start, so the UI can offer Retry. */
  initFailed: boolean;
  run: (input: {
    exerciseId: string;
    exerciseVersionId: string;
    source: string;
    language: 'javascript' | 'typescript';
    entrypoint: string;
    assertInputUnchanged: boolean;
    cases: RunnerCase[];
  }) => Promise<RunnerResponse>;
  stop: () => void;
  clear: () => void;
}

function createRunnerWorker(): Worker {
  // Vite resolves this to a dedicated module worker at build time.
  return new Worker(new URL('../../workers/runner.worker.ts', import.meta.url), {
    type: 'module',
    name: 'devpractice-runner',
  });
}

export function useRunner(): UseRunnerResult {
  const clientRef = useRef<RunnerClient | null>(null);
  const [phase, setPhase] = useState<RunnerPhase>('idle');
  const [result, setResult] = useState<RunnerResponse | null>(null);
  const [initFailed, setInitFailed] = useState(false);

  const getClient = useCallback((): RunnerClient => {
    if (!clientRef.current) {
      clientRef.current = new RunnerClient({
        createWorker: createRunnerWorker,
        onPhaseChange: setPhase,
      });
    }
    return clientRef.current;
  }, []);

  const run = useCallback<UseRunnerResult['run']>(
    async (input) => {
      setInitFailed(false);
      const runId = crypto.randomUUID();
      const response = await getClient().run({ runId, ...input });
      // A cancelled run must not overwrite what is on screen.
      if (response.status !== 'cancelled') setResult(response);
      if (response.status === 'timed_out' && response.caseResults.length === 0) {
        setInitFailed(/runner took too long to start/i.test(response.message ?? ''));
      }
      return response;
    },
    [getClient],
  );

  const stop = useCallback(() => {
    clientRef.current?.cancel();
  }, []);

  const clear = useCallback(() => setResult(null), []);

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  return { phase, result, initFailed, run, stop, clear };
}
