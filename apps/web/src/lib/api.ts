import {
  API_BASE,
  CSRF_HEADER,
  type ApiError,
  type ErrorCode,
  type PageMeta,
} from '@devpractice/contracts';

/**
 * Same-origin API client (spec 9.1, 9.4, 6).
 *
 * - Cookies carry the session; no token is ever placed in localStorage.
 * - Every state-changing request sends the session-bound CSRF token.
 * - Every mutation carries a clientEventId so a retry can never double-count.
 * - A 401 is broadcast, not thrown away: the shell shows a sign-in prompt and
 *   KEEPS unsaved editor text (spec 6).
 */

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
    /** Conflict responses carry the server's current record. */
    readonly detail?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  get isConflict(): boolean {
    return (
      this.code === 'REVISION_CONFLICT' ||
      this.code === 'IDEMPOTENCY_CONFLICT' ||
      this.code === 'RELEASE_CONFLICT'
    );
  }
}

/** Network/parse failure — distinct from a structured API error. */
export class ApiTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTransportError';
  }
}

/* ----------------------------- CSRF handling ----------------------------- */

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Obtain a short-lived pre-session token before submitting credentials. */
export async function fetchLoginCsrfToken(): Promise<string> {
  const { csrfToken: token } = await apiGet<{ csrfToken: string }>('/auth/csrf');
  csrfToken = token;
  return token;
}

/* --------------------------- session expiry bus -------------------------- */

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function broadcastSessionExpired(): void {
  csrfToken = null;
  for (const listener of sessionExpiredListeners) listener();
}

/* ------------------------------ core request ----------------------------- */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Set for the login call, which uses a pre-session token. */
  csrfOverride?: string;
}

interface Envelope<T> {
  data: T;
  meta?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (!SAFE_METHODS.has(method)) {
    const token = options.csrfOverride ?? csrfToken;
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiTransportError('Could not reach the server.');
  }

  if (response.status === 204) return { data: undefined as T };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new ApiTransportError('The server returned an unreadable response.');
    throw new ApiRequestError('INTERNAL_ERROR', 'The server returned an error.', response.status);
  }

  if (!response.ok) {
    const body = payload as ApiError & Record<string, unknown>;
    const err = body?.error;
    if (response.status === 401) broadcastSessionExpired();
    throw new ApiRequestError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'The request failed.',
      response.status,
      err?.fieldErrors,
      err as unknown as Record<string, unknown>,
      err?.requestId,
    );
  }

  return payload as Envelope<T>;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const { data } = await request<T>(path, signal ? { signal } : {});
  return data;
}

export async function apiGetPage<T>(
  path: string,
  signal?: AbortSignal,
): Promise<{ data: T; meta: PageMeta }> {
  const result = await request<T>(path, signal ? { signal } : {});
  return {
    data: result.data,
    meta: (result.meta as PageMeta) ?? { nextCursor: null, hasMore: false },
  };
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  csrfOverride?: string,
): Promise<T> {
  const { data } = await request<T>(path, {
    method,
    ...(body === undefined ? {} : { body }),
    ...(csrfOverride ? { csrfOverride } : {}),
  });
  return data;
}

/**
 * Fresh id for every mutation so a retried request is recognised as the same
 * event by the server rather than credited twice (spec 9.1).
 */
export function newClientEventId(): string {
  return crypto.randomUUID();
}
