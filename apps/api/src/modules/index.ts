import type { FastifyInstance } from 'fastify';

/**
 * Route registration surface. Every module exports one registrar with this
 * shape; server.ts registers them all under /api/v1.
 *
 * Modules are owned by different workstreams, so this file lists them and
 * nothing else — add a module by adding one import and one entry.
 */
export type RouteModule = (app: FastifyInstance) => Promise<void> | void;

import { registerAuthRoutes } from './auth/routes.js';
import { registerSettingsRoutes } from './settings/routes.js';
import { registerNotesRoutes } from './notes/routes.js';
import { registerBookmarksRoutes } from './bookmarks/routes.js';
import { registerDraftsRoutes } from './drafts/routes.js';
import { registerActivityRoutes } from './activity/routes.js';
import { registerMissionsRoutes } from './missions/routes.js';
import { registerExportsRoutes } from './exports/routes.js';
import { registerHealthRoutes } from './health/routes.js';

import { registerTodayRoutes } from './today/routes.js';
import { registerCurriculumRoutes } from './curriculum/routes.js';
import { registerLessonsRoutes } from './lessons/routes.js';
import { registerExercisesRoutes } from './exercises/routes.js';
import { registerAttemptsRoutes } from './attempts/routes.js';
import { registerPlacementsRoutes } from './placements/routes.js';
import { registerReviewsRoutes } from './reviews/routes.js';
import { registerProgressRoutes } from './progress/routes.js';
import { registerImportsRoutes } from './imports/routes.js';

export const routeModules: RouteModule[] = [
  registerHealthRoutes,
  registerAuthRoutes,
  registerSettingsRoutes,
  registerNotesRoutes,
  registerBookmarksRoutes,
  registerDraftsRoutes,
  registerActivityRoutes,
  registerMissionsRoutes,
  registerExportsRoutes,
  registerTodayRoutes,
  registerCurriculumRoutes,
  registerLessonsRoutes,
  registerExercisesRoutes,
  registerAttemptsRoutes,
  registerPlacementsRoutes,
  registerReviewsRoutes,
  registerProgressRoutes,
  registerImportsRoutes,
];
