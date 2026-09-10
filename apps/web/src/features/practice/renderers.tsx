import { useId, useState } from 'react';
import type { AttemptResult } from '@devpractice/contracts';
import { Markdown } from './Markdown.js';
import type { ExerciseOptionView } from './api.js';
import styles from './practice.module.css';

/**
 * Non-code exercise renderers (spec 3.3).
 *
 * All of these are graded on the server; the client only collects the answer.
 * Explanation exercises are self-assessed against shown criteria — there is no
 * fake automated semantic grading.
 */

export interface RendererProps {
  submitting: boolean;
  feedback: AttemptResult | null;
  onSubmit: (answer: unknown, extra?: { selfAssessment?: 'met' | 'partially-met' | 'not-met' }) => void;
}

/* ------------------------------ choice ---------------------------------- */

export function ChoiceExercise({
  options,
  mode,
  submitting,
  feedback,
  onSubmit,
}: RendererProps & { options: ExerciseOptionView[]; mode: 'single' | 'multiple' }) {
  const groupId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const answered = feedback !== null;

  const toggle = (id: string) => {
    setSelected((current) => {
      if (mode === 'single') return [id];
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  };

  const explanations = feedback?.feedback.optionExplanations ?? {};

  return (
    <form
      className={styles.answerForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (selected.length > 0) onSubmit({ selectedOptionIds: selected });
      }}
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>
          {mode === 'single' ? 'Choose one answer' : 'Choose all that apply'}
        </legend>
        {options.map((option) => {
          const inputId = `${groupId}-${option.id}`;
          return (
            <div key={option.id} className={styles.option}>
              <input
                id={inputId}
                type={mode === 'single' ? 'radio' : 'checkbox'}
                name={groupId}
                value={option.id}
                checked={selected.includes(option.id)}
                disabled={submitting || answered}
                onChange={() => toggle(option.id)}
              />
              <label htmlFor={inputId}>
                <Markdown source={option.textMarkdown} />
              </label>
              {answered && explanations[option.id] ? (
                <div className={styles.optionExplanation}>
                  <Markdown source={explanations[option.id] ?? ''} />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      {!answered ? (
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={submitting || selected.length === 0}
        >
          {submitting ? 'Checking…' : 'Check answer'}
        </button>
      ) : null}
    </form>
  );
}

/* --------------------------- predict output ------------------------------ */

export function PredictOutputExercise({
  normalization,
  submitting,
  feedback,
  onSubmit,
}: RendererProps & {
  normalization: { trim: boolean; collapseWhitespace: boolean; caseSensitive: boolean };
}) {
  const inputId = useId();
  const [text, setText] = useState('');
  const answered = feedback !== null;

  return (
    <form
      className={styles.answerForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ text });
      }}
    >
      <label htmlFor={inputId} className={styles.fieldLabel}>
        What does this print?
      </label>
      <textarea
        id={inputId}
        className={styles.answerTextarea}
        value={text}
        rows={4}
        spellCheck={false}
        disabled={submitting || answered}
        onChange={(event) => setText(event.target.value)}
      />
      <p className={styles.caseNote}>
        Comparison{' '}
        {normalization.caseSensitive ? 'is case-sensitive' : 'ignores letter case'};{' '}
        {normalization.trim ? 'leading and trailing spaces are ignored' : 'spacing must match'}
        {normalization.collapseWhitespace ? '; repeated spaces are collapsed' : ''}.
      </p>
      {!answered ? (
        <button type="submit" className={styles.primaryButton} disabled={submitting || !text}>
          {submitting ? 'Checking…' : 'Check answer'}
        </button>
      ) : (
        <p className={styles.caseNote}>
          Expected: <code>{feedback?.feedback.expectedNormalized ?? ''}</code>
        </p>
      )}
    </form>
  );
}

/* ---------------------------- explanation -------------------------------- */

export function ExplanationExercise({
  criteria,
  modelAnswerMarkdown,
  submitting,
  feedback,
  onSubmit,
}: RendererProps & { criteria: string[]; modelAnswerMarkdown: string | null }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={styles.answerForm}>
      <label htmlFor={inputId} className={styles.fieldLabel}>
        Your answer
      </label>
      <textarea
        id={inputId}
        className={styles.answerTextarea}
        value={text}
        rows={6}
        disabled={submitting}
        onChange={(event) => setText(event.target.value)}
      />

      <h4 className={styles.resultsHeading}>What a good answer covers</h4>
      <ul className={styles.criteria}>
        {criteria.map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}
      </ul>

      {!revealed ? (
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!text.trim()}
          onClick={() => setRevealed(true)}
        >
          Compare with the model answer
        </button>
      ) : (
        <>
          {modelAnswerMarkdown ? (
            <div className={styles.solution}>
              <h4>Model answer</h4>
              <Markdown source={modelAnswerMarkdown} />
            </div>
          ) : null}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              How well did your answer meet the criteria? This is recorded as your own
              assessment, not an automated grade.
            </legend>
            <div className={styles.selfAssessRow}>
              {(['met', 'partially-met', 'not-met'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={styles.secondaryButton}
                  disabled={submitting || feedback !== null}
                  onClick={() => onSubmit({ text }, { selfAssessment: value })}
                >
                  {value === 'met' ? 'Met' : value === 'partially-met' ? 'Partly met' : 'Not met'}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {feedback ? (
        <p className={styles.caseNote}>
          Recorded as self-assessed. Self-assessed answers do not by themselves demonstrate a
          concept.
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------- local project ------------------------------- */

export function LocalProjectExercise({
  reason,
  missionId,
}: {
  reason: string;
  missionId: string | null;
}) {
  return (
    <div className={styles.localOnly}>
      <h3 className={styles.resultsHeading}>Practise this one in VS Code</h3>
      <p>{reason}</p>
      {missionId ? (
        <a className={styles.primaryLink} href={`/projects/${encodeURIComponent(missionId)}`}>
          Open the matching project mission
        </a>
      ) : (
        <p className={styles.caseNote}>See the Projects tab for the matching mission.</p>
      )}
    </div>
  );
}
