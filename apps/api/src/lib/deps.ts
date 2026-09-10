import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import type { Clock } from './clock.js';

/**
 * Application dependencies shared by every route module.
 *
 * Injected once by buildApp(). Route modules read them from `app.deps` (or the
 * getDeps() fallback) instead of importing the Prisma singleton directly, so
 * integration tests can supply a fixed clock and a disposable database.
 */
export interface AppDeps {
  config: AppConfig;
  db: PrismaClient;
  clock: Clock;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

let current: AppDeps | null = null;

export function setDeps(deps: AppDeps): void {
  current = deps;
}

export function getDeps(): AppDeps {
  if (!current) {
    throw new Error('Application dependencies are not initialised. Call buildApp() first.');
  }
  return current;
}
