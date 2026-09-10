import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { InlineMarkdown, Markdown } from '../../components/Markdown';
import { Button, Callout, Card, PageHeader, StatusChip } from '../../components/Ui';
import { useDueReviews, useSubmitReview } from '../../lib/queries';
import { ApiRequestError } from '../../lib/api';
import { formatDue, pluralize } from '../../lib/format';
import type { ReviewResponseResultDto } from '../../lib/types';
import styles from './Review.module.css';

const RATINGS = [
  { id: 'again', label: 'Again', hint: 'Did not recall' },
  { id: 'hard', label: 'Hard', hint: 'Recalled with effort' },
  { id: 'good', label: 'Good', hint: 'Recalled' },
  { id: 'easy', label: 'Easy', hint: 'Immediate' },
] as const;

export default function ReviewPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useDueReviews();
  const submit = useSubmitReview();
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ReviewResponseResultDto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const card = data?.cards[position];

  useEffect(() => {
    setRevealed(false);
    setSelected([]);
    setOutcome(null);
    setSubmitError(null);
  }, [card?.cardId]);

  if (isPending) return <LoadingState label="Loading review queue" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (data.cards.length === 0) {
    return (
      <div>
        <PageHeader title="Review" />
        <EmptyState
          title="Nothing is due"
          description="Cards enter the queue when you complete a lesson or add them explicitly. Come back when something is scheduled."
          action={<Link to="/learn">Back to learning</Link>}
        />
      </div>
    );
  }

  if (!card) {
    return (
      <div>
        <PageHeader title="Review" />
        <Card>
          <h2>Batch finished</h2>
          <p>
            You worked through this batch of {pluralize(data.cards.length, 'card')}.{' '}
            {data.remaining > 0
              ? `${data.remaining} more ${data.remaining === 1 ? 'is' : 'are'} still due.`
              : 'Nothing else is due right now.'}
          </p>
          <div className={styles.actions}>
            {data.remaining > 0 ? (
              <Button
                variant="primary"
                onClick={() => {
                  setPosition(0);
                  void refetch();
                }}
              >
                Continue reviewing
              </Button>
            ) : null}
            <Link to="/today">
              <Button>Back to today</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const isObjective = card.gradingOrigin === 'server_objective' && card.options !== null;

  async function rate(rating: 'again' | 'hard' | 'good' | 'easy'): Promise<void> {
    if (!card) return;
    setSubmitError(null);
    try {
      const result = await submit.mutateAsync({
        cardId: card.cardId,
        cardVersionId: card.cardVersionId,
        expectedRevision: card.revision,
        rating,
        ...(isObjective ? { selectedOptionIds: selected } : {}),
      });
      setOutcome(result);
      setRevealed(true);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === 'REVISION_CONFLICT') {
        setSubmitError(
          'This card was already reviewed on another device. Refreshing the queue so it is not scheduled twice.',
        );
        void refetch();
      } else {
        setSubmitError(
          caught instanceof ApiRequestError ? caught.message : 'That rating could not be recorded.',
        );
      }
    }
  }

  function toggleOption(optionId: string): void {
    if (!card) return;
    setSelected((current) =>
      card.optionMode === 'multiple'
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : [optionId],
    );
  }

  return (
    <div>
      <PageHeader
        title="Review"
        description="Overdue cards come first, then newly introduced ones."
        actions={
          <StatusChip tone="neutral">
            {position + 1} of {data.cards.length} · {data.totalDue} due
          </StatusChip>
        }
      />

      <Card>
        <div className={styles.cardMeta}>
          <Link to={`/learn/lessons/${card.lessonId}`} className={styles.lessonLink}>
            {card.lessonTitle}
          </Link>
          <span className={styles.chips}>
            {card.newlyIntroduced ? <StatusChip tone="info">New card</StatusChip> : null}
            <StatusChip tone="neutral">step {card.step}</StatusChip>
            <StatusChip tone="neutral">{formatDue(card.dueAt)}</StatusChip>
          </span>
        </div>

        <Markdown source={card.promptMarkdown} />

        {isObjective && card.options ? (
          <fieldset className={styles.fieldset} disabled={Boolean(outcome)}>
            <legend className="srOnly">Choose your answer</legend>
            <ul className={styles.options}>
              {card.options.map((option) => (
                <li key={option.id}>
                  <label className={styles.option}>
                    <input
                      type={card.optionMode === 'multiple' ? 'checkbox' : 'radio'}
                      name={`card-${card.cardId}`}
                      checked={selected.includes(option.id)}
                      onChange={() => toggleOption(option.id)}
                    />
                    <InlineMarkdown source={option.textMarkdown} />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {!revealed ? (
          <div className={styles.actions}>
            {isObjective ? (
              <Button
                variant="primary"
                disabled={selected.length === 0 || submit.isPending}
                onClick={() => void rate('good')}
              >
                Check answer
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setRevealed(true)}>
                Show answer
              </Button>
            )}
          </div>
        ) : null}

        {revealed ? (
          <div className={styles.answer}>
            <h2 className={styles.answerTitle}>Answer</h2>
            <Markdown source={outcome?.answerMarkdown ?? card.answerMarkdown} />
            <Markdown source={outcome?.explanationMarkdown ?? card.explanationMarkdown} />
          </div>
        ) : null}

        {outcome ? (
          <>
            <div className={styles.chips}>
              {outcome.correct === null ? (
                <StatusChip tone="neutral" icon="i">
                  Self-rated
                </StatusChip>
              ) : (
                <StatusChip tone={outcome.correct ? 'success' : 'danger'}>
                  {outcome.correct ? 'Correct' : 'Incorrect'}
                </StatusChip>
              )}
              <StatusChip tone="neutral">Rated {outcome.appliedRating}</StatusChip>
              <StatusChip tone="neutral">next {formatDue(outcome.state.dueAt)}</StatusChip>
            </div>
            {outcome.ratingWasForced ? (
              <Callout tone="warning" title="Rating adjusted">
                An incorrect answer schedules the card as <strong>Again</strong> regardless of the
                rating chosen.
              </Callout>
            ) : null}
          </>
        ) : null}

        {revealed && !outcome && !isObjective ? (
          <>
            <p className={styles.rateHint}>
              How well did you recall it? This is your own judgement, and is recorded as
              self-reported.
            </p>
            <div className={styles.actions}>
              {RATINGS.map((rating) => (
                <Button
                  key={rating.id}
                  disabled={submit.isPending}
                  onClick={() => void rate(rating.id)}
                >
                  <span>{rating.label}</span>
                  <span className="srOnly"> — {rating.hint}</span>
                </Button>
              ))}
            </div>
          </>
        ) : null}

        {submitError ? (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        ) : null}

        {outcome ? (
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setPosition((p) => p + 1)}>
              Next card
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
