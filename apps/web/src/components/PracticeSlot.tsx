import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import type { ExercisePanelProps } from '../features/practice/contract';
import { Callout } from './Ui';
import { LoadingState } from './StateViews';

/**
 * Boundary to the practice feature.
 *
 * The panel is resolved through import.meta.glob rather than a static import
 * so the shell builds and runs whether or not the practice module is present,
 * and so the editor/interpreter chunks stay lazy (spec 4.3, 14.3). The props
 * contract is fixed in features/practice/contract.ts.
 */

type PanelModule = { ExercisePanel: ComponentType<ExercisePanelProps> };

const panelModules = import.meta.glob<PanelModule>('../features/practice/ExercisePanel.tsx');

function PracticeUnavailable(): JSX.Element {
  return (
    <Callout tone="warning" title="Practice module not available">
      This build does not include the exercise runner, so this exercise cannot be attempted here.
      The lesson text and its worked example are still available above.
    </Callout>
  );
}

export function PracticeSlot(props: ExercisePanelProps): JSX.Element {
  const Panel = useMemo(() => {
    const loader = panelModules['../features/practice/ExercisePanel.tsx'];
    if (!loader) return null;
    return lazy(async () => {
      const mod = await loader();
      return { default: mod.ExercisePanel };
    });
  }, []);

  if (!Panel) return <PracticeUnavailable />;

  return (
    <Suspense fallback={<LoadingState label="Loading practice tools" />}>
      <Panel {...props} />
    </Suspense>
  );
}
