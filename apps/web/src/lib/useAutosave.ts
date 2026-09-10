import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '../config';
import { ApiRequestError, ApiTransportError } from './api';
import type { SaveIndicatorState } from '../features/practice/contract';

/**
 * Debounced autosave with strict revision discipline (spec 9.4).
 *
 * Rules this implements, all of them load-bearing:
 *  - at most ONE in-flight write per document;
 *  - if the owner keeps typing while a save is running, the NEWEST text is
 *    queued and sent after acknowledgement — stale intermediate writes are
 *    never sent concurrently;
 *  - every write carries expectedRevision; the server's new revision is
 *    adopted only on success;
 *  - "Saved" is shown only after the server acknowledges;
 *  - a 409 keeps the local text, surfaces the server's text, and stops
 *    autosaving until the owner resolves it. There is no last-write-wins.
 */

export interface ConflictInfo<T> {
  serverValue: T;
  serverRevision: number;
  serverUpdatedAt: string | null;
}

export interface AutosaveOptions<T> {
  /** Persist the value. Resolves with the server's new revision. */
  save: (value: T, expectedRevision: number) => Promise<{ revision: number }>;
  initialValue: T;
  initialRevision: number;
  /** Extracts the server's record from a 409 response body. */
  parseConflict?: (error: ApiRequestError) => ConflictInfo<T> | null;
  equals?: (a: T, b: T) => boolean;
  debounceMs?: number;
  enabled?: boolean;
}

export interface AutosaveController<T> {
  value: T;
  setValue: (next: T) => void;
  state: SaveIndicatorState;
  revision: number;
  conflict: ConflictInfo<T> | null;
  errorMessage: string | null;
  /** True when there is unpersisted text — drives the navigation guard. */
  isDirty: boolean;
  /** Force a write now (explicit Save button, or before navigating away). */
  flush: () => Promise<void>;
  retry: () => void;
  /** Conflict resolutions. */
  keepServer: () => void;
  overwriteWithLocal: () => void;
  mergeManually: (merged: T) => void;
  /** Adopt a value fetched from the server without marking the doc dirty. */
  resetTo: (value: T, revision: number) => void;
}

function defaultEquals<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

export function useAutosave<T>(options: AutosaveOptions<T>): AutosaveController<T> {
  const {
    save,
    initialValue,
    initialRevision,
    parseConflict,
    equals = defaultEquals,
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    enabled = true,
  } = options;

  const [value, setValueState] = useState<T>(initialValue);
  const [state, setState] = useState<SaveIndicatorState>('idle');
  const [revision, setRevision] = useState(initialRevision);
  const [conflict, setConflict] = useState<ConflictInfo<T> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Last value the server acknowledged — the dirty comparison baseline. */
  const savedValueRef = useRef<T>(initialValue);
  const revisionRef = useRef(initialRevision);
  const inFlightRef = useRef(false);
  /** Newest text waiting for the in-flight save to finish. */
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runSave = useCallback(
    async (candidate: T): Promise<void> => {
      if (blockedRef.current) return;
      if (inFlightRef.current) {
        // Queue the newest text; do not open a second concurrent write.
        pendingRef.current = candidate;
        return;
      }
      if (equals(candidate, savedValueRef.current)) {
        if (mountedRef.current) setState('saved');
        return;
      }

      inFlightRef.current = true;
      if (mountedRef.current) {
        setState('saving');
        setErrorMessage(null);
      }

      try {
        const result = await save(candidate, revisionRef.current);
        savedValueRef.current = candidate;
        revisionRef.current = result.revision;
        if (mountedRef.current) {
          setRevision(result.revision);
          // "Saved" only after acknowledgement.
          setState('saved');
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'REVISION_CONFLICT') {
          const info = parseConflict?.(error) ?? null;
          blockedRef.current = true;
          pendingRef.current = null;
          if (mountedRef.current) {
            setConflict(info);
            setState('conflict');
            setErrorMessage(
              'This document changed on another device. Your text is kept below — choose which version to keep.',
            );
          }
        } else if (error instanceof ApiRequestError && error.code === 'UNAUTHENTICATED') {
          // Session expiry must never destroy the draft (spec 6).
          if (mountedRef.current) {
            setState('unsaved');
            setErrorMessage('Your session expired. Sign in again — your text is still here.');
          }
        } else {
          const message =
            error instanceof ApiTransportError
              ? 'Could not reach the server. Your text is still here.'
              : error instanceof ApiRequestError
                ? error.message
                : 'The save failed. Your text is still here.';
          if (mountedRef.current) {
            setState('unsaved');
            setErrorMessage(message);
          }
        }
      } finally {
        inFlightRef.current = false;
        const queued = pendingRef.current;
        pendingRef.current = null;
        if (queued !== null && !blockedRef.current) {
          // Send only the newest queued text, once the previous write settled.
          void runSave(queued);
        }
      }
    },
    [equals, parseConflict, save],
  );

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      if (!enabled) return;
      if (equals(next, savedValueRef.current)) {
        setState('saved');
      } else {
        setState('unsaved');
      }
      if (blockedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void runSave(next);
      }, debounceMs);
    },
    [debounceMs, enabled, equals, runSave],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await runSave(value);
  }, [runSave, value]);

  const retry = useCallback(() => {
    setErrorMessage(null);
    void runSave(value);
  }, [runSave, value]);

  const keepServer = useCallback(() => {
    if (!conflict) return;
    savedValueRef.current = conflict.serverValue;
    revisionRef.current = conflict.serverRevision;
    blockedRef.current = false;
    setValueState(conflict.serverValue);
    setRevision(conflict.serverRevision);
    setConflict(null);
    setErrorMessage(null);
    setState('saved');
  }, [conflict]);

  const overwriteWithLocal = useCallback(() => {
    if (!conflict) return;
    // Adopt the server's revision so the write applies to current state, then
    // re-send the owner's reviewed text.
    revisionRef.current = conflict.serverRevision;
    setRevision(conflict.serverRevision);
    blockedRef.current = false;
    setConflict(null);
    setErrorMessage(null);
    void runSave(value);
  }, [conflict, runSave, value]);

  const mergeManually = useCallback(
    (merged: T) => {
      if (!conflict) return;
      revisionRef.current = conflict.serverRevision;
      setRevision(conflict.serverRevision);
      blockedRef.current = false;
      setConflict(null);
      setErrorMessage(null);
      setValueState(merged);
      void runSave(merged);
    },
    [conflict, runSave],
  );

  const resetTo = useCallback((next: T, nextRevision: number) => {
    savedValueRef.current = next;
    revisionRef.current = nextRevision;
    blockedRef.current = false;
    pendingRef.current = null;
    setValueState(next);
    setRevision(nextRevision);
    setConflict(null);
    setErrorMessage(null);
    setState('idle');
  }, []);

  const isDirty = !equals(value, savedValueRef.current);

  return {
    value,
    setValue,
    state,
    revision,
    conflict,
    errorMessage,
    isDirty,
    flush,
    retry,
    keepServer,
    overwriteWithLocal,
    mergeManually,
    resetTo,
  };
}
