import { useState } from 'react';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Button, Callout, Card, PageHeader, StatusChip } from '../../components/Ui';
import { useProgress } from '../../lib/queries';
import { formatDue } from '../../lib/format';
import type { ConceptStatus } from '@devpractice/contracts';
import styles from './Progress.module.css';

const STATUS_TONE: Record<ConceptStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  unseen: 'neutral',
  practicing: 'warning',
  demonstrated: 'info',
  retained: 'success',
  review_due: 'warning',
};

const STATUS_LABEL: Record<ConceptStatus, string> = {
  unseen: 'Not started',
  practicing: 'Practising',
  demonstrated: 'Demonstrated',
  retained: 'Retained',
  review_due: 'Review due',
};

const STATUS_ORDER: ConceptStatus[] = [
  'review_due',
  'practicing',
  'demonstrated',
  'retained',
  'unseen',
];

export default function ProgressPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useProgress();
  const [filter, setFilter] = useState<ConceptStatus | 'all'>('all');

  if (isPending) return <LoadingState label="Loading progress" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const concepts =
    filter === 'all' ? data.concepts : data.concepts.filter((c) => c.status === filter);

  return (
    <div>
      <PageHeader
        title="Progress"
        description="Completion, evidence and assistance are recorded separately."
      />

      <div className={styles.summary}>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.totalXp}</span>
          <span className={styles.statLabel}>XP · level {data.level}</span>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.lessonsCompleted}</span>
          <span className={styles.statLabel}>lessons completed</span>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.chaptersPlacedOut}</span>
          <span className={styles.statLabel}>chapters placed out</span>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.missionsCompleted}</span>
          <span className={styles.statLabel}>missions self-reported</span>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.lessonsSkipped}</span>
          <span className={styles.statLabel}>lessons skipped</span>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statValue}>{data.reviewsDue}</span>
          <span className={styles.statLabel}>reviews due</span>
        </Card>
      </div>

      <Callout tone="info" title="What these mean">
        <p>
          <strong>Demonstrated</strong> needs two independent passes on different items, at least one
          of which applies or debugs rather than recalls. <strong>Retained</strong> adds two
          successful reviews on separate days, at least a week apart. Skipping a lesson and placing
          out of a chapter are recorded, but neither creates evidence that you know the material.
        </p>
      </Callout>

      <Card>
        <h2>Assistance used</h2>
        <p className={styles.muted}>
          Assistance is kept permanently and is not erased by a later independent pass.
        </p>
        <div className={styles.chips}>
          <StatusChip tone="neutral">{data.assistance.hintRevealCount} hints revealed</StatusChip>
          <StatusChip tone="neutral">
            {data.assistance.solutionRevealCount} solutions revealed
          </StatusChip>
        </div>
      </Card>

      <Card>
        <h2>Concept evidence</h2>
        <div className={styles.filters} role="group" aria-label="Filter concepts by status">
          <Button
            variant={filter === 'all' ? 'primary' : 'secondary'}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          {STATUS_ORDER.map((status) => (
            <Button
              key={status}
              variant={filter === status ? 'primary' : 'secondary'}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>

        {concepts.length === 0 ? (
          <p className={styles.muted}>No concepts with this status yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <caption className="srOnly">Concept evidence by status</caption>
              <thead>
                <tr>
                  <th scope="col">Concept</th>
                  <th scope="col">Status</th>
                  <th scope="col">Independent</th>
                  <th scope="col">Assisted</th>
                  <th scope="col">Applied/debugged</th>
                  <th scope="col">Next review</th>
                </tr>
              </thead>
              <tbody>
                {concepts.map((concept) => (
                  <tr key={concept.conceptId}>
                    <th scope="row" className={styles.conceptCell}>
                      <span className={styles.conceptTitle}>{concept.title}</span>
                      <code className={styles.conceptId}>{concept.conceptId}</code>
                    </th>
                    <td>
                      <StatusChip tone={STATUS_TONE[concept.status]}>
                        {STATUS_LABEL[concept.status]}
                      </StatusChip>
                    </td>
                    <td>{concept.independentPasses}</td>
                    <td>{concept.assistedPasses}</td>
                    <td>{concept.applicationOrDebugPasses}</td>
                    <td>{concept.nextDueAt ? formatDue(concept.nextDueAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
