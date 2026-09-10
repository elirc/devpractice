/** Shared domain vocabulary used by the API, the web app and learning-core. */

export type LessonStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type Assistance = 'none' | 'hints' | 'solution_viewed';
export type GradingOrigin = 'server_objective' | 'browser_automated' | 'self_reported';
export type AttemptOutcome = 'passed' | 'failed' | 'needs_self_assessment';
export type ConceptStatus =
  | 'unseen'
  | 'practicing'
  | 'demonstrated'
  | 'retained'
  | 'review_due';

/** XP amounts (spec 3.7). Awarded once per unique award key. */
export const XP = {
  exerciseFirstPass: 10,
  lessonFirstCompletion: 20,
  missionFirstCompletion: 50,
  xpPerLevel: 250,
} as const;

export function levelForXp(totalXp: number): number {
  return Math.floor(totalXp / XP.xpPerLevel) + 1;
}

/** Review scheduler steps 0..5 -> interval in days (spec 3.6). */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 30] as const;
export const REVIEW_MAX_STEP = 5;
export const REVIEW_AGAIN_DELAY_MINUTES = 10;

export interface CurriculumTrackDto {
  id: string;
  title: string;
  description: string;
  targetOutcomes: string[];
  chapters: CurriculumChapterDto[];
}

export interface CurriculumChapterDto {
  id: string;
  title: string;
  sortOrder: number;
  objectiveIds: string[];
  lessonCount: number;
  completedLessonCount: number;
  placedOut: boolean;
  assessmentId: string;
  missionIds: string[];
  lessons: CurriculumLessonSummaryDto[];
}

export interface CurriculumLessonSummaryDto {
  id: string;
  title: string;
  sortOrder: number;
  estimatedMinutes: number;
  status: LessonStatus;
  /** True when required exercise mastery revisions moved past the completion. */
  updatedPracticeAvailable: boolean;
}

export interface ConceptEvidenceDto {
  conceptId: string;
  title: string;
  status: ConceptStatus;
  independentPasses: number;
  assistedPasses: number;
  applicationOrDebugPasses: number;
  successfulReviewDates: string[];
  nextDueAt: string | null;
}

export interface ProgressSummaryDto {
  totalXp: number;
  level: number;
  lessonsCompleted: number;
  lessonsSkipped: number;
  chaptersPlacedOut: number;
  missionsCompleted: number;
  reviewsDue: number;
  concepts: ConceptEvidenceDto[];
  assistance: {
    solutionRevealCount: number;
    hintRevealCount: number;
  };
}

export interface ActivityEventDto {
  id: string;
  kind: string;
  contentItemId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}
