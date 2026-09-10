import type { ContentPackage } from '@devpractice/contracts';
import { err, warn, type Inventory, type Issue } from './types.js';

/**
 * Release inventory and the exercise-diversity minimums (spec §11.4, §2.2).
 * These make acceptance A17 mechanically checkable instead of a claim.
 */

export interface ReleaseTarget {
  label: string;
  chapters: number;
  lessons: number;
  lessonExercises: number;
  reviewCards: number;
  assessments: number;
  placementItems: number;
  missions: number;
  /** Minimums that stop everything collapsing into multiple choice. */
  minRunnableFunction: number;
  minDebuggingOrCodeReview: number;
  minExplanationWithRubric: number;
}

export const RELEASE_TARGETS: Record<string, ReleaseTarget> = {
  v1: {
    label: 'V1 usable course',
    chapters: 12,
    lessons: 36,
    lessonExercises: 108,
    reviewCards: 72,
    assessments: 12,
    placementItems: 60,
    missions: 3,
    minRunnableFunction: 20,
    minDebuggingOrCodeReview: 24,
    minExplanationWithRubric: 12,
  },
  v2: {
    label: 'V2 deeper Node.js practice',
    chapters: 20,
    lessons: 60,
    lessonExercises: 180,
    reviewCards: 120,
    assessments: 20,
    placementItems: 100,
    missions: 8,
    minRunnableFunction: 34,
    minDebuggingOrCodeReview: 40,
    minExplanationWithRubric: 20,
  },
  v3: {
    label: 'V3 C# and .NET',
    chapters: 30,
    lessons: 90,
    lessonExercises: 270,
    reviewCards: 180,
    assessments: 30,
    placementItems: 150,
    missions: 12,
    minRunnableFunction: 50,
    minDebuggingOrCodeReview: 60,
    minExplanationWithRubric: 30,
  },
};

const DEBUG_TYPES = new Set(['code-reading']);

export function buildInventory(pkg: ContentPackage): Inventory {
  const inventory: Inventory = {
    tracks: 0,
    chapters: 0,
    lessons: 0,
    lessonExercises: 0,
    reviewCards: 0,
    assessments: 0,
    placementItems: 0,
    missions: 0,
    diversity: {
      runnableFunction: 0,
      debuggingOrCodeReview: 0,
      explanationWithRubric: 0,
      choice: 0,
      predictOutput: 0,
      localProject: 0,
    },
  };

  for (const item of pkg.items) {
    switch (item.kind) {
      case 'track':
        inventory.tracks += 1;
        break;
      case 'chapter':
        inventory.chapters += 1;
        break;
      case 'lesson':
        inventory.lessons += 1;
        break;
      case 'review_card':
        inventory.reviewCards += 1;
        break;
      case 'assessment':
        inventory.assessments += 1;
        inventory.placementItems += item.items.length;
        break;
      case 'mission':
        inventory.missions += 1;
        break;
      case 'exercise': {
        inventory.lessonExercises += 1;
        // Categories intentionally OVERLAP: one exercise can be both a runnable
        // function and a debugging task. They are counted independently.
        if (item.grading.kind === 'function-cases') inventory.diversity.runnableFunction += 1;
        if (item.grading.kind === 'choice') inventory.diversity.choice += 1;
        if (item.grading.kind === 'predict-output') inventory.diversity.predictOutput += 1;
        if (item.grading.kind === 'rubric') inventory.diversity.explanationWithRubric += 1;
        if (DEBUG_TYPES.has(item.type) || /\b(bug|defect|repair|fix|diagnos|debug|review)\b/i.test(item.title)) {
          inventory.diversity.debuggingOrCodeReview += 1;
        }
        if (item.type === 'local-project') inventory.diversity.localProject += 1;
        break;
      }
    }
  }

  return inventory;
}

export function checkInventoryAgainstTarget(
  inventory: Inventory,
  target: ReleaseTarget,
): Issue[] {
  const issues: Issue[] = [];
  const compare = (
    actual: number,
    expected: number,
    field: string,
    kind: 'exact' | 'minimum',
  ): void => {
    const failed = kind === 'exact' ? actual !== expected : actual < expected;
    if (!failed) return;
    const relation = kind === 'exact' ? 'expected exactly' : 'expected at least';
    issues.push(
      err(
        `inventory.${field}`,
        `inventory.${field}`,
        `${target.label}: ${relation} ${expected} ${field}, found ${actual}`,
      ),
    );
  };

  compare(inventory.chapters, target.chapters, 'chapters', 'minimum');
  compare(inventory.lessons, target.lessons, 'lessons', 'minimum');
  compare(inventory.lessonExercises, target.lessonExercises, 'lessonExercises', 'minimum');
  compare(inventory.reviewCards, target.reviewCards, 'reviewCards', 'minimum');
  compare(inventory.assessments, target.assessments, 'assessments', 'minimum');
  compare(inventory.placementItems, target.placementItems, 'placementItems', 'minimum');
  compare(inventory.missions, target.missions, 'missions', 'minimum');
  compare(inventory.diversity.runnableFunction, target.minRunnableFunction, 'diversity.runnableFunction', 'minimum');
  compare(inventory.diversity.debuggingOrCodeReview, target.minDebuggingOrCodeReview, 'diversity.debuggingOrCodeReview', 'minimum');
  compare(inventory.diversity.explanationWithRubric, target.minExplanationWithRubric, 'diversity.explanationWithRubric', 'minimum');

  // Three exercises and two cards per lesson is the authored shape (spec §3.1).
  if (inventory.lessons > 0) {
    const perLesson = inventory.lessonExercises / inventory.lessons;
    if (Math.abs(perLesson - 3) > 0.001) {
      issues.push(
        warn(
          'inventory.exercises-per-lesson',
          'inventory.lessonExercises',
          `expected 3 exercises per lesson, found ${perLesson.toFixed(2)} on average`,
        ),
      );
    }
    const cardsPerLesson = inventory.reviewCards / inventory.lessons;
    if (Math.abs(cardsPerLesson - 2) > 0.001) {
      issues.push(
        warn(
          'inventory.cards-per-lesson',
          'inventory.reviewCards',
          `expected 2 review cards per lesson, found ${cardsPerLesson.toFixed(2)} on average`,
        ),
      );
    }
  }

  return issues;
}
