import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AttemptResult } from '@devpractice/contracts';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Markdown } from '../../components/Markdown';
import { NoteEditor } from '../../components/NoteEditor';
import { PracticeSlot } from '../../components/PracticeSlot';
import { SaveIndicator } from '../../components/SaveIndicator';
import { Button, Callout, Card, StatusChip } from '../../components/Ui';
import type { SaveIndicatorState } from '../practice/contract';
import {
  useCompleteLesson,
  useEnrollReviewCards,
  useLesson,
  useSkipLesson,
  useToggleBookmark,
} from '../../lib/queries';
import { ApiRequestError } from '../../lib/api';
import styles from './Lesson.module.css';

type Tab = 'instruction' | 'practice' | 'results';

const OUTCOME_TONE = {
  passed: 'success',
  failed: 'danger',
  needs_self_assessment: 'warning',
} as const;

const OUTCOME_LABEL = {
  passed: 'Passed',
  failed: 'Not yet',
  needs_self_assessment: 'Self-assessment needed',
} as const;

const ORIGIN_LABEL = {
  server_objective: 'checked by the server',
  browser_automated: 'checked in your browser',
  self_reported: 'self-reported',
} as const;

export default function LessonPage(): JSX.Element {
  const { lessonId = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useLesson(lessonId);
  const [tab, setTab] = useState<Tab>('instruction');
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);
  const [saveState, setSaveState] = useState<SaveIndicatorState>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const complete = useCompleteLesson(lessonId);
  const skip = useSkipLesson(lessonId);
  const enroll = useEnrollReviewCards(lessonId);
  const bookmark = useToggleBookmark();

  useEffect(() => {
    setActiveExerciseId(null);
    setLastResult(null);
    setTab('instruction');
  }, [lessonId]);

  useEffect(() => {
    if (!activeExerciseId && data?.exercises[0]) setActiveExerciseId(data.exercises[0].id);
  }, [activeExerciseId, data]);

  const onAttemptRecorded = useCallback(
    (result: AttemptResult) => {
      setLastResult(result);
      // The server may have advanced lesson status or exercise evidence.
      void refetch();
    },
    [refetch],
  );

  if (isPending) return <LoadingState label="Loading lesson" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const requiredExercises = data.exercises.filter((ex) => ex.requiredForLessonCompletion);
  const outstanding = requiredExercises.filter((ex) => ex.latestOutcome !== 'passed');
  const canComplete = outstanding.length === 0 && data.status !== 'completed';

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await refetch();
    } catch (caught) {
      setActionError(
        caught instanceof ApiRequestError ? caught.message : 'That action could not be completed.',
      );
    }
  }

  const instructionPane = (
    <div className={styles.pane}>
      <Card>
        <div className={styles.lessonHeader}>
          <div>
            <p className={styles.breadcrumb}>
              <Link to="/learn">Learn</Link> ·{' '}
              <Link to={`/learn/chapters/${data.chapterId}`}>{data.chapterTitle}</Link>
            </p>
            <h1 className={styles.title}>{data.title}</h1>
          </div>
          <div className={styles.chips}>
            <StatusChip
              tone={
                data.status === 'completed'
                  ? 'success'
                  : data.status === 'skipped'
                    ? 'neutral'
                    : data.status === 'in_progress'
                      ? 'warning'
                      : 'neutral'
              }
            >
              {data.status.replace('_', ' ')}
            </StatusChip>
            <Button
              variant="quiet"
              aria-pressed={data.bookmarked}
              onClick={() =>
                void runAction(() =>
                  bookmark.mutateAsync({ itemId: data.id, bookmarked: data.bookmarked }),
                )
              }
            >
              {data.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}
            </Button>
          </div>
        </div>

        {data.updatedPracticeAvailable ? (
          <Callout tone="warning" title="Updated practice available">
            The required exercises changed since you completed this lesson. Your original completion
            and its history are kept — the new practice records its own separate evidence.
          </Callout>
        ) : null}

        <h2 className={styles.sectionTitle}>What you will be able to do</h2>
        <ul className={styles.objectives}>
          {data.objectives.map((objective) => (
            <li key={objective}>{objective}</li>
          ))}
        </ul>

        <Markdown source={data.bodyMarkdown} />

        <h2 className={styles.sectionTitle}>Worked example</h2>
        <Markdown source={data.workedExampleMarkdown} />

        <h2 className={styles.sectionTitle}>Common mistakes</h2>
        <ul className={styles.objectives}>
          {data.commonMistakes.map((mistake) => (
            <li key={mistake}>{mistake}</li>
          ))}
        </ul>

        <h2 className={styles.sectionTitle}>Summary</h2>
        <Markdown source={data.summaryMarkdown} />

        {data.references.length > 0 ? (
          <>
            <h2 className={styles.sectionTitle}>References</h2>
            <ul className={styles.objectives}>
              {data.references.map((reference) => (
                <li key={reference.url}>
                  <a href={reference.url} target="_blank" rel="noopener noreferrer">
                    {reference.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <NoteEditor contentItemId={data.id} defaultTitle={data.title} />
      </Card>
    </div>
  );

  const practicePane = (
    <div className={styles.pane}>
      <Card>
        <h2 className={styles.sectionTitle}>Practice</h2>
        <ul className={styles.exerciseTabs} role="tablist" aria-label="Exercises">
          {data.exercises.map((exercise, index) => (
            <li key={exercise.id} role="presentation">
              <button
                type="button"
                role="tab"
                aria-selected={activeExerciseId === exercise.id}
                className={[
                  styles.exerciseTab,
                  activeExerciseId === exercise.id ? styles.exerciseTabActive : '',
                ].join(' ')}
                onClick={() => setActiveExerciseId(exercise.id)}
              >
                <span>{index + 1}</span>
                {exercise.latestOutcome ? (
                  <span
                    className={styles.exerciseMark}
                    aria-label={OUTCOME_LABEL[exercise.latestOutcome]}
                  >
                    {exercise.latestOutcome === 'passed' ? '✓' : '·'}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {activeExerciseId ? (
          <PracticeSlot
            exerciseId={activeExerciseId}
            layout="lesson"
            onAttemptRecorded={onAttemptRecorded}
            onSaveStateChange={setSaveState}
          />
        ) : (
          <p>This lesson has no exercises.</p>
        )}
      </Card>
    </div>
  );

  const resultsPane = (
    <div className={styles.pane}>
      <Card>
        <h2 className={styles.sectionTitle}>Results</h2>
        {lastResult ? (
          <>
            <div className={styles.chips}>
              <StatusChip tone={OUTCOME_TONE[lastResult.outcome]}>
                {OUTCOME_LABEL[lastResult.outcome]}
              </StatusChip>
              <StatusChip tone="neutral" icon="i">
                {ORIGIN_LABEL[lastResult.gradingOrigin]}
              </StatusChip>
              {lastResult.assistance !== 'none' ? (
                <StatusChip tone="warning">
                  {lastResult.assistance === 'solution_viewed'
                    ? 'Solution was revealed'
                    : 'Hints were used'}
                </StatusChip>
              ) : null}
              {lastResult.xpAwarded > 0 ? (
                <StatusChip tone="info" icon="★">
                  +{lastResult.xpAwarded} XP
                </StatusChip>
              ) : null}
            </div>
            {lastResult.feedback.caseResults ? (
              <ul className={styles.caseList}>
                {lastResult.feedback.caseResults.map((result) => (
                  <li key={result.caseId}>
                    <span aria-hidden="true">{result.passed ? '✓' : '✕'}</span>{' '}
                    <code>{result.caseId}</code> — {result.passed ? 'passed' : 'failed'}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className={styles.muted}>
            Submit an exercise and its result will appear here, with how it was checked.
          </p>
        )}

        <h3 className={styles.sectionTitle}>Finish this lesson</h3>
        {outstanding.length > 0 ? (
          <p className={styles.muted}>
            {outstanding.length} required{' '}
            {outstanding.length === 1 ? 'exercise still needs' : 'exercises still need'} a passing
            result before this lesson can be marked completed.
          </p>
        ) : null}
        {actionError ? (
          <p className={styles.error} role="alert">
            {actionError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={!canComplete || complete.isPending}
            onClick={() => void runAction(() => complete.mutateAsync())}
          >
            {data.status === 'completed' ? 'Completed' : 'Mark lesson complete'}
          </Button>
          <Button
            disabled={enroll.isPending || data.cardsEnrolled}
            onClick={() => void runAction(() => enroll.mutateAsync())}
          >
            {data.cardsEnrolled ? 'Cards added to review' : 'Add cards to review'}
          </Button>
          <Button
            disabled={skip.isPending || data.status === 'completed'}
            onClick={() => void runAction(() => skip.mutateAsync())}
          >
            Skip this lesson
          </Button>
        </div>
        <p className={styles.footnote}>
          Skipping records that you moved on. It does not create evidence that you know the
          material, and it never removes evidence you already earned.
        </p>
      </Card>
    </div>
  );

  return (
    <div>
      <div className={styles.mobileBar}>
        <div className={styles.tabs} role="tablist" aria-label="Lesson sections">
          {(['instruction', 'practice', 'results'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={[styles.tab, tab === id ? styles.tabActive : ''].join(' ')}
              onClick={() => setTab(id)}
            >
              {id === 'instruction' ? 'Instruction' : id === 'practice' ? 'Practice' : 'Results'}
            </button>
          ))}
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {/*
        All three panes stay mounted. Switching tabs hides a pane with CSS
        rather than unmounting it, so editor text and answers survive the
        switch (spec 4.3).
      */}
      <div className={styles.workspace}>
        <div
          className={[styles.paneWrap, tab === 'instruction' ? styles.paneActive : ''].join(' ')}
          data-pane="instruction"
        >
          {instructionPane}
        </div>
        <div
          className={[styles.paneWrap, styles.practiceWrap, tab === 'practice' ? styles.paneActive : ''].join(
            ' ',
          )}
          data-pane="practice"
        >
          {practicePane}
        </div>
        <div
          className={[styles.paneWrap, styles.resultsWrap, tab === 'results' ? styles.paneActive : ''].join(
            ' ',
          )}
          data-pane="results"
        >
          {resultsPane}
        </div>
      </div>

      <nav className={styles.lessonNav} aria-label="Lesson navigation">
        {data.previousLessonId ? (
          <Link to={`/learn/lessons/${data.previousLessonId}`}>← Previous lesson</Link>
        ) : (
          <span />
        )}
        {data.nextLessonId ? (
          <Link to={`/learn/lessons/${data.nextLessonId}`}>Next lesson →</Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
