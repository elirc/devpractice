import { z } from 'zod';

/**
 * Configuration contract (spec 15.2).
 *
 * Only genuinely public values ever reach a frontend build. Database URLs,
 * password material, CSRF secrets and session tokens stay server-side.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  /** Exact origin the browser uses. Origin checks compare against this. */
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  AUTH_COOKIE_NAME: z.string().min(1).max(60).default('dp_session'),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  IMPORT_MAX_BYTES: z.coerce.number().int().min(1024).default(10_485_760),
  RUNNER_TIMEOUT_MS: z.coerce.number().int().min(100).default(2000),
  RUNNER_MAX_SOURCE_BYTES: z.coerce.number().int().min(1024).default(65_536),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Directory holding the built frontend, served in production. */
  WEB_DIST_DIR: z.string().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  appOrigin: string;
  databaseUrl: string;
  logLevel: RawEnv['LOG_LEVEL'];
  webDistDir: string | undefined;
  session: {
    /** Host-only cookie. `__Host-` prefix in production requires Secure + Path=/. */
    cookieName: string;
    secure: boolean;
    absoluteMs: number;
    idleMs: number;
    /** lastSeenAt is written at most this often, to limit write amplification. */
    lastSeenThrottleMs: number;
  };
  login: {
    maxAttempts: number;
    windowMs: number;
  };
  limits: {
    importMaxBytes: number;
    draftMaxBytes: number;
    noteBodyMaxChars: number;
    noteTitleMaxChars: number;
    runnerTimeoutMs: number;
    runnerMaxSourceBytes: number;
    maxDraftSnapshots: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    webDistDir: env.WEB_DIST_DIR,
    session: {
      cookieName: isProduction ? `__Host-${env.AUTH_COOKIE_NAME}` : env.AUTH_COOKIE_NAME,
      secure: isProduction,
      absoluteMs: env.SESSION_ABSOLUTE_DAYS * DAY_MS,
      idleMs: env.SESSION_IDLE_DAYS * DAY_MS,
      lastSeenThrottleMs: 5 * 60 * 1000,
    },
    login: {
      maxAttempts: env.LOGIN_MAX_ATTEMPTS,
      windowMs: env.LOGIN_WINDOW_MINUTES * 60 * 1000,
    },
    limits: {
      importMaxBytes: env.IMPORT_MAX_BYTES,
      draftMaxBytes: 65_536,
      noteBodyMaxChars: 20_000,
      noteTitleMaxChars: 200,
      runnerTimeoutMs: env.RUNNER_TIMEOUT_MS,
      runnerMaxSourceBytes: env.RUNNER_MAX_SOURCE_BYTES,
      maxDraftSnapshots: 20,
    },
  };
}
