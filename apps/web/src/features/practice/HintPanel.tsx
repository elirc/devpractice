import { useState } from 'react';
import { Markdown } from './Markdown.js';
import styles from './practice.module.css';

/**
 * Progressive hints and the solution reveal (spec 4.3).
 *
 * Hints reveal in order with no blocking modal. The solution needs an explicit
 * action and states plainly that the attempt will be recorded as
 * solution-assisted — that record is permanent for this mastery revision.
 */

export interface HintPanelProps {
  hintCount: number;
  revealedHints: string[];
  solution: { code?: string; modelAnswer?: string; explanationMarkdown: string } | null;
  busy: boolean;
  onRevealHint: (index: number) => void;
  onRevealSolution: () => void;
}

export function HintPanel({
  hintCount,
  revealedHints,
  solution,
  busy,
  onRevealHint,
  onRevealSolution,
}: HintPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const nextHintIndex = revealedHints.length;
  const hintsRemaining = nextHintIndex < hintCount;

  return (
    <section className={styles.hints} aria-labelledby="dp-hints-heading">
      <h3 id="dp-hints-heading" className={styles.resultsHeading}>
        Stuck?
      </h3>

      {revealedHints.length > 0 ? (
        <ol className={styles.hintList}>
          {revealedHints.map((hint, index) => (
            <li key={index}>
              <span className={styles.hintLabel}>Hint {index + 1}</span>
              <Markdown source={hint} />
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.hintActions}>
        {hintsRemaining ? (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => onRevealHint(nextHintIndex)}
          >
            Show hint {nextHintIndex + 1} of {hintCount}
          </button>
        ) : (
          <p className={styles.caseNote}>All {hintCount} hints shown.</p>
        )}

        {solution ? null : confirming ? (
          <div className={styles.confirmRow} role="group" aria-label="Confirm solution reveal">
            <p className={styles.caseNote}>
              This attempt will be recorded as solution-assisted for this version of the
              exercise. Your earlier attempts are kept either way.
            </p>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onRevealSolution();
              }}
            >
              Yes, show the solution
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setConfirming(false)}
            >
              Keep trying
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Reveal solution
          </button>
        )}
      </div>

      {solution ? (
        <div className={styles.solution}>
          <h4>Solution</h4>
          {solution.code ? <pre className={styles.codeBlock}>{solution.code}</pre> : null}
          {solution.modelAnswer ? (
            <pre className={styles.codeBlock}>{solution.modelAnswer}</pre>
          ) : null}
          <Markdown source={solution.explanationMarkdown} />
        </div>
      ) : null}
    </section>
  );
}
