import type { FastifyInstance } from 'fastify';
import { settingsPatchSchema } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { narrowTheme } from '../auth/service.js';

/**
 * Owner preferences. Uses the same expectedRevision discipline as notes and
 * drafts, so two devices editing settings cannot silently overwrite each other
 * (spec 9.4).
 */
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/settings', async (request, reply) => {
    const owner = requireOwner(request);
    const user = await db.user.findUnique({
      where: { id: owner.userId },
      select: {
        displayEmail: true,
        timezone: true,
        theme: true,
        preferencesRevision: true,
        activeReleaseId: true,
        createdAt: true,
      },
    });
    if (!user) throw problem.unauthenticated();

    return ok(reply, {
      email: user.displayEmail,
      timezone: user.timezone,
      theme: narrowTheme(user.theme),
      revision: user.preferencesRevision,
      activeReleaseId: user.activeReleaseId,
      memberSince: user.createdAt.toISOString(),
    });
  });

  app.patch('/settings', async (request, reply) => {
    const owner = requireOwner(request);
    const body = parseOrThrow(settingsPatchSchema, request.body);

    if (body.timezone !== undefined && !isValidTimeZone(body.timezone)) {
      throw problem.badRequest('Unknown time zone.', { timezone: ['Unknown time zone.'] });
    }

    // Conditional update: the revision is the concurrency token, so a stale
    // client's write affects zero rows instead of clobbering a newer one.
    const updated = await db.user.updateMany({
      where: { id: owner.userId, preferencesRevision: body.expectedRevision },
      data: {
        ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
        ...(body.theme === undefined ? {} : { theme: body.theme }),
        preferencesRevision: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const current = await db.user.findUnique({
        where: { id: owner.userId },
        select: { timezone: true, theme: true, preferencesRevision: true, updatedAt: true },
      });
      if (!current) throw problem.unauthenticated();
      throw problem.revisionConflict('Settings changed on another device.', {
        server: { timezone: current.timezone, theme: narrowTheme(current.theme) },
        serverRevision: current.preferencesRevision,
        serverUpdatedAt: current.updatedAt.toISOString(),
      });
    }

    const fresh = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
      select: { timezone: true, theme: true, preferencesRevision: true },
    });
    return ok(reply, {
      timezone: fresh.timezone,
      theme: narrowTheme(fresh.theme),
      revision: fresh.preferencesRevision,
    });
  });
}

/** Validate against the runtime's own tz database rather than a hardcoded list. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
