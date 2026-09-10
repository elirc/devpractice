import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Assert against the SHARED constant, not a local copy of the string: the
// previous local copy is exactly why a client/server header mismatch survived
// a green unit suite.
import { CSRF_HEADER } from '@devpractice/contracts';
import {
  ApiRequestError,
  ApiTransportError,
  apiGet,
  apiSend,
  newClientEventId,
  onSessionExpired,
  setCsrfToken,
} from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setCsrfToken(null);
  });

  it('unwraps the { data } envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'x' } })),
    );
    await expect(apiGet<{ id: string }>('/thing')).resolves.toEqual({ id: 'x' });
  });

  it('sends credentials same-origin and no CSRF header on GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('token-123');

    await apiGet('/thing');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined();
  });

  it('attaches the CSRF token to state-changing requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('token-123');

    await apiSend('POST', '/thing', { a: 1 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('token-123');
  });

  it('maps a structured error body to a typed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'REVISION_CONFLICT',
              message: 'stale',
              requestId: 'req-1',
              serverRevision: 4,
            },
          },
          409,
        ),
      ),
    );

    await expect(apiSend('PATCH', '/notes/1', {})).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 409,
      requestId: 'req-1',
    });
  });

  it('exposes conflict detail so both versions can be preserved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'REVISION_CONFLICT',
              message: 'stale',
              requestId: 'r',
              server: { body: 'theirs' },
              serverRevision: 4,
            },
          },
          409,
        ),
      ),
    );

    try {
      await apiSend('PATCH', '/notes/1', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      const typed = error as ApiRequestError;
      expect(typed.isConflict).toBe(true);
      expect(typed.detail?.['serverRevision']).toBe(4);
    }
  });

  it('broadcasts session expiry on 401 without throwing it away', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'r' } }, 401),
      ),
    );

    const listener = vi.fn();
    const off = onSessionExpired(listener);

    await expect(apiGet('/thing')).rejects.toBeInstanceOf(ApiRequestError);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('reports a network failure distinctly from an API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(apiGet('/thing')).rejects.toBeInstanceOf(ApiTransportError);
  });

  it('generates a distinct client event id per mutation', () => {
    const a = newClientEventId();
    const b = newClientEventId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
