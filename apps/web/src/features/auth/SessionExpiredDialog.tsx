import { useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, Callout, Field } from '../../components/Ui';
import { useSession } from './SessionProvider';
import styles from './Auth.module.css';

/**
 * Shown when a 401 arrives while the owner is working (spec 6).
 *
 * The route underneath stays mounted, so unsaved editor text and note drafts
 * remain on screen and can be saved as soon as the session is restored.
 */
export function SessionExpiredDialog(): JSX.Element | null {
  const { expired, signIn, status } = useSession();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  if (!expired || status !== 'authenticated') return null;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      setPassword('');
    } catch {
      setError('That email and password did not match. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Your session expired"
      onClose={() => undefined}
      footer={
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in and continue'}
        </Button>
      }
    >
      <Callout tone="info" title="Nothing was lost">
        Anything you typed is still on the page behind this dialog. Sign in again and save it.
      </Callout>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" htmlFor={emailId}>
          <input
            id={emailId}
            className={styles.input}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor={passwordId} error={error ?? undefined}>
          <input
            id={passwordId}
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <button type="submit" className="srOnly">
          Sign in
        </button>
      </form>
    </Dialog>
  );
}
