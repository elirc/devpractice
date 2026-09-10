import { useId, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../../config';
import { ApiRequestError } from '../../lib/api';
import { Button, Field } from '../../components/Ui';
import { useSession } from './SessionProvider';
import styles from './Auth.module.css';

export function LoginPage(): JSX.Element {
  const { signIn, status } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/today';
    return <Navigate to={from} replace />;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/today';
      navigate(from, { replace: true });
    } catch (caught) {
      // The server returns a generic failure; do not invent detail here either.
      if (caught instanceof ApiRequestError && caught.code === 'RATE_LIMITED') {
        setError(caught.message);
      } else {
        setError('That email and password did not match.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>{APP_NAME}</h1>
        <p className={styles.tagline}>Private practice for web application engineering.</p>
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
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
          <Button type="submit" variant="primary" className={styles.submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className={styles.note}>
          This is a single-owner application. There is no public registration.
        </p>
      </div>
    </main>
  );
}
