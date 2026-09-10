import type { ContentItem, ContentPackage } from '@devpractice/contracts';

/** A single validation finding. `path` is an exact JSON pointer-ish path. */
export interface Issue {
  severity: 'error' | 'warning';
  /** Stable machine-readable code, e.g. 'reference.missing'. */
  code: string;
  /** Exact location, e.g. 'items[12].grading.cases[3].expected'. */
  path: string;
  itemId?: string;
  message: string;
}

export interface Inventory {
  tracks: number;
  chapters: number;
  lessons: number;
  /** Exercises attached to a lesson. Placement items are NOT counted here. */
  lessonExercises: number;
  reviewCards: number;
  assessments: number;
  /** Individual questions inside assessments. */
  placementItems: number;
  missions: number;
  diversity: {
    runnableFunction: number;
    debuggingOrCodeReview: number;
    explanationWithRubric: number;
    choice: number;
    predictOutput: number;
    localProject: number;
  };
}

export interface SolutionCheck {
  exerciseId: string;
  /** Reference solution passed every case. */
  solutionPassed: boolean;
  /** Starter failed at least one case (or is a declared read-only example). */
  starterFailsAsExpected: boolean;
  starterExempt: boolean;
  /** Mutants that the grading cases correctly REJECTED. */
  mutantsRejected: string[];
  /** Mutants the grader wrongly accepted — each one is a gate failure. */
  mutantsAccepted: string[];
  skipped?: string;
}

export interface VerificationReport {
  runnerBackend: string;
  checks: SolutionCheck[];
}

export interface ValidationReport {
  ok: boolean;
  packageId: string;
  packageVersion: string;
  issues: Issue[];
  inventory: Inventory;
  verification?: VerificationReport;
}

export interface LoadedPackage {
  pkg: ContentPackage;
  /** Source file each item came from, for precise diagnostics. */
  sourceByItemId: Map<string, string>;
}

export type ItemsById = Map<string, ContentItem>;

export const err = (
  code: string,
  path: string,
  message: string,
  itemId?: string,
): Issue => ({ severity: 'error', code, path, message, ...(itemId ? { itemId } : {}) });

export const warn = (
  code: string,
  path: string,
  message: string,
  itemId?: string,
): Issue => ({ severity: 'warning', code, path, message, ...(itemId ? { itemId } : {}) });
