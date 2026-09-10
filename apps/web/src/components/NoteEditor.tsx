import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, apiGet, apiSend, newClientEventId } from '../lib/api';
import { useAutosave, type ConflictInfo } from '../lib/useAutosave';
import { useMarkUnsaved } from '../lib/unsaved';
import { qk } from '../lib/queries';
import type { NoteDto } from '../lib/types';
import { ConflictDialog } from './ConflictDialog';
import { SaveIndicator } from './SaveIndicator';
import { Button } from './Ui';
import styles from './NoteEditor.module.css';

/**
 * Autosaving note attached to a content item (spec 4.3, 9.4).
 *
 * The first keystroke creates the note; later edits PATCH with expectedRevision
 * so a second device cannot silently overwrite this one.
 */
export function NoteEditor({
  contentItemId,
  defaultTitle,
  label = 'Your notes',
}: {
  contentItemId: string;
  defaultTitle: string;
  label?: string;
}): JSX.Element {
  const [note, setNote] = useState<NoteDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const noteRef = useRef<NoteDto | null>(null);
  const queryClient = useQueryClient();
  const fieldId = useId();

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const result = await apiGet<NoteDto[]>(
          `/notes?contentItemId=${encodeURIComponent(contentItemId)}&limit=1`,
        );
        if (cancelled) return;
        const existing = result[0] ?? null;
        noteRef.current = existing;
        setNote(existing);
        setLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError ? error.message : 'Could not load your note.',
        );
        setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contentItemId]);

  const save = useCallback(
    async (body: string, expectedRevision: number): Promise<{ revision: number }> => {
      const current = noteRef.current;
      if (!current) {
        const created = await apiSend<NoteDto>('POST', '/notes', {
          clientEventId: newClientEventId(),
          contentItemId,
          title: defaultTitle.slice(0, 200),
          body,
        });
        noteRef.current = created;
        setNote(created);
        void queryClient.invalidateQueries({ queryKey: qk.notes('') });
        return { revision: created.revision };
      }
      const updated = await apiSend<NoteDto>('PATCH', `/notes/${current.id}`, {
        body,
        expectedRevision,
      });
      noteRef.current = updated;
      setNote(updated);
      void queryClient.invalidateQueries({ queryKey: qk.notes('') });
      return { revision: updated.revision };
    },
    [contentItemId, defaultTitle, queryClient],
  );

  const parseConflict = useCallback((error: ApiRequestError): ConflictInfo<string> | null => {
    const server = error.detail?.['server'] as NoteDto | undefined;
    const serverRevision = error.detail?.['serverRevision'];
    if (!server || typeof serverRevision !== 'number') return null;
    return {
      serverValue: server.body,
      serverRevision,
      serverUpdatedAt: (error.detail?.['serverUpdatedAt'] as string | undefined) ?? server.updatedAt,
    };
  }, []);

  const autosave = useAutosave<string>({
    save,
    initialValue: '',
    initialRevision: 0,
    parseConflict,
    enabled: loaded,
  });

  const { resetTo } = autosave;
  const seededRef = useRef(false);
  useEffect(() => {
    // Seed exactly once, from whatever the server had when this editor loaded.
    // Re-seeding later would reset the indicator to "Not edited" moments after
    // our own first save reported "Saved", and could clobber in-progress text.
    if (!loaded || seededRef.current) return;
    seededRef.current = true;
    resetTo(noteRef.current?.body ?? '', noteRef.current?.revision ?? 0);
  }, [loaded, resetTo]);

  // A different content item means a different document: allow a fresh seed.
  useEffect(() => {
    seededRef.current = false;
  }, [contentItemId]);

  // Leaving the page with unsaved note text should ask first.
  useMarkUnsaved(`note:${contentItemId}`, autosave.isDirty, `Note on ${defaultTitle}`);

  if (loadError) {
    return <p className={styles.error}>{loadError}</p>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
        <SaveIndicator state={autosave.state} />
      </div>
      <textarea
        id={fieldId}
        className={styles.textarea}
        value={autosave.value}
        onChange={(event) => autosave.setValue(event.target.value)}
        onBlur={() => void autosave.flush()}
        rows={6}
        placeholder="Notes are private to you and sync across your devices."
        disabled={!loaded}
      />
      {autosave.errorMessage ? (
        <p className={styles.error} role="alert">
          {autosave.errorMessage}{' '}
          {autosave.state === 'unsaved' ? (
            <Button variant="quiet" onClick={autosave.retry}>
              Retry
            </Button>
          ) : null}
        </p>
      ) : null}

      <ConflictDialog
        open={autosave.conflict !== null}
        documentLabel="This note"
        localText={autosave.value}
        serverText={autosave.conflict?.serverValue ?? ''}
        serverUpdatedAt={autosave.conflict?.serverUpdatedAt ?? null}
        onKeepServer={autosave.keepServer}
        onKeepLocal={autosave.overwriteWithLocal}
        onMerge={autosave.mergeManually}
        onDismiss={() => undefined}
      />
    </div>
  );
}
