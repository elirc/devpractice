import { useCallback, useEffect, useState } from 'react';
import type { AttemptResult, RunnerCase } from '@devpractice/contracts';
import { CodeEditor } from './CodeEditor.js';
import { ResultPanel } from './ResultPanel.js';
import { useRunner } from './useRunner.js';
import { useDraft } from './useDraft.js';
import type { SaveIndicatorState } from './contract.js';
import styles from './practice.module.css';

/**
 * Browser code exercise (spec 3.3, 7).
 *
 * Run and Stop are explicit on-screen actions so they work on mobile without
 * keyboard shortcuts. Stop preserves the draft. A submitted attempt carries the
 * runner's own case ids; the server re-checks them against the pinned exercise
 * version and labels the evidence browser_automated.
 */

export interface FunctionExerciseProps {
  exerciseId: string;
  exerciseVersionId: string;
  language: 'javascript' | 'typescript';
  entrypoint: string;
  starterCode: string;
  assertInputUnchanged: boolean;
  cases: RunnerCase[];
  initialDraft: { source: string; revision: number } | null;
  submitting: boolean;
  feedback: AttemptResult | null;
  onSubmit: (input: {
    source: string;
    runnerResult: {
      status: string;
      passedCaseIds: string[];
      failedCaseIds: string[];
      durationMs: number;
      message?: string;
    };
  }) => void;
  onSaveStateChange?: (state: SaveIndicatorState) => void;
}

export function FunctionExercise(props: FunctionExerciseProps) {
  const {
    exerciseId,
    exerciseVersionId,
    language,
    entrypoint,
    starterCode,
    assertInputUnchanged,
    cases,
    initialDraft,
    submitting,
    onSubmit,
    onSaveStateChange,
  } = props;

  const draft = useDraft(
    exerciseId,
    exerciseVersionId,
    initialDraft?.source ?? starterCode,
    initialDraft?.revision ?? 0,
    true,
  );
  const runner = useRunner();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    onSaveStateChange?.(draft.state);
  }, [draft.state, onSaveStateChange]);

  // Warn before leaving with unsaved text rather than discarding it silently.
  useEffect(() => {
    if (!draft.dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [draft.dirty]);

  const handleRun = useCallback(async () => {
    // Save before running so a crash cannot lose the attempt's source.
    draft.saveNow();
    await runner.run({
      exerciseId,
      exerciseVersionId,
      source: draft.source,
      language,
      entrypoint,
      assertInputUnchanged,
      cases,
    });
  }, [
    assertInputUnchanged,
    cases,
    draft,
    entrypoint,
    exerciseId,
    exerciseVersionId,
    language,
    runner,
  ]);

  const result = runner.result;

  /**
   * Only a run that actually produced case results is submittable.
   *
   * The server derives the outcome from the pinned cases (spec 3.4, 9.3), so a
   * whole-run fault — compile_error, timed_out, an unsupported request, or a
   * runtime fault before any case ran — carries no evidence and would record an
   * empty attempt. Note this is narrower than "no errors": an exception thrown
   * inside a case still yields status 'failed' WITH case results, and that is a
   * legitimate failing attempt the learner may submit.
   */
  const hasGradableResult =
    result !== null &&
    (result.status === 'passed' || result.status === 'failed') &&
    result.caseResults.length > 0;
  const canSubmit = hasGradableResult && !submitting;
  const blockedReason =
    result === null || result.status === 'cancelled' || hasGradableResult
      ? null
      : result.status === 'compile_error'
        ? 'Fix the errors above and run again before submitting.'
        : result.status === 'timed_out'
          ? 'The run did not finish, so there is nothing to submit yet. Fix the loop and run again.'
          : result.status === 'unsupported'
            ? 'This exercise cannot be submitted from the browser.'
            : 'The run stopped before any case was checked, so there is nothing to submit yet.';

  return (
    <div className={styles.functionExercise} data-practice-panel tabIndex={-1}>
      <div className={styles.editorHeader}>
        <span className={styles.fieldLabel}>
          Write <code>{entrypoint}</code> ({language === 'typescript' ? 'TypeScript' : 'JavaScript'})
        </span>
        <SaveIndicator state={draft.state} onRetry={draft.retry} />
      </div>

      <CodeEditor
        value={draft.source}
        onChange={draft.setSource}
        language={language}
        label={`Code editor for ${entrypoint}`}
      />

      {draft.conflict ? (
        <div className={styles.conflict} role="alert">
          <h4>This exercise was edited on another device</h4>
          <p className={styles.caseNote}>
            Both versions are kept. Choose which to continue with — nothing is overwritten
            until you decide.
          </p>
          <div className={styles.caseDiff}>
            <div>
              <span className={styles.caseLabel}>This device</span>
              <pre className={styles.codeBlock}>{draft.source}</pre>
            </div>
            <div>
              <span className={styles.caseLabel}>
                Saved elsewhere ({new Date(draft.conflict.serverUpdatedAt).toLocaleString()})
              </span>
              <pre className={styles.codeBlock}>{draft.conflict.serverSource}</pre>
            </div>
          </div>
          <div className={styles.hintActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => draft.resolveConflict('mine')}
            >
              Keep this device&rsquo;s version
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => draft.resolveConflict('server')}
            >
              Keep the other version
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.runBar}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void handleRun()}
          disabled={runner.phase !== 'idle'}
        >
          {runner.phase === 'initialising'
            ? 'Starting runner…'
            : runner.phase === 'running'
              ? 'Running…'
              : 'Run'}
        </button>

        {runner.phase !== 'idle' ? (
          <button type="button" className={styles.secondaryButton} onClick={runner.stop}>
            Stop
          </button>
        ) : null}

        {!confirmReset ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => (draft.dirty ? setConfirmReset(true) : draft.setSource(starterCode))}
          >
            Reset starter
          </button>
        ) : (
          <span className={styles.confirmRow}>
            <span className={styles.caseNote}>Replace your unsaved code?</span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                // The server keeps a recoverable snapshot of the replaced draft.
                draft.setSource(starterCode);
                setConfirmReset(false);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </span>
        )}

        {canSubmit ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={submitting}
            onClick={() =>
              onSubmit({
                source: draft.source,
                runnerResult: {
                  status: result.status,
                  passedCaseIds: result.caseResults.filter((c) => c.passed).map((c) => c.caseId),
                  failedCaseIds: result.caseResults.filter((c) => !c.passed).map((c) => c.caseId),
                  durationMs: result.durationMs,
                  ...(result.message ? { message: result.message } : {}),
                },
              })
            }
          >
            {submitting ? 'Submitting…' : 'Submit attempt'}
          </button>
        ) : null}

        {/*
          Deliberately NOT a live region. The Results summary is the one
          announcement per run; making this a second role="status" meant a
          screen reader announced the outcome and this note in competition.
        */}
        {blockedReason ? <span className={styles.caseNote}>{blockedReason}</span> : null}
      </div>

      {runner.initFailed ? (
        <p className={styles.caseNote} role="alert">
          The code runner could not start.{' '}
          <button type="button" className={styles.linkButton} onClick={() => void handleRun()}>
            Try again
          </button>
        </p>
      ) : null}

      <ResultPanel result={result} />
    </div>
  );
}

function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveIndicatorState;
  onRetry: () => void;
}) {
  const text: Record<SaveIndicatorState, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Unsaved',
    conflict: 'Conflict',
  };
  if (!text[state]) return null;
  return (
    <span className={styles.saveIndicator} role="status" aria-live="polite">
      {text[state]}
      {state === 'unsaved' ? (
        <>
          {' '}
          <button type="button" className={styles.linkButton} onClick={onRetry}>
            Retry
          </button>
        </>
      ) : null}
    </span>
  );
}
