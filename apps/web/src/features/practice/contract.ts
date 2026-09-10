import type { AttemptResult } from '@devpractice/contracts';

/**
 * Boundary between the app shell (routes, layout, navigation) and the practice
 * feature (editor, runner, exercise renderers). Both sides import this file and
 * neither modifies it.
 */

export type SaveIndicatorState = 'idle' | 'saving' | 'saved' | 'unsaved' | 'conflict';

export interface ExercisePanelProps {
  exerciseId: string;
  /** Rendered inside the lesson workspace (two-pane) or the focused route. */
  layout: 'lesson' | 'focused';
  /** Lets the shell refresh lesson/progress queries after an accepted attempt. */
  onAttemptRecorded?: (result: AttemptResult) => void;
  /** The shell shows the save state in its own chrome on mobile tabs. */
  onSaveStateChange?: (state: SaveIndicatorState) => void;
}

/** Implemented by the practice feature; rendered by the shell. */
export type ExercisePanelComponent = (props: ExercisePanelProps) => JSX.Element;

export interface ReviewCardPanelProps {
  cardId: string;
  onRated: () => void;
}
