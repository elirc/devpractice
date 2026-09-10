import { useRef, useState } from 'react';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Button, Callout, Card, PageHeader, StatusChip } from '../../components/Ui';
import { Dialog } from '../../components/Dialog';
import { ApiRequestError } from '../../lib/api';
import {
  useActivateRelease,
  useImportContent,
  usePublishImport,
  useReleases,
  useSettings,
} from '../../lib/queries';
import { formatDateTime } from '../../lib/format';
import type { ImportDraftDto, ReleaseDto } from '../../lib/types';
import styles from './Content.module.css';

const CHANGE_TONE = {
  added: 'success',
  changed: 'warning',
  archived: 'danger',
  unchanged: 'neutral',
} as const;

export default function ContentPage(): JSX.Element {
  const releases = useReleases();
  const settings = useSettings();
  const importPackage = useImportContent();
  const publish = usePublishImport();
  const activate = useActivateRelease();

  const [draft, setDraft] = useState<ImportDraftDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingActivate, setPendingActivate] = useState<ReleaseDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File): Promise<void> {
    setErrorMessage(null);
    setMessage(null);
    setDraft(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await importPackage.mutateAsync(parsed);
      setDraft(result);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMessage('That file is not valid JSON.');
      } else if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('The package could not be read.');
      }
    }
  }

  async function onPublish(): Promise<void> {
    if (!draft) return;
    setErrorMessage(null);
    try {
      const release = await publish.mutateAsync({
        importId: draft.importId,
        checksum: draft.checksum,
        baseReleaseId: draft.baseReleaseId,
      });
      setMessage(`Published ${release.title} (${release.packageVersion}).`);
      setDraft(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'RELEASE_CONFLICT') {
        setErrorMessage(
          'Another release was published since this draft was prepared. Re-import the package against the current release before publishing.',
        );
      } else {
        setErrorMessage(
          error instanceof ApiRequestError ? error.message : 'The release could not be published.',
        );
      }
    }
  }

  async function onActivate(): Promise<void> {
    if (!pendingActivate || !settings.data) return;
    setErrorMessage(null);
    try {
      await activate.mutateAsync({
        releaseId: pendingActivate.id,
        expectedRevision: settings.data.preferencesRevision,
      });
      setMessage(`Activated ${pendingActivate.title}.`);
      setPendingActivate(null);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiRequestError ? error.message : 'That release could not be activated.',
      );
    }
  }

  const blocking = draft?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = draft?.issues.filter((issue) => issue.severity === 'warning') ?? [];

  return (
    <div>
      <PageHeader
        title="Content"
        description="Import an authored package, review what it changes, then publish it."
      />

      <Callout tone="info" title="Packages are whole snapshots">
        <p>
          A package file describes the <strong>entire</strong> desired release, not just the parts
          you changed. Importing a single chapter on its own would archive everything else. Build
          the package with the content tool so existing chapters are carried through.
        </p>
      </Callout>

      {message ? (
        <Callout tone="success" title="Done">
          {message}
        </Callout>
      ) : null}
      {errorMessage ? (
        <Callout tone="danger" title="Not published">
          {errorMessage}
        </Callout>
      ) : null}

      <Card>
        <h2>Import a package</h2>
        <label className={styles.fileLabel} htmlFor="package-file">
          Content package (JSON, up to 10 MiB)
        </label>
        <input
          id="package-file"
          ref={fileRef}
          className={styles.file}
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        {importPackage.isPending ? <LoadingState label="Validating package" /> : null}
        <p className={styles.muted}>
          Importing only creates a draft. Nothing changes for learning until you publish.
        </p>
      </Card>

      {draft ? (
        <Card>
          <h2>Preview: {draft.title}</h2>
          <div className={styles.chips}>
            <StatusChip tone="neutral">{draft.packageId}</StatusChip>
            <StatusChip tone="neutral">v{draft.packageVersion}</StatusChip>
            <StatusChip tone="success">{draft.counts.added} added</StatusChip>
            <StatusChip tone="warning">{draft.counts.changed} changed</StatusChip>
            <StatusChip tone="danger">{draft.counts.archived} archived</StatusChip>
            <StatusChip tone="neutral">{draft.counts.unchanged} unchanged</StatusChip>
          </div>

          {draft.counts.masteryRevisionChanged > 0 ? (
            <Callout tone="warning" title="Behaviour changed on some items">
              {draft.counts.masteryRevisionChanged} item(s) changed what they require, so previous
              evidence no longer covers them. Existing attempts and XP are kept; those items will
              show updated practice.
            </Callout>
          ) : null}

          {blocking.length > 0 ? (
            <Callout tone="danger" title={`${blocking.length} blocking error(s)`}>
              <ul className={styles.issues}>
                {blocking.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <code>{issue.path}</code>
                    {issue.itemId ? (
                      <>
                        {' '}
                        (<code>{issue.itemId}</code>)
                      </>
                    ) : null}{' '}
                    — {issue.message}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {warnings.length > 0 ? (
            <Callout tone="warning" title={`${warnings.length} warning(s)`}>
              <ul className={styles.issues}>
                {warnings.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <code>{issue.path}</code> — {issue.message}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <div className={styles.tableWrap}>
            <table>
              <caption className="srOnly">Items changed by this package</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Change</th>
                  <th scope="col">Version</th>
                  <th scope="col">Behaviour</th>
                </tr>
              </thead>
              <tbody>
                {draft.changes
                  .filter((change) => change.change !== 'unchanged')
                  .map((change) => (
                    <tr key={change.itemId}>
                      <th scope="row" className={styles.itemCell}>
                        <span>{change.title}</span>
                        <code className={styles.itemId}>{change.itemId}</code>
                      </th>
                      <td>{change.kind}</td>
                      <td>
                        <StatusChip tone={CHANGE_TONE[change.change]}>{change.change}</StatusChip>
                      </td>
                      <td>
                        {change.fromVersion ?? '—'} → {change.toVersion ?? '—'}
                      </td>
                      <td>
                        {change.masteryRevisionChanged ? (
                          <StatusChip tone="warning">changed</StatusChip>
                        ) : (
                          <span className={styles.muted}>same</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={!draft.publishable || publish.isPending}
              onClick={() => void onPublish()}
            >
              {publish.isPending ? 'Publishing…' : 'Publish this release'}
            </Button>
            <Button onClick={() => setDraft(null)}>Discard draft</Button>
          </div>
          {!draft.publishable ? (
            <p className={styles.muted}>
              Fix the blocking errors in the package and import it again.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2>Release history</h2>
        {releases.isPending ? (
          <LoadingState label="Loading releases" />
        ) : releases.isError ? (
          <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
        ) : releases.data.length === 0 ? (
          <p className={styles.muted}>No releases yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <caption className="srOnly">Published content releases</caption>
              <thead>
                <tr>
                  <th scope="col">Release</th>
                  <th scope="col">State</th>
                  <th scope="col">Items</th>
                  <th scope="col">Published</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {releases.data.map((release) => (
                  <tr key={release.id}>
                    <th scope="row" className={styles.itemCell}>
                      <span>{release.title}</span>
                      <code className={styles.itemId}>
                        {release.packageId} v{release.packageVersion}
                      </code>
                    </th>
                    <td>
                      {release.isActive ? (
                        <StatusChip tone="success">Active</StatusChip>
                      ) : (
                        <StatusChip tone="neutral">{release.state}</StatusChip>
                      )}
                    </td>
                    <td>{release.itemCount}</td>
                    <td>{release.publishedAt ? formatDateTime(release.publishedAt) : '—'}</td>
                    <td>
                      {!release.isActive && release.state !== 'draft' ? (
                        <Button variant="quiet" onClick={() => setPendingActivate(release)}>
                          Activate
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={pendingActivate !== null}
        title="Activate this earlier release?"
        description="Learning content switches back to this release. Attempts recorded against newer versions are kept, not deleted."
        onClose={() => setPendingActivate(null)}
        footer={
          <>
            <Button onClick={() => setPendingActivate(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void onActivate()}>
              Activate release
            </Button>
          </>
        }
      >
        <p>
          <strong>{pendingActivate?.title}</strong>
        </p>
      </Dialog>
    </div>
  );
}
