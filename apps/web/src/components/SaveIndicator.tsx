import type { SaveIndicatorState } from '../features/practice/contract';
import styles from './SaveIndicator.module.css';

/**
 * Save state, always as text plus a glyph (spec 4.3).
 * "Saved" appears only when the server has acknowledged the write.
 */
const LABEL: Record<SaveIndicatorState, string> = {
  idle: 'Not edited',
  saving: 'Saving',
  saved: 'Saved',
  unsaved: 'Unsaved',
  conflict: 'Conflict',
};

const ICON: Record<SaveIndicatorState, string> = {
  idle: '·',
  saving: '⟳',
  saved: '✓',
  unsaved: '●',
  conflict: '!',
};

export function SaveIndicator({ state }: { state: SaveIndicatorState }): JSX.Element {
  return (
    <span
      className={[styles.indicator, styles[state]].join(' ')}
      role="status"
      aria-live="polite"
    >
      <span className={styles.icon} aria-hidden="true">
        {ICON[state]}
      </span>
      {LABEL[state]}
    </span>
  );
}
