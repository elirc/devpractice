import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { API_BASE } from '@devpractice/contracts';
import { loadConfig, type AppConfig } from './config.js';
import { prisma as defaultPrisma } from './db/client.js';
import { systemClock, type Clock } from './lib/clock.js';
import { setDeps, type AppDeps } from './lib/deps.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { registerCsrfPlugin } from './plugins/csrf.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { LOG_REDACT_PATHS, registerRequestLogging } from './plugins/request-logging.js';
import { routeModules } from './modules/index.js';

export interface BuildAppOptions {
  config?: AppConfig;
  db?: PrismaClient;
  clock?: Clock;
}

/**
 * Build a configured Fastify instance WITHOUT listening.
 *
 * server.ts calls listen(); integration tests call app.inject(). Keeping the
 * two apart is what makes the acceptance suite able to rebuild the app against
 * the same database and prove progress is durable (A02).
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const db = options.db ?? defaultPrisma;
  const clock = options.clock ?? systemClock;
  const deps: AppDeps = { config, db, clock };
  setDeps(deps);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: LOG_REDACT_PATHS, remove: true },
    },
    // Bound the request body globally. Content import raises its own limit to
    // MAX_PACKAGE_BYTES on its route, which it has to: a real release package is
    // megabytes, and until that route-level limit existed, Fastify rejected the
    // body before the handler ran. The client saw only a dropped connection.
    bodyLimit: 1_048_576,
    trustProxy: config.isProduction,
    disableRequestLogging: true,
    genReqId: () => globalThis.crypto.randomUUID(),
  });

  app.decorate('deps', deps);

  await app.register(cookie);

  registerRequestLogging(app);
  registerAuthPlugin(app, { config, db, clock });
  registerCsrfPlugin(app, config);
  registerErrorHandler(app);

  // All API routes live under /api/v1 and are same-origin with the frontend.
  await app.register(
    async (scope) => {
      for (const registerModule of routeModules) {
        await registerModule(scope);
      }
    },
    { prefix: API_BASE },
  );

  await registerFrontend(app, config);

  return app;
}

/**
 * In production one Node service serves both the built frontend and /api.
 * The SPA fallback must never shadow an API route: unmatched /api paths keep
 * returning the JSON 404 envelope.
 */
async function registerFrontend(app: FastifyInstance, config: AppConfig): Promise<void> {
  const distDir = config.webDistDir
    ? resolve(config.webDistDir)
    : resolve(process.cwd(), '../web/dist');

  const hasFrontend = existsSync(distDir) && existsSync(join(distDir, 'index.html'));

  if (hasFrontend) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      index: ['index.html'],
      // Hashed assets are immutable; index.html must always be revalidated.
      setHeaders(res, path) {
        if (path.endsWith('index.html')) {
          res.setHeader('cache-control', 'no-cache');
        } else if (path.includes('assets')) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    });
  } else {
    app.log.info({ distDir }, 'frontend build not present; serving API only');
  }

  app.setNotFoundHandler((request, reply) => {
    // An unmatched API path is always a JSON 404 — the SPA never shadows /api.
    const isApi = request.url === API_BASE || request.url.startsWith(`${API_BASE}/`);
    if (isApi || !hasFrontend || request.method !== 'GET') {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Not found.', requestId: request.id },
      });
      return;
    }
    // Client-side route: hand back the shell and let the router resolve it.
    reply.type('text/html').header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });
}
