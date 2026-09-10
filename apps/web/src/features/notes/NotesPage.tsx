import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { Button, Card, PageHeader, StatusChip } from '../../components/Ui';
import { Dialog } from '../../components/Dialog';
import { ApiRequestError, apiSend } from '../../lib/api';
import { qk, useBookmarks, useNotes } from '../../lib/queries';
import { formatDateTime } from '../../lib/format';
import type { NoteDto } from '../../lib/types';
import styles from './Notes.module.css';

export default function NotesPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const notes = useNotes(search);
  const bookmarks = useBookmarks();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<NoteDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await apiSend<void>('DELETE', `/notes/${pendingDelete.id}`, {
        expectedRevision: pendingDelete.revision,
      });
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: qk.notes(search) });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'REVISION_CONFLICT') {
        setDeleteError(
          'This note changed on another device since this list loaded. It was not deleted — reopen it to see the current version.',
        );
        await queryClient.invalidateQueries({ queryKey: qk.notes(search) });
      } else {
        setDeleteError('The note could not be deleted.');
      }
    }
  }

  return (
    <div>
      <PageHeader title="Notes and bookmarks" />

      <Card>
        <label className={styles.searchLabel} htmlFor="note-search">
          Search your notes
        </label>
        <input
          id="note-search"
          className={styles.search}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search titles and text"
        />
      </Card>

      <Card>
        <h2>Notes</h2>
        {notes.isPending ? (
          <LoadingState label="Loading notes" />
        ) : notes.isError ? (
          <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />
        ) : notes.data.data.length === 0 ? (
          <EmptyState
            title={search ? 'No notes match that search' : 'No notes yet'}
            description={
              search
                ? 'Try a different search term.'
                : 'Notes you write inside a lesson appear here and sync across your devices.'
            }
          />
        ) : (
          <ul className={styles.list}>
            {notes.data.data.map((note) => (
              <li key={note.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <h3 className={styles.itemTitle}>
                    {note.contentItemId ? (
                      <Link to={`/learn/lessons/${note.contentItemId}`}>{note.title}</Link>
                    ) : (
                      note.title
                    )}
                  </h3>
                  <div className={styles.itemMeta}>
                    {note.contentArchived ? (
                      <StatusChip tone="warning">Archived content</StatusChip>
                    ) : null}
                    <span className={styles.muted}>{formatDateTime(note.updatedAt)}</span>
                    <Button variant="quiet" onClick={() => setPendingDelete(note)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <p className={styles.body}>{note.body.slice(0, 400)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2>Bookmarks</h2>
        {bookmarks.isPending ? (
          <LoadingState label="Loading bookmarks" />
        ) : bookmarks.isError ? (
          <ErrorState error={bookmarks.error} onRetry={() => void bookmarks.refetch()} />
        ) : bookmarks.data.length === 0 ? (
          <EmptyState
            title="No bookmarks"
            description="Bookmark a lesson to keep it here for quick access."
          />
        ) : (
          <ul className={styles.list}>
            {bookmarks.data.map((bookmark) => (
              <li key={bookmark.contentItemId} className={styles.item}>
                <div className={styles.itemHead}>
                  <h3 className={styles.itemTitle}>
                    <Link to={`/learn/lessons/${bookmark.contentItemId}`}>{bookmark.title}</Link>
                  </h3>
                  <div className={styles.itemMeta}>
                    {bookmark.archived ? (
                      <StatusChip tone="warning">Archived content</StatusChip>
                    ) : null}
                    <StatusChip tone="neutral">{bookmark.kind}</StatusChip>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={pendingDelete !== null}
        title="Delete this note?"
        description="The note is removed from your list. This cannot be undone from here."
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete note
            </Button>
          </>
        }
      >
        <p>
          <strong>{pendingDelete?.title}</strong>
        </p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
