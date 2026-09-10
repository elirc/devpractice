import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { Card, PageHeader, StatusChip } from '../../components/Ui';
import { useCurriculum } from '../../lib/queries';
import { pluralize } from '../../lib/format';
import styles from './Learn.module.css';

type Filter = 'all' | 'in-progress' | 'not-started' | 'completed' | 'placed-out';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'not-started', label: 'Not started' },
  { id: 'completed', label: 'Completed' },
  { id: 'placed-out', label: 'Placed out' },
];

export default function LearnPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useCurriculum();
  const [filter, setFilter] = useState<Filter>('all');

  const tracks = useMemo(() => {
    if (!data) return [];
    return data.map((track) => ({
      ...track,
      chapters: track.chapters.filter((chapter) => {
        if (filter === 'all') return true;
        if (filter === 'placed-out') return chapter.placedOut;
        const done = chapter.completedLessonCount;
        if (filter === 'completed') return done === chapter.lessonCount && chapter.lessonCount > 0;
        if (filter === 'in-progress') return done > 0 && done < chapter.lessonCount;
        return done === 0 && !chapter.placedOut;
      }),
    }));
  }, [data, filter]);

  if (isPending) return <LoadingState label="Loading curriculum" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (data.length === 0) {
    return (
      <div>
        <PageHeader title="Learn" />
        <EmptyState
          title="No published curriculum"
          description="This installation has no active content release yet. Import and publish a content package to begin."
          action={<Link to="/content">Open content</Link>}
        />
      </div>
    );
  }

  const visibleChapters = tracks.reduce((sum, track) => sum + track.chapters.length, 0);

  return (
    <div>
      <PageHeader
        title="Learn"
        description="Chapters are suggested in order. You can open any chapter at any time."
      />

      <div className={styles.filters} role="group" aria-label="Filter chapters">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={[styles.filter, filter === option.id ? styles.filterActive : ''].join(' ')}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {visibleChapters === 0 ? (
        <EmptyState
          title="No chapters match this filter"
          description="Choose a different filter to see the rest of the curriculum."
        />
      ) : null}

      {tracks.map((track) =>
        track.chapters.length === 0 ? null : (
          <section key={track.id} className={styles.track}>
            <h2>{track.title}</h2>
            <p className={styles.trackDescription}>{track.description}</p>
            <ul className={styles.chapterList}>
              {track.chapters.map((chapter) => {
                const complete =
                  chapter.lessonCount > 0 && chapter.completedLessonCount === chapter.lessonCount;
                return (
                  <li key={chapter.id}>
                    <Card className={styles.chapterCard}>
                      <div className={styles.chapterHeader}>
                        <h3 className={styles.chapterTitle}>
                          <Link to={`/learn/chapters/${chapter.id}`}>{chapter.title}</Link>
                        </h3>
                        <div className={styles.chips}>
                          {chapter.placedOut ? (
                            <StatusChip tone="info" icon="⇥">
                              Placed out
                            </StatusChip>
                          ) : null}
                          {complete ? (
                            <StatusChip tone="success">Completed</StatusChip>
                          ) : chapter.completedLessonCount > 0 ? (
                            <StatusChip tone="warning">In progress</StatusChip>
                          ) : (
                            <StatusChip tone="neutral">Not started</StatusChip>
                          )}
                        </div>
                      </div>
                      <p className={styles.progressText}>
                        {chapter.completedLessonCount} of {pluralize(chapter.lessonCount, 'lesson')}{' '}
                        completed
                      </p>
                      <div
                        className={styles.bar}
                        role="progressbar"
                        aria-valuenow={chapter.completedLessonCount}
                        aria-valuemin={0}
                        aria-valuemax={chapter.lessonCount}
                        aria-label={`${chapter.title} progress`}
                      >
                        <span
                          className={styles.barFill}
                          style={{
                            width:
                              chapter.lessonCount === 0
                                ? '0%'
                                : `${Math.round(
                                    (chapter.completedLessonCount / chapter.lessonCount) * 100,
                                  )}%`,
                          }}
                        />
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
