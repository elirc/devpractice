import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api';
import { useAutosave } from './useAutosave';

/**
 * The save rules from spec 9.4 are load-bearing for cross-device sync, so they
 * are tested as behaviour rather than through the UI.
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not report Saved until the server acknowledges', async () => {
    const gate = deferred<{ revision: number }>();
    const save = vi.fn().mockReturnValue(gate.promise);

    const { result } = renderHook(() =>
      useAutosave<string>({ save, initialValue: '', initialRevision: 1 }),
    );

    act(() => result.current.setValue('draft text'));
    expect(result.current.state).toBe('unsaved');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.state).toBe('saving');

    await act(async () => {
      gate.resolve({ revision: 2 });
      await gate.promise;
    });

    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(result.current.revision).toBe(2);
  });

  it('keeps one in-flight write and sends only the newest queued text', async () => {
    const first = deferred<{ revision: number }>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ revision: 3 });

    const { result } = renderHook(() =>
      useAutosave<string>({ save, initialValue: '', initialRevision: 1 }),
    );

    act(() => result.current.setValue('a'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Keep typing while the first write is still open.
    act(() => result.current.setValue('ab'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => result.current.setValue('abc'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Still only ONE request in flight.
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ revision: 2 });
      await first.promise;
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    // The intermediate 'ab' is never sent; only the newest text follows.
    expect(save.mock.calls[1]?.[0]).toBe('abc');
    expect(save.mock.calls.some((call) => call[0] === 'ab')).toBe(false);
  });

  it('sends the server revision it last accepted, not a client guess', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ revision: 7 })
      .mockResolvedValueOnce({ revision: 8 });

    const { result } = renderHook(() =>
      useAutosave<string>({ save, initialValue: '', initialRevision: 6 }),
    );

    act(() => result.current.setValue('one'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(result.current.revision).toBe(7));

    act(() => result.current.setValue('two'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(save.mock.calls[0]?.[1]).toBe(6);
    expect(save.mock.calls[1]?.[1]).toBe(7);
  });

  it('preserves local text on conflict and stops autosaving until resolved', async () => {
    const conflict = new ApiRequestError('REVISION_CONFLICT', 'stale', 409, undefined, {
      server: { body: 'server text' },
      serverRevision: 9,
      serverUpdatedAt: '2026-09-09T10:00:00.000Z',
    });
    const save = vi.fn().mockRejectedValue(conflict);

    const { result } = renderHook(() =>
      useAutosave<string>({
        save,
        initialValue: '',
        initialRevision: 1,
        parseConflict: (error) => ({
          serverValue: (error.detail?.['server'] as { body: string }).body,
          serverRevision: error.detail?.['serverRevision'] as number,
          serverUpdatedAt: error.detail?.['serverUpdatedAt'] as string,
        }),
      }),
    );

    act(() => result.current.setValue('my local text'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.state).toBe('conflict'));
    // Both texts survive.
    expect(result.current.value).toBe('my local text');
    expect(result.current.conflict?.serverValue).toBe('server text');

    // Further typing must not fire more writes while unresolved.
    act(() => result.current.setValue('more typing'));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keepServer adopts the server text and revision', async () => {
    const conflict = new ApiRequestError('REVISION_CONFLICT', 'stale', 409, undefined, {
      serverRevision: 9,
    });
    const save = vi.fn().mockRejectedValue(conflict);

    const { result } = renderHook(() =>
      useAutosave<string>({
        save,
        initialValue: '',
        initialRevision: 1,
        parseConflict: () => ({
          serverValue: 'server wins',
          serverRevision: 9,
          serverUpdatedAt: null,
        }),
      }),
    );

    act(() => result.current.setValue('local'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(result.current.state).toBe('conflict'));

    act(() => result.current.keepServer());

    expect(result.current.value).toBe('server wins');
    expect(result.current.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  it('overwriteWithLocal re-sends against the server revision', async () => {
    const conflict = new ApiRequestError('REVISION_CONFLICT', 'stale', 409, undefined, {});
    const save = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({ revision: 10 });

    const { result } = renderHook(() =>
      useAutosave<string>({
        save,
        initialValue: '',
        initialRevision: 1,
        parseConflict: () => ({ serverValue: 'theirs', serverRevision: 9, serverUpdatedAt: null }),
      }),
    );

    act(() => result.current.setValue('mine'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(result.current.state).toBe('conflict'));

    await act(async () => {
      result.current.overwriteWithLocal();
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toBe('mine');
    // The retry is applied on top of the server's current revision.
    expect(save.mock.calls[1]?.[1]).toBe(9);
  });

  it('keeps the draft and shows Unsaved when the session expires', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(new ApiRequestError('UNAUTHENTICATED', 'expired', 401));

    const { result } = renderHook(() =>
      useAutosave<string>({ save, initialValue: '', initialRevision: 1 }),
    );

    act(() => result.current.setValue('unsent work'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.state).toBe('unsaved'));
    expect(result.current.value).toBe('unsent work');
    expect(result.current.errorMessage).toMatch(/still here/i);
  });
});
