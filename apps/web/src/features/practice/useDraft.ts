import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveIndicatorState } from './contract.js';
import { ApiCallError, saveDraft } from './api.js';

/**
 * Debounced draft autosave with revision checking (spec 9.4, 4.3).
 *
 * - one in-flight write per document; newer text is queued, not raced
 * - "Saved" is shown only after the server acknowledges
 * - a conflict keeps the local text AND the server text so neither is lost
 * - a failed save keeps the editor content and offers Retry
 */

export interface DraftConflict {
  serverSource: string;
  serverRevision: number;
  serverUpdatedAt: string;
}

export interface UseDraftResult {
  source: string;
  setSource: (next: string) => void;
  state: SaveIndicatorState;
  conflict: DraftConflict | null;
  /** Retry after a failed save. */
  retry: () => void;
  /** Resolve a conflict by keeping one text at the server's current revision. */
  resolveConflict: (keep: 'mine' | 'server' | string) => void;
  /** True when there is unsaved text (drives the leave-page prompt). */
  dirty: boolean;
  saveNow: () => void;
}

const DEBOUNCE_MS = 1000;

export function useDraft(
  exerciseId: string,
  contentVersionId: string,
  initialSource: string,
  initialRevision: number,
  enabled: boolean,
): UseDraftResult {
  const [source, setSourceState] = useState(initialSource);
  const [state, setState] = useState<SaveIndicatorState>('idle');
  const [conflict, setConflict] = useState<DraftConflict | null>(null);

  const revisionRef = useRef(initialRevision);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const savedSourceRef = useRef(initialSource);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-seed when the exercise changes.
  useEffect(() => {
    setSourceState(initialSource);
    savedSourceRef.current = initialSource;
    revisionRef.current = initialRevision;
    setState('idle');
    setConflict(null);
    queuedRef.current = null;
  }, [exerciseId, initialSource, initialRevision]);

  const flush = useCallback(
    async (text: string): Promise<void> => {
      if (!enabled) return;
      inFlightRef.current = true;
      setState('saving');
      try {
        const result = await saveDraft(exerciseId, {
          source: text,
          expectedRevision: revisionRef.current,
          contentVersionId,
        });
        revisionRef.current = result.revision;
        savedSourceRef.current = text;
        setConflict(null);
        // Only now is it genuinely saved.
        setState(queuedRef.current === null ? 'saved' : 'saving');
      } catch (error) {
        if (error instanceof ApiCallError && error.code === 'REVISION_CONFLICT') {
          const payload = error.payload as
            | { error?: { server?: string; serverRevision?: number; serverUpdatedAt?: string } }
            | undefined;
          setConflict({
            serverSource: payload?.error?.server ?? '',
            serverRevision: payload?.error?.serverRevision ?? revisionRef.current,
            serverUpdatedAt: payload?.error?.serverUpdatedAt ?? new Date().toISOString(),
          });
          setState('conflict');
          queuedRef.current = null;
          return;
        }
        // Network or server failure: the text stays in the editor.
        setState('unsaved');
        queuedRef.current = null;
        return;
      } finally {
        inFlightRef.current = false;
      }

      const queued = queuedRef.current;
      if (queued !== null) {
        queuedRef.current = null;
        await flush(queued);
      }
    },
    [contentVersionId, enabled, exerciseId],
  );

  const scheduleSave = useCallback(
    (text: string) => {
      if (!enabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (inFlightRef.current) {
          queuedRef.current = text;
          return;
        }
        void flush(text);
      }, DEBOUNCE_MS);
    },
    [enabled, flush],
  );

  const setSource = useCallback(
    (next: string) => {
      setSourceState(next);
      if (next !== savedSourceRef.current) setState('unsaved');
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (inFlightRef.current) {
      queuedRef.current = source;
      return;
    }
    void flush(source);
  }, [flush, source]);

  const retry = useCallback(() => {
    saveNow();
  }, [saveNow]);

  const resolveConflict = useCallback(
    (keep: 'mine' | 'server' | string) => {
      if (!conflict) return;
      const text =
        keep === 'mine' ? source : keep === 'server' ? conflict.serverSource : keep;
      // Adopt the server's revision, then save the chosen text on top of it.
      revisionRef.current = conflict.serverRevision;
      setSourceState(text);
      setConflict(null);
      void flush(text);
    },
    [conflict, flush, source],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    source,
    setSource,
    state,
    conflict,
    retry,
    resolveConflict,
    dirty: source !== savedSourceRef.current,
    saveNow,
  };
}
