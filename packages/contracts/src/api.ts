import { z } from 'zod';

/** API envelope + shared request/response contracts (spec section 9). */

export const API_BASE = '/api/v1';

/**
 * CSRF header name, shared by the API, the web client, the practice feature and
 * the publish script. It lives here because two independent copies of this
 * string once drifted apart: reads kept working while EVERY state-changing
 * request 403'd, and both sides' tests passed because each asserted its own
 * copy. One constant, imported everywhere, makes that failure impossible.
 */
export const CSRF_HEADER = 'x-csrf-token';

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'RELEASE_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'CONTENT_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
}

export interface ApiSuccess<T, M = unknown> {
  data: T;
  meta?: M;
}

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RELEASE_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  CONTENT_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export const clientEventId = z.string().uuid();

export const paginationQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

/* --------------------------------- auth ---------------------------------- */

export const loginBodySchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1024),
  csrfToken: z.string().min(1).max(200),
});

export interface OwnerSummary {
  id: string;
  email: string;
  timezone: string;
  theme: 'system' | 'light' | 'dark';
  preferencesRevision: number;
  activeReleaseId: string | null;
  sessionExpiresAt: string;
  csrfToken: string;
}

/* ------------------------------- attempts -------------------------------- */

export const gradingOriginSchema = z.enum([
  'server_objective',
  'browser_automated',
  'self_reported',
]);
export const assistanceSchema = z.enum(['none', 'hints', 'solution_viewed']);

export const runnerResultSchema = z.object({
  status: z.enum([
    'passed',
    'failed',
    'compile_error',
    'runtime_error',
    'timed_out',
    'cancelled',
    'unsupported',
  ]),
  passedCaseIds: z.array(z.string()).max(50),
  failedCaseIds: z.array(z.string()).max(50).default([]),
  durationMs: z.number().int().min(0).max(600_000),
  message: z.string().max(2000).optional(),
});

export const attemptBodySchema = z.object({
  clientEventId,
  exerciseId: z.string().min(1).max(80),
  exerciseVersionId: z.string().uuid(),
  /** Source snapshot for code exercises; capped at 64 KiB (spec 8.3). */
  source: z.string().max(65_536).optional(),
  answer: z.unknown().optional(),
  gradingOrigin: gradingOriginSchema,
  runnerResult: runnerResultSchema.optional(),
  /** Learner's own judgement for rubric exercises. */
  selfAssessment: z.enum(['met', 'partially-met', 'not-met']).optional(),
});
export type AttemptBody = z.infer<typeof attemptBodySchema>;

export interface AttemptResult {
  attemptId: string;
  outcome: 'passed' | 'failed' | 'needs_self_assessment';
  assistance: 'none' | 'hints' | 'solution_viewed';
  gradingOrigin: 'server_objective' | 'browser_automated' | 'self_reported';
  /** Server-side detail for objectively graded exercises. */
  feedback: {
    correct?: boolean;
    selectedOptionIds?: string[];
    optionExplanations?: Record<string, string>;
    expectedNormalized?: string;
    caseResults?: { caseId: string; passed: boolean }[];
  };
  xpAwarded: number;
  createdAt: string;
}

/* ------------------------------- reveals --------------------------------- */

export const revealBodySchema = z.object({
  clientEventId,
  revealKind: z.enum(['hint', 'solution']),
  hintIndex: z.number().int().min(0).max(2).optional(),
});

/* -------------------------------- drafts --------------------------------- */

export const draftPutSchema = z.object({
  source: z.string().max(65_536),
  expectedRevision: z.number().int().min(0),
  contentVersionId: z.string().uuid(),
});

export interface ConflictPayload<T> {
  reason: 'revision_conflict';
  server: T;
  serverRevision: number;
  serverUpdatedAt: string;
}

/* -------------------------------- reviews -------------------------------- */

export const reviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);

export const reviewResponseSchema = z.object({
  clientEventId,
  cardVersionId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  rating: reviewRatingSchema,
  /** Present when the card is objectively graded. */
  selectedOptionIds: z.array(z.string()).max(8).optional(),
});

export interface ReviewStateDto {
  cardId: string;
  step: number;
  dueAt: string;
  lastReviewedAt: string | null;
  revision: number;
}

/* --------------------------------- notes --------------------------------- */

export const noteCreateSchema = z.object({
  clientEventId,
  contentItemId: z.string().max(80).nullable().default(null),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
});

export const notePatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(20_000).optional(),
  expectedRevision: z.number().int().min(0),
});

/* ------------------------------- missions -------------------------------- */

export const repositoryUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine((raw) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Never persist credentials embedded in a submitted URL (spec 8.3).
    return url.username === '' && url.password === '';
  }, 'repository url must be http(s) and contain no credentials');

export const missionProgressSchema = z.object({
  expectedRevision: z.number().int().min(0),
  checklist: z.record(z.boolean()),
  status: z.enum(['not_started', 'in_progress', 'completed']),
  repositoryUrl: repositoryUrlSchema.nullable().default(null),
  commitHash: z.string().regex(/^[0-9a-f]{7,64}$/i).nullable().default(null),
  report: z
    .object({
      testCommand: z.string().max(300).default(''),
      reportedOutcome: z.enum(['passing', 'failing', 'partial']).default('partial'),
      notes: z.string().max(8000).default(''),
    })
    .nullable()
    .default(null),
});

/* ------------------------------- settings -------------------------------- */

export const settingsPatchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  timezone: z.string().min(1).max(80).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
});

/* ------------------------------- placements ------------------------------ */

export const placementSubmitSchema = z.object({
  clientEventId,
  assessmentVersionId: z.string().uuid(),
  answers: z.record(
    z.object({
      selectedOptionIds: z.array(z.string()).max(8).optional(),
      text: z.string().max(4000).optional(),
      runnerResult: runnerResultSchema.optional(),
    }),
  ),
});

/* -------------------------------- lessons -------------------------------- */

export const lessonCompleteSchema = z.object({
  clientEventId,
  acknowledgedReading: z.literal(true),
});

export const lessonSkipSchema = z.object({ clientEventId });

export const enrollCardsSchema = z.object({ clientEventId });
