import { useBlocker } from 'react-router-dom';
import { Dialog } from './Dialog';
import { Button } from './Ui';
import { useUnsavedWork } from '../lib/unsaved';

/**
 * Stay-or-leave prompt for in-app navigation with unsaved text (spec 9.4).
 * Leaving is always possible — it is a choice, never a silent discard.
 */
export function NavigationGuard(): JSX.Element | null {
  const { hasUnsaved, labels } = useUnsavedWork();

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsaved && currentLocation.pathname !== nextLocation.pathname,
  );

  if (blocker.state !== 'blocked') return null;

  return (
    <Dialog
      open
      title="You have unsaved work"
      description="Leaving this screen now would discard text that has not been saved to the server."
      onClose={() => blocker.reset?.()}
      footer={
        <>
          <Button variant="primary" onClick={() => blocker.reset?.()}>
            Stay on this page
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Leave and discard
          </Button>
        </>
      }
    >
      <ul>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </Dialog>
  );
}
