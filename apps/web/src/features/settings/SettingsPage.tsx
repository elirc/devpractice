import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '@devpractice/contracts';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Button, Callout, Card, Field, PageHeader, StatusChip } from '../../components/Ui';
import { Dialog } from '../../components/Dialog';
import { ApiRequestError, apiSend } from '../../lib/api';
import { qk, useSettings } from '../../lib/queries';
import { applyTheme, type ThemePreference } from '../../lib/theme';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../auth/SessionProvider';
import styles from './Settings.module.css';

const THEMES: { id: ThemePreference; label: string; hint: string }[] = [
  { id: 'system', label: 'Match my system', hint: 'Follows your operating system setting' },
  { id: 'light', label: 'Light', hint: 'Always light' },
  { id: 'dark', label: 'Dark', hint: 'Always dark' },
];

export default function SettingsPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useSettings();
  const { signOut, refresh } = useSession();
  const queryClient = useQueryClient();
  const [timezone, setTimezone] = useState('');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const tzId = useId();
  const pwId = useId();

  useEffect(() => {
    if (data) {
      setTimezone(data.timezone);
      setTheme(data.theme);
    }
  }, [data]);

  if (isPending) return <LoadingState label="Loading settings" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  // Captured after the guards so the hoisted handlers below see a narrowed value.
  const settings = data;

  async function savePreferences(next: { timezone?: string; theme?: ThemePreference }): Promise<void> {
    setSaveError(null);
    setSaveMessage(null);
    try {
      await apiSend('PATCH', '/settings', {
        expectedRevision: settings.preferencesRevision,
        ...next,
      });
      setSaveMessage('Settings saved.');
      await queryClient.invalidateQueries({ queryKey: qk.settings });
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === 'REVISION_CONFLICT') {
        setSaveError(
          'Your settings changed on another device. The current values have been reloaded — try again.',
        );
        await queryClient.invalidateQueries({ queryKey: qk.settings });
      } else {
        setSaveError('Those settings could not be saved.');
      }
    }
  }

  async function revokeAll(): Promise<void> {
    setRevokeError(null);
    try {
      await apiSend('POST', '/auth/revoke-all', { password });
      setPassword('');
      setRevokeOpen(false);
      await signOut();
    } catch {
      setRevokeError('That password did not match. Sessions were not revoked.');
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />

      {saveMessage ? (
        <Callout tone="success" title="Saved">
          {saveMessage}
        </Callout>
      ) : null}
      {saveError ? (
        <Callout tone="danger" title="Not saved">
          {saveError}
        </Callout>
      ) : null}

      <Card>
        <h2>Account</h2>
        <p className={styles.row}>
          <span className={styles.muted}>Email</span>
          <span>{data.email}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.muted}>Session expires</span>
          <span>{formatDateTime(data.sessionExpiresAt)}</span>
        </p>
        <p className={styles.row}>
          <span className={styles.muted}>Active content release</span>
          <span>
            {data.activeReleaseId ? (
              <code>{data.activeReleaseId}</code>
            ) : (
              <StatusChip tone="warning">none published</StatusChip>
            )}
          </span>
        </p>
      </Card>

      <Card>
        <h2>Appearance</h2>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Theme</legend>
          {THEMES.map((option) => (
            <label key={option.id} className={styles.choice}>
              <input
                type="radio"
                name="theme"
                checked={theme === option.id}
                onChange={() => {
                  setTheme(option.id);
                  // Apply immediately so the choice is visible while it saves.
                  applyTheme(option.id);
                  void savePreferences({ theme: option.id });
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <span className={styles.hint}>{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card>
        <h2>Time zone</h2>
        <Field
          label="Display time zone"
          htmlFor={tzId}
          hint="Used to display dates. Scheduling itself is always computed in UTC on the server."
        >
          <input
            id={tzId}
            className={styles.input}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </Field>
        <Button variant="primary" onClick={() => void savePreferences({ timezone })}>
          Save time zone
        </Button>
      </Card>

      <Card>
        <h2>Your data</h2>
        <p className={styles.muted}>
          The export is a portability convenience. It is not a substitute for a database backup.
        </p>
        <a href={`${API_BASE}/exports/progress`} download>
          <Button>Export progress as JSON</Button>
        </a>
      </Card>

      <Card>
        <h2>Sessions</h2>
        <div className={styles.actions}>
          <Button onClick={() => void signOut()}>Sign out on this device</Button>
          <Button variant="danger" onClick={() => setRevokeOpen(true)}>
            Sign out everywhere
          </Button>
        </div>
      </Card>

      <Dialog
        open={revokeOpen}
        title="Sign out of every device?"
        description="Confirm your password. Every session, including this one, is revoked."
        onClose={() => setRevokeOpen(false)}
        footer={
          <>
            <Button onClick={() => setRevokeOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void revokeAll()}>
              Revoke all sessions
            </Button>
          </>
        }
      >
        <Field label="Current password" htmlFor={pwId} error={revokeError ?? undefined}>
          <input
            id={pwId}
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </Dialog>
    </div>
  );
}
