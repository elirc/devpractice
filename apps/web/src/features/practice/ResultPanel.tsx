import type { RunnerResponse } from '@devpractice/contracts';
import styles from './practice.module.css';

/**
 * Run results. Correctness is always text + icon, never colour alone
 * (spec 4.5). The screen-reader summary reports the headline, not every
 * console line.
 */

const STATUS_TEXT: Record<RunnerResponse['status'], string> = {
  passed: 'All cases passed',
  failed: 'Some cases did not pass',
  compile_error: 'The code did not compile',
  runtime_error: 'The code threw an error',
  timed_out: 'The code did not finish in time',
  cancelled: 'Run stopped',
  unsupported: 'This exercise cannot run here',
};

export function ResultPanel({ result }: { result: RunnerResponse | null }) {
  if (!result) return null;

  const passedCount = result.caseResults.filter((c) => c.passed).length;
  const total = result.caseResults.length;
  const headline = STATUS_TEXT[result.status];
  const summary =
    total > 0 ? `${headline}. ${passedCount} of ${total} cases passed.` : headline;

  return (
    <section className={styles.results} aria-labelledby="dp-results-heading">
      <h3 id="dp-results-heading" className={styles.resultsHeading}>
        Results
      </h3>

      {/* One concise announcement rather than the whole console. */}
      <p role="status" aria-live="polite" className={styles.resultSummary}>
        <span aria-hidden="true" className={styles.statusIcon}>
          {result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '!'}
        </span>{' '}
        {summary}
      </p>

      {result.message ? <p className={styles.resultMessage}>{result.message}</p> : null}

      {result.diagnostics.length > 0 ? (
        <ul className={styles.diagnostics}>
          {result.diagnostics
            .filter((d) => d.severity === 'error')
            .slice(0, 10)
            .map((d, index) => (
              <li key={`${d.line ?? 0}-${index}`}>
                {d.line !== undefined ? <b>Line {d.line}: </b> : null}
                {/* Rendered as text: runner output is never injected as HTML. */}
                {d.message}
              </li>
            ))}
        </ul>
      ) : null}

      {total > 0 ? (
        <ol className={styles.caseList}>
          {result.caseResults.map((c) => (
            <li key={c.caseId} className={styles.caseItem}>
              <span className={styles.caseStatus}>
                <span aria-hidden="true">{c.passed ? '✓' : '✗'}</span>{' '}
                {c.passed ? 'Passed' : 'Failed'}
              </span>
              <code className={styles.caseId}>{c.caseId}</code>
              {c.hidden ? <span className={styles.hiddenTag}>hidden case</span> : null}
              {c.inputMutated ? (
                <p className={styles.caseNote}>The input was changed. This exercise asks you not to modify it.</p>
              ) : null}
              {c.error ? <p className={styles.caseNote}>{c.error}</p> : null}
              {!c.hidden && !c.passed && c.expectedJson !== undefined ? (
                <div className={styles.caseDiff}>
                  <div>
                    <span className={styles.caseLabel}>Expected</span>
                    <pre className={styles.codeBlock}>{c.expectedJson}</pre>
                  </div>
                  <div>
                    <span className={styles.caseLabel}>Received</span>
                    <pre className={styles.codeBlock}>{c.actualJson ?? 'undefined'}</pre>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {result.consoleOutput.length > 0 ? (
        <details className={styles.console}>
          <summary>Console output ({result.consoleOutput.length} lines)</summary>
          <pre className={styles.codeBlock}>{result.consoleOutput.join('\n')}</pre>
          {result.consoleTruncated ? (
            <p className={styles.caseNote}>Output was truncated at the console limit.</p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
