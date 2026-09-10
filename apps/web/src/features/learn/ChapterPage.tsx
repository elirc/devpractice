import { Link, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Markdown } from '../../components/Markdown';
import { Button, Callout, Card, PageHeader, StatusChip } from '../../components/Ui';
import { useChapter } from '../../lib/queries';
import { pluralize } from '../../lib/format';
import styles from './Learn.module.css';

const LESSON_TONE = {
  completed: 'success',
  in_progress: 'warning',
  skipped: 'neutral',
  not_started: 'neutral',
} as const;

const LESSON_LABEL = {
  completed: 'Completed',
  in_progress: 'In progress',
  skipped: 'Skipped',
  not_started: 'Not started',
} as const;

export default function ChapterPage(): JSX.Element {
  const { chapterId = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useChapter(chapterId);

  if (isPending) return <LoadingState label="Loading chapter" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  // Concept-level and advisory (spec 3.1): shown so the owner knows what this
  // chapter builds on, never as a lock and never as chapter links.
  const suggestedBackground = data.prerequisiteIds;

  return (
    <div>
      <p className={styles.breadcrumb}>
        <Link to="/learn">Learn</Link> · {data.trackTitle}
      </p>

      <PageHeader
        title={data.title}
        actions={
          data.placedOut ? (
            <StatusChip tone="info" icon="⇥">
              Placed out
            </StatusChip>
          ) : undefined
        }
      />

      {suggestedBackground.length > 0 ? (
        <Callout tone="info" title="Suggested background">
          <p>
            This chapter builds on {suggestedBackground.join(', ')}. You can still work through it
            now — prerequisites are a suggestion, not a lock.
          </p>
        </Callout>
      ) : null}

      {data.bodyMarkdown ? (
        <Card>
          <Markdown source={data.bodyMarkdown} />
        </Card>
      ) : null}

      <Card>
        <h2>What this chapter covers</h2>
        <ul className={styles.objectives}>
          {data.objectiveIds.map((objective) => (
            <li key={objective}>
              <code>{objective}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Lessons</h2>
        <p className={styles.progressText}>
          {data.completedLessonCount} of {pluralize(data.lessonCount, 'lesson')} completed
        </p>
        <ul className={styles.lessonList}>
          {data.lessons.map((lesson) => (
            <li key={lesson.id} className={styles.lessonRow}>
              <Link className={styles.lessonLink} to={`/learn/lessons/${lesson.id}`}>
                {lesson.title}
              </Link>
              <span className={styles.lessonMeta}>
                <span className={styles.progressText}>~{lesson.estimatedMinutes} min</span>
                {lesson.updatedPracticeAvailable ? (
                  <StatusChip tone="warning" icon="↻">
                    Updated practice available
                  </StatusChip>
                ) : null}
                <StatusChip tone={LESSON_TONE[lesson.status]}>
                  {LESSON_LABEL[lesson.status]}
                </StatusChip>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Placement assessment</h2>
        <p>
          Five separately written questions covering this chapter&apos;s objectives. Passing marks
          the chapter as placed out; it does not mark the lessons completed or claim you have
          retained the material.
        </p>
        {data.placementAvailable ? (
          <Link to={`/placement/${data.id}`}>
            <Button variant="primary">Take the placement assessment</Button>
          </Link>
        ) : (
          <p className={styles.progressText}>
            No placement assessment is published for this chapter.
          </p>
        )}
      </Card>

      {data.missions.length > 0 ? (
        <Card>
          <h2>Related projects</h2>
          <ul className={styles.lessonList}>
            {data.missions.map((mission) => (
              <li key={mission.id} className={styles.lessonRow}>
                <Link className={styles.lessonLink} to={`/projects/${mission.id}`}>
                  {mission.title}
                </Link>
                <StatusChip tone={mission.status === 'completed' ? 'success' : 'neutral'}>
                  {mission.workType}
                </StatusChip>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
