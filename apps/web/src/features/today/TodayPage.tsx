import { Link } from 'react-router-dom';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Button, Card, PageHeader, StatusChip } from '../../components/Ui';
import { useToday } from '../../lib/queries';
import { describeActivity, formatRelative } from '../../lib/format';
import styles from './Today.module.css';

/**
 * The resume screen. Every number here comes from the API — nothing on this
 * page is a hardcoded or invented statistic (spec 4.2).
 */
export default function TodayPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useToday();

  if (isPending) return <LoadingState label="Loading today" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const hasNothing =
    !data.resume && data.reviewsDue === 0 && !data.activeMission && data.recentActivity.length === 0;

  return (
    <div>
      <PageHeader
        title="Today"
        description="Pick up where you left off."
        actions={
          <StatusChip tone="info" icon="★">
            Level {data.level} · {data.totalXp} XP
          </StatusChip>
        }
      />

      {hasNothing ? (
        <Card>
          <h2>Nothing scheduled yet</h2>
          <p>
            Start with the first chapter, or import a content release if this installation has no
            curriculum yet.
          </p>
          <div className={styles.actions}>
            <Link to="/learn">
              <Button variant="primary">Browse the curriculum</Button>
            </Link>
            <Link to="/content">
              <Button>Open content</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      <div className={styles.grid}>
        <Card>
          <h2>Continue learning</h2>
          {data.resume ? (
            <>
              <p className={styles.muted}>{data.resume.chapterTitle}</p>
              <p className={styles.resumeTitle}>{data.resume.lessonTitle}</p>
              <StatusChip tone={data.resume.status === 'in_progress' ? 'warning' : 'neutral'}>
                {data.resume.status === 'in_progress' ? 'In progress' : 'Not started'}
              </StatusChip>
              <div className={styles.actions}>
                <Link to={`/learn/lessons/${data.resume.lessonId}`}>
                  <Button variant="primary">Resume lesson</Button>
                </Link>
              </div>
            </>
          ) : (
            <p className={styles.muted}>No lesson in progress.</p>
          )}
        </Card>

        <Card>
          <h2>Reviews</h2>
          {data.reviewsDue > 0 ? (
            <>
              <p>
                <strong>{data.reviewsDue}</strong> {data.reviewsDue === 1 ? 'card is' : 'cards are'}{' '}
                due now.
              </p>
              <div className={styles.actions}>
                <Link to="/review">
                  <Button variant="primary">Start review</Button>
                </Link>
              </div>
            </>
          ) : (
            <p className={styles.muted}>Nothing is due right now.</p>
          )}
        </Card>

        <Card>
          <h2>Active project</h2>
          {data.activeMission ? (
            <>
              <p className={styles.resumeTitle}>{data.activeMission.title}</p>
              <StatusChip tone="warning">In progress</StatusChip>
              <div className={styles.actions}>
                <Link to={`/projects/${data.activeMission.id}`}>
                  <Button variant="primary">Open mission</Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={styles.muted}>No mission in progress.</p>
              <div className={styles.actions}>
                <Link to="/projects">
                  <Button>Browse projects</Button>
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card>
        <h2>Recent activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className={styles.muted}>Nothing recorded yet.</p>
        ) : (
          <ul className={styles.activity}>
            {data.recentActivity.map((event) => (
              <li key={event.id} className={styles.activityRow}>
                <span>{describeActivity(event)}</span>
                <time dateTime={event.createdAt} className={styles.muted}>
                  {formatRelative(event.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
