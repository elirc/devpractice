import { useCallback, useEffect, useState } from 'react';
import type { AttemptResult } from '@devpractice/contracts';
import type { ExercisePanelProps } from './contract.js';
import {
  ApiCallError,
  getExercise,
  revealHint,
  revealSolution,
  submitAttempt,
  type ExerciseView,
} from './api.js';
import { Markdown } from './Markdown.js';
import { HintPanel } from './HintPanel.js';
import { FunctionExercise } from './FunctionExercise.js';
import {
  ChoiceExercise,
  ExplanationExercise,
  LocalProjectExercise,
  PredictOutputExercise,
} from './renderers.js';
import styles from './practice.module.css';

/**
 * The practice surface rendered by the app shell (see contract.ts).
 * Dispatches to the renderer for the exercise type and owns attempt submission.
 */
export function ExercisePanel({
  exerciseId,
  layout,
  onAttemptRecorded,
  onSaveStateChange,
}: ExercisePanelProps) {
  const [exercise, setExercise] = useState<ExerciseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AttemptResult | null>(null);
  const [busyReveal, setBusyReveal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExercise(null);
    setFeedback(null);
    setLoadError(null);
    getExercise(exerciseId)
      .then((data) => {
        if (!cancelled) setExercise(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiCallError ? error.message : 'This exercise could not be loaded.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  const submit = useCallback(
    async (payload: Parameters<typeof submitAttempt>[0]) => {
      setSubmitting(true);
      setActionError(null);
      try {
        const result = await submitAttempt(payload);
        setFeedback(result);
        onAttemptRecorded?.(result);
      } catch (error) {
        setActionError(
          error instanceof ApiCallError
            ? error.message
            : 'Your attempt could not be recorded. Your work is still here — try again.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [onAttemptRecorded],
  );

  const handleReveal = useCallback(
    async (kind: 'hint' | 'solution', index?: number) => {
      if (!exercise) return;
      setBusyReveal(true);
      setActionError(null);
      try {
        const response =
          kind === 'hint'
            ? await revealHint(exercise.id, crypto.randomUUID(), index ?? 0)
            : await revealSolution(exercise.id, crypto.randomUUID());
        setExercise((current) => {
          if (!current) return current;
          if (response.revealKind === 'hint' && response.hint !== undefined) {
            return { ...current, revealedHints: [...current.revealedHints, response.hint] };
          }
          if (response.revealKind === 'solution' && response.solution) {
            return { ...current, revealedSolution: response.solution };
          }
          return current;
        });
      } catch (error) {
        setActionError(
          error instanceof ApiCallError ? error.message : 'That could not be shown right now.',
        );
      } finally {
        setBusyReveal(false);
      }
    },
    [exercise],
  );

  if (loadError) {
    return (
      <div className={styles.panel} role="alert">
        <p>{loadError}</p>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className={styles.panel} aria-busy="true">
        <p className={styles.caseNote}>Loading exercise…</p>
      </div>
    );
  }

  return (
    <div
      className={layout === 'focused' ? styles.panelFocused : styles.panel}
      data-practice-panel
      tabIndex={-1}
    >
      <header className={styles.panelHeader}>
        <h2 className={styles.exerciseTitle}>{exercise.title}</h2>
        <p className={styles.meta}>
          {exercise.difficulty} · about {exercise.estimatedMinutes} min
        </p>
      </header>

      <Markdown source={exercise.promptMarkdown} />

      {actionError ? (
        <p className={styles.caseNote} role="alert">
          {actionError}
        </p>
      ) : null}

      {renderBody()}

      {feedback ? (
        <p className={styles.caseNote} role="status">
          Recorded as{' '}
          {feedback.gradingOrigin === 'browser_automated'
            ? 'a browser-checked attempt'
            : feedback.gradingOrigin === 'self_reported'
              ? 'your own assessment'
              : 'a checked answer'}
          {feedback.assistance !== 'none'
            ? `, with ${feedback.assistance === 'hints' ? 'hints' : 'the solution'} shown`
            : ''}
          .{feedback.xpAwarded > 0 ? ` +${feedback.xpAwarded} XP` : ''}
        </p>
      ) : null}

      {exercise.type !== 'local-project' ? (
        <HintPanel
          hintCount={exercise.hintCount}
          revealedHints={exercise.revealedHints}
          solution={exercise.revealedSolution}
          busy={busyReveal}
          onRevealHint={(index) => void handleReveal('hint', index)}
          onRevealSolution={() => void handleReveal('solution')}
        />
      ) : null}
    </div>
  );

  function renderBody() {
    if (exercise!.localOnly) {
      return (
        <LocalProjectExercise
          reason={exercise!.localOnly.reason}
          missionId={exercise!.localOnly.missionId}
        />
      );
    }

    const grading = exercise!.grading;
    const common = {
      submitting,
      feedback,
      onSubmit: (answer: unknown, extra?: { selfAssessment?: 'met' | 'partially-met' | 'not-met' }) =>
        void submit({
          clientEventId: crypto.randomUUID(),
          exerciseId: exercise!.id,
          exerciseVersionId: exercise!.versionId,
          answer,
          gradingOrigin: extra?.selfAssessment ? 'self_reported' : 'server_objective',
          ...(extra?.selfAssessment ? { selfAssessment: extra.selfAssessment } : {}),
        }),
    };

    switch (grading.kind) {
      case 'choice':
        return <ChoiceExercise {...common} options={grading.options} mode={grading.mode} />;
      case 'predict-output':
        return <PredictOutputExercise {...common} normalization={grading.normalization} />;
      case 'rubric':
        return (
          <ExplanationExercise
            {...common}
            criteria={grading.criteria}
            modelAnswerMarkdown={exercise!.revealedSolution?.explanationMarkdown ?? null}
          />
        );
      case 'function-cases':
        return (
          <FunctionExercise
            exerciseId={exercise!.id}
            exerciseVersionId={exercise!.versionId}
            language={grading.language}
            entrypoint={grading.entrypoint}
            starterCode={grading.starterCode}
            assertInputUnchanged={grading.assertInputUnchanged}
            cases={grading.cases}
            initialDraft={exercise!.draft}
            submitting={submitting}
            feedback={feedback}
            {...(onSaveStateChange ? { onSaveStateChange } : {})}
            onSubmit={({ source, runnerResult }) =>
              void submit({
                clientEventId: crypto.randomUUID(),
                exerciseId: exercise!.id,
                exerciseVersionId: exercise!.versionId,
                source,
                gradingOrigin: 'browser_automated',
                runnerResult,
              })
            }
          />
        );
      default:
        return null;
    }
  }
}

export default ExercisePanel;
