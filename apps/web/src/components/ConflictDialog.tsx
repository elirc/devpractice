import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { Button, Callout } from './Ui';
import styles from './ConflictDialog.module.css';

/**
 * Conflict resolution for text documents (spec 9.4, acceptance A04).
 *
 * BOTH texts stay recoverable. There is no last-write-wins and no automatic
 * merge: the owner chooses Keep server, Save my version, or edits a merge by
 * hand. Nothing is written until they choose.
 */
export function ConflictDialog({
  open,
  documentLabel,
  localText,
  serverText,
  serverUpdatedAt,
  onKeepServer,
  onKeepLocal,
  onMerge,
  onDismiss,
}: {
  open: boolean;
  documentLabel: string;
  localText: string;
  serverText: string;
  serverUpdatedAt: string | null;
  onKeepServer: () => void;
  onKeepLocal: () => void;
  onMerge: (merged: string) => void;
  onDismiss: () => void;
}): JSX.Element {
  const [merging, setMerging] = useState(false);
  const [mergeText, setMergeText] = useState(localText);

  useEffect(() => {
    if (open) {
      setMerging(false);
      setMergeText(localText);
    }
  }, [open, localText]);

  const stamp = serverUpdatedAt ? new Date(serverUpdatedAt).toLocaleString() : 'unknown time';

  return (
    <Dialog
      open={open}
      title={`${documentLabel} changed on another device`}
      description="Your text has not been overwritten. Compare the two versions and choose which to keep."
      onClose={onDismiss}
      footer={
        merging ? (
          <>
            <Button onClick={() => setMerging(false)}>Back</Button>
            <Button variant="primary" onClick={() => onMerge(mergeText)}>
              Save merged version
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onKeepServer}>Keep server version</Button>
            <Button onClick={() => setMerging(true)}>Merge manually</Button>
            <Button variant="primary" onClick={onKeepLocal}>
              Save my version
            </Button>
          </>
        )
      }
    >
      {merging ? (
        <label className={styles.mergeLabel}>
          <span className={styles.columnTitle}>Merged text</span>
          <textarea
            className={styles.mergeArea}
            value={mergeText}
            onChange={(event) => setMergeText(event.target.value)}
            rows={14}
            aria-label="Merged text"
          />
        </label>
      ) : (
        <>
          <Callout tone="warning" title="Both versions are kept">
            Saving one version does not delete the other from this screen until you choose.
          </Callout>
          <div className={styles.columns}>
            <section className={styles.column}>
              <h3 className={styles.columnTitle}>Your unsaved version</h3>
              <pre className={styles.text}>{localText || '(empty)'}</pre>
            </section>
            <section className={styles.column}>
              <h3 className={styles.columnTitle}>Server version</h3>
              <p className={styles.stamp}>Saved {stamp}</p>
              <pre className={styles.text}>{serverText || '(empty)'}</pre>
            </section>
          </div>
        </>
      )}
    </Dialog>
  );
}
