import { readFileSync } from 'node:fs';
import { CSRF_HEADER } from '@devpractice/contracts';

/**
 * Publish a built content package through the REAL API surface.
 *
 * This deliberately drives the same endpoints the owner uses in the Content
 * screen — CSRF handshake, sign-in, draft import, then an explicit publish —
 * rather than writing release rows directly. Local development and end-to-end
 * verification therefore exercise the same publication path as production
 * (spec 10.4), instead of a shortcut that could hide a defect in it.
 *
 * Usage:
 *   API_BASE=http://127.0.0.1:3001 \
 *   OWNER_EMAIL=... OWNER_PASSWORD=... \
 *   tsx src/scripts/publish-release.ts <package.json>
 */

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:3001';
const BASE = `${API_BASE}/api/v1`;
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';

const cookies = new Map<string, string>();

function storeCookies(response: Response): void {
  // Node exposes multiple Set-Cookie headers through getSetCookie().
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq < 0) continue;
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(): string {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(
  path: string,
  init: RequestInit & { csrf?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    cookie: cookieHeader(),
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    // Shared constant from contracts, so this script cannot drift from the
    // server the way the client did.
    ...(init.csrf ? { [CSRF_HEADER]: init.csrf } : {}),
  };
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  storeCookies(response);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep the raw text for diagnostics */
  }
  return { status: response.status, body };
}

function must(condition: boolean, message: string, detail?: unknown): void {
  if (!condition) {
    throw new Error(`${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  must(Boolean(file), 'Usage: publish-release.ts <package.json>');

  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  must(Boolean(email && password), 'Set OWNER_EMAIL and OWNER_PASSWORD.');

  const pkg: unknown = JSON.parse(readFileSync(file!, 'utf8'));

  const csrfResponse = await call('/auth/csrf');
  must(csrfResponse.status === 200, 'Could not obtain a CSRF token.', csrfResponse.body);
  const preToken = (csrfResponse.body as { data: { csrfToken: string } }).data.csrfToken;

  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, csrfToken: preToken }),
    csrf: preToken,
  });
  must(login.status === 200, 'Sign-in failed.', login.body);
  const sessionCsrf = (login.body as { data: { csrfToken: string } }).data.csrfToken;
  const activeReleaseId =
    (login.body as { data: { activeReleaseId: string | null } }).data.activeReleaseId ?? null;
  console.log(`Signed in. Active release: ${activeReleaseId ?? '(none)'}`);

  const draft = await call('/content/imports', {
    method: 'POST',
    body: JSON.stringify(pkg),
    csrf: sessionCsrf,
  });
  must(draft.status === 201 || draft.status === 200, 'Draft import failed.', draft.body);
  const draftData = (draft.body as { data: { importId: string; checksum: string; changeSummary?: unknown } })
    .data;
  console.log(`Draft imported: ${draftData.importId}`);
  console.log(`Change summary: ${JSON.stringify(draftData.changeSummary ?? {})}`);

  const published = await call(`/content/imports/${draftData.importId}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      expectedBaseReleaseId: activeReleaseId,
      checksum: draftData.checksum,
    }),
    csrf: sessionCsrf,
  });
  must(published.status === 200 || published.status === 201, 'Publish failed.', published.body);
  console.log(`Published: ${JSON.stringify(published.body)}`);

  const curriculum = await call('/curriculum');
  must(curriculum.status === 200, 'Curriculum read failed after publish.', curriculum.body);
  // GET /curriculum returns the track list directly as `data`.
  const tracks = (curriculum.body as { data?: unknown[] }).data ?? [];
  const chapters = (tracks as { chapters?: unknown[] }[]).reduce(
    (total, track) => total + (track.chapters?.length ?? 0),
    0,
  );
  console.log(`Curriculum now exposes ${tracks.length} track(s), ${chapters} chapter(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
