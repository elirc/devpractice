import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { InlineMarkdown, Markdown } from '../../components/Markdown';
import { Button, Callout, Card, PageHeader, StatusChip } from '../../components/Ui';
import { usePlacement, useSubmitPlacement } from '../../lib/queries';
import { ApiRequestError } from '../../lib/api';
import type { PlacementResultDto } from '../../lib/types';
import styles from './Placement.module.css';

type Answers = Record<string, { selectedOptionIds?: string[]; text?: string }>;

/**
 * Chapter placement (spec 3.5). No hints or solutions appear before
 * submission, and a repeat attempt on an already-revealed version is practice
 * only — the screen says so plainly rather than implying fresh evidence.
 */
export default function PlacementPage(): JSX.Element {
  const { chapterId = '' } = useParams();
  const { data, isPending, isError, error, refetch } = usePlacement(chapterId);
  const submit = useSubmitPlacement(chapterId);
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<PlacementResultDto | null>(null);
  const [index, setIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (isPending) return <LoadingState label="Loading assessment" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  // Captured after the guards so the hoisted handlers below see a narrowed value.
  const assessment = data;
  const item = data.items[index];
  const answered = Object.keys(answers).length;

  function setChoice(itemId: string, optionId: string, mode: 'single' | 'multiple'): void {
    setAnswers((current) => {
      const existing = current[itemId]?.selectedOptionIds ?? [];
      const next =
        mode === 'single'
          ? [optionId]
          : existing.includes(optionId)
            ? existing.filter((id) => id !== optionId)
            : [...existing, optionId];
      return { ...current, [itemId]: { ...current[itemId], selectedOptionIds: next } };
    });
  }

  async function onSubmit(): Promise<void> {
    setSubmitError(null);
    try {
      const outcome = await submit.mutateAsync({
        assessmentVersionId: assessment.assessmentVersionId,
        answers,
      });
      setResult(outcome);
    } catch (caught) {
      setSubmitError(
        caught instanceof ApiRequestError ? caught.message : 'The assessment could not be submitted.',
      );
    }
  }

  if (result) {
    return (
      <div>
        <PageHeader title={`${data.chapterTitle} — result`} />
        <Card>
          <div className={styles.resultHeader}>
            <StatusChip tone={result.qualified ? 'success' : 'neutral'}>
              {result.score} of {result.total} correct
            </StatusChip>
            {result.qualified ? (
              <StatusChip tone="info" icon="⇥">
                Chapter placed out
              </StatusChip>
            ) : null}
            {result.practiceOnly ? (
              <StatusChip tone="warning">Practice only — no new placement evidence</StatusChip>
            ) : null}
          </div>

          {result.practiceOnly ? (
            <Callout tone="warning" title="This attempt was practice">
              The answers for this assessment version were already revealed to you, so repeating it
              cannot produce fresh placement evidence. A different authored version would be needed
              for that.
            </Callout>
          ) : null}

          {!result.qualified ? (
            <Callout tone="info" title="You can still move on">
              Placement is optional. You may work through the chapter&apos;s lessons, or skip ahead
              manually at any time.
            </Callout>
          ) : null}

          <h2>Item feedback</h2>
          {result.itemResults.map((entry, position) => (
            <section key={entry.itemId} className={styles.feedback}>
              <h3>
                Question {position + 1}{' '}
                <StatusChip tone={entry.correct ? 'success' : 'danger'}>
                  {entry.correct ? 'Correct' : 'Incorrect'}
                </StatusChip>
                {entry.critical ? <StatusChip tone="warning">Critical</StatusChip> : null}
              </h3>
              <Markdown source={entry.explanationMarkdown} />
            </section>
          ))}

          <div className={styles.actions}>
            <Link to={`/learn/chapters/${chapterId}`}>
              <Button variant="primary">Back to chapter</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <p className={styles.breadcrumb}>
        <Link to={`/learn/chapters/${chapterId}`}>{data.chapterTitle}</Link>
      </p>
      <PageHeader title={data.title} />

      <Callout tone="info" title="How this works">
        <p>
          {data.items.length} questions. You need at least {data.qualification.minimumCorrect}{' '}
          correct
          {data.qualification.requireAllCritical
            ? ', and every question marked critical must be right'
            : ''}
          . No hints or solutions are shown until you submit.
        </p>
      </Callout>

      {data.placedOut ? (
        <Callout tone="neutral" title="Already placed out">
          You have already placed out of this chapter. Taking it again will not change that.
        </Callout>
      ) : null}

      {data.practiceOnly ? (
        <Callout tone="warning" title="Practice only">
          You have already seen the answers to this assessment version, so this attempt is practice
          and will not record new placement evidence.
        </Callout>
      ) : null}

      <Card>
        <div className={styles.progressRow}>
          <span>
            Question {index + 1} of {data.items.length}
          </span>
          <span className={styles.muted}>{answered} answered</span>
        </div>

        {item ? (
          <fieldset className={styles.fieldset}>
            <legend className="srOnly">Question {index + 1}</legend>
            <Markdown source={item.promptMarkdown} />

            {item.options ? (
              <ul className={styles.options}>
                {item.options.map((option) => {
                  const selected =
                    answers[item.id]?.selectedOptionIds?.includes(option.id) ?? false;
                  const inputType = item.optionMode === 'multiple' ? 'checkbox' : 'radio';
                  return (
                    <li key={option.id}>
                      <label className={styles.option}>
                        <input
                          type={inputType}
                          name={`item-${item.id}`}
                          checked={selected}
                          onChange={() => setChoice(item.id, option.id, item.optionMode ?? 'single')}
                        />
                        <InlineMarkdown source={option.textMarkdown} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <label className={styles.textLabel}>
                <span className="srOnly">Your answer</span>
                <textarea
                  className={styles.textarea}
                  rows={6}
                  value={answers[item.id]?.text ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [item.id]: { ...current[item.id], text: event.target.value },
                    }))
                  }
                />
              </label>
            )}
          </fieldset>
        ) : null}

        {submitError ? (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            Previous
          </Button>
          {index < data.items.length - 1 ? (
            <Button onClick={() => setIndex((i) => i + 1)}>Next</Button>
          ) : (
            <Button
              variant="primary"
              disabled={submit.isPending}
              onClick={() => void onSubmit()}
            >
              {submit.isPending ? 'Submitting…' : 'Submit assessment'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
