import { CSRF_HEADER } from '@devpractice/contracts';
import { getCsrfToken } from '../../lib/api';
import type { AttemptResult } from '@devpractice/contracts';
import type { RunnerCase } from '@devpractice/contracts';

/**
 * Practice-feature API calls. The app shell owns the general API client; these
 * stay local to the feature so the two workstreams do not share a file.
 *
 * The session cookie is HttpOnly and same-origin. The runner worker never sees
 * these helpers, so learner code has no authenticated capability to reach.
 */

const BASE = '/api/v1';

export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

function csrfToken(): string {
  // Read the SAME in-memory token the shell holds. This used to look for a
  // `meta[name="dp-csrf-token"]` tag that nothing in the repo ever wrote, so
  // every practice write — attempts, hint and solution reveals, draft saves —
  // sent an empty token and got a 403.
  return getCsrfToken() ?? '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') headers.set(CSRF_HEADER, csrfToken());

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody = parsed as { error?: { code?: string; message?: string } } | null;
    throw new ApiCallError(
      errorBody?.error?.code ?? 'INTERNAL_ERROR',
      errorBody?.error?.message ?? 'Something went wrong.',
      response.status,
      parsed,
    );
  }
  return (parsed as { data: T }).data;
}

/* ------------------------------ view models ------------------------------ */

export type ExerciseType =
  | 'choice'
  | 'predict-output'
  | 'code-reading'
  | 'function'
  | 'explanation'
  | 'local-project';

export interface ExerciseOptionView {
  id: string;
  textMarkdown: string;
}

export interface ExerciseView {
  id: string;
  versionId: string;
  masteryRevision: number;
  lessonId: string;
  title: string;
  type: ExerciseType;
  difficulty: string;
  estimatedMinutes: number;
  promptMarkdown: string;
  /** Count only — bodies arrive through the reveal endpoint. */
  hintCount: number;
  /** Hints already revealed by this owner, in order. */
  revealedHints: string[];
  /** Present only after an explicit solution reveal. */
  revealedSolution: { code?: string; modelAnswer?: string; explanationMarkdown: string } | null;
  grading:
    | { kind: 'choice'; mode: 'single' | 'multiple'; options: ExerciseOptionView[] }
    | {
        kind: 'predict-output';
        normalization: { trim: boolean; collapseWhitespace: boolean; caseSensitive: boolean };
      }
    | {
        kind: 'function-cases';
        language: 'javascript' | 'typescript';
        entrypoint: string;
        starterCode: string;
        assertInputUnchanged: boolean;
        cases: RunnerCase[];
      }
    | { kind: 'rubric'; criteria: string[] };
  /** Saved editor draft, when one exists. */
  draft: { source: string; revision: number } | null;
  /** Set when the exercise cannot run in the browser (spec 3.3). */
  localOnly?: { reason: string; missionId: string | null };
}

/**
 * GET /exercises/:id returns `{ exercise, draft }` — the draft is a sibling of
 * the exercise, not a field on it. Flatten it here into the shape the panel
 * renders. Treating the envelope AS the exercise made `grading` undefined and
 * threw inside render, which unmounted the whole lesson route via the error
 * boundary, so the failure surfaced far away from its cause.
 */
export async function getExercise(exerciseId: string): Promise<ExerciseView> {
  const payload = await request<{
    exercise: Omit<ExerciseView, 'draft'>;
    draft: ExerciseView['draft'];
  }>(`/exercises/${encodeURIComponent(exerciseId)}`);
  return { ...payload.exercise, draft: payload.draft };
}

export interface RevealResponse {
  revealKind: 'hint' | 'solution';
  hintIndex?: number;
  hint?: string;
  solution?: { code?: string; modelAnswer?: string; explanationMarkdown: string };
}

export function revealHint(
  exerciseId: string,
  clientEventId: string,
  hintIndex: number,
): Promise<RevealResponse> {
  return request<RevealResponse>(`/exercises/${encodeURIComponent(exerciseId)}/reveals`, {
    method: 'POST',
    body: JSON.stringify({ clientEventId, revealKind: 'hint', hintIndex }),
  });
}

export function revealSolution(
  exerciseId: string,
  clientEventId: string,
): Promise<RevealResponse> {
  return request<RevealResponse>(`/exercises/${encodeURIComponent(exerciseId)}/reveals`, {
    method: 'POST',
    body: JSON.stringify({ clientEventId, revealKind: 'solution' }),
  });
}

export interface SubmitAttemptInput {
  clientEventId: string;
  exerciseId: string;
  exerciseVersionId: string;
  source?: string;
  answer?: unknown;
  gradingOrigin: 'server_objective' | 'browser_automated' | 'self_reported';
  runnerResult?: {
    status: string;
    passedCaseIds: string[];
    failedCaseIds: string[];
    durationMs: number;
    message?: string;
  };
  selfAssessment?: 'met' | 'partially-met' | 'not-met';
}

export function submitAttempt(input: SubmitAttemptInput): Promise<AttemptResult> {
  return request<AttemptResult>('/attempts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface DraftSaveResult {
  revision: number;
  updatedAt: string;
}

export function saveDraft(
  exerciseId: string,
  body: { source: string; expectedRevision: number; contentVersionId: string },
): Promise<DraftSaveResult> {
  return request<DraftSaveResult>(`/drafts/${encodeURIComponent(exerciseId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
