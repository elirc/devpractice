import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { FixedClock } from '../../src/lib/clock.js';
import { hashPassword } from '../../src/lib/password.js';
import { normalizeEmail } from '../../src/lib/tokens.js';
// Import the header NAME rather than repeating it: a hardcoded copy here made
// the API tests agree with the server while the real client disagreed, so a
// 403 on every write went unnoticed by 23 green integration tests.
import { CSRF_HEADER } from '../../src/plugins/csrf.js';
import { testDatabaseUrl } from './db.js';

export const TEST_ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: 'test',
    PORT: '3999',
    APP_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: testDatabaseUrl(),
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  return { ...base, ...overrides };
}

export interface TestApp {
  app: FastifyInstance;
  clock: FixedClock;
  config: AppConfig;
}

export async function buildTestApp(
  db: PrismaClient,
  clock: FixedClock = new FixedClock(),
  configOverrides: Partial<AppConfig> = {},
): Promise<TestApp> {
  const config = testConfig(configOverrides);
  const app = await buildApp({ config, db, clock });
  await app.ready();
  return { app, clock, config };
}

/** Create an owner directly, bypassing the interactive bootstrap command. */
export async function createOwner(
  db: PrismaClient,
  email: string,
  password = 'correct-horse-battery-staple',
): Promise<{ id: string; email: string; password: string }> {
  const user = await db.user.create({
    data: {
      normalizedEmail: normalizeEmail(email),
      displayEmail: email,
      passwordHash: await hashPassword(password),
    },
  });
  return { id: user.id, email, password };
}

/**
 * An authenticated client: performs the real CSRF + login handshake and then
 * replays the session cookie and session-bound CSRF token on every request,
 * exactly as the browser does.
 */
export class Client {
  private cookies = new Map<string, string>();
  private csrfToken = '';

  constructor(private readonly app: FastifyInstance) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private captureCookies(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of list) {
      const [pair] = entry.split(';');
      const idx = pair?.indexOf('=') ?? -1;
      if (!pair || idx < 0) continue;
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) {
    const response = await this.app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie: this.cookieHeader(),
        ...(this.csrfToken ? { [CSRF_HEADER]: this.csrfToken } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    this.captureCookies(response.headers as Record<string, unknown>);
    return response;
  }

  async login(email: string, password: string) {
    const csrf = await this.request('GET', '/api/v1/auth/csrf');
    this.captureCookies(csrf.headers as Record<string, unknown>);
    const preToken = (csrf.json() as { data: { csrfToken: string } }).data.csrfToken;

    const response = await this.request('POST', '/api/v1/auth/login', {
      email,
      password,
      csrfToken: preToken,
    });

    if (response.statusCode === 200) {
      this.csrfToken = (response.json() as { data: { csrfToken: string } }).data.csrfToken;
    }
    return response;
  }

  /** Simulate a device that never signed in. */
  clearSession(): void {
    this.cookies.clear();
    this.csrfToken = '';
  }
}

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
