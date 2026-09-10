import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { canonicalise } from '@devpractice/learning-core';

/**
 * A complete published release: one track, one chapter, two lessons with a
 * mixture of exercise types, review cards and a five-item placement
 * assessment. Written directly so the learning tests start from a known,
 * deterministic catalogue.
 */

export const TRACK_ID = 'track-web-foundations';
export const CHAPTER_ID = 'ch-arrays';
export const LESSON_ID = 'v1-l08';
export const LESSON_TWO_ID = 'v1-l09';
export const FN_EXERCISE_ID = 'js-arrays-filter-open';
export const CHOICE_EXERCISE_ID = 'js-arrays-filter-choice';
export const RUBRIC_EXERCISE_ID = 'js-arrays-filter-explain';
export const LESSON_TWO_EXERCISE_ID = 'js-arrays-group-count';
export const CARD_ID = 'card-array-filter-recall';
export const CARD_TWO_ID = 'card-array-filter-transfer';
export const ASSESSMENT_ID = 'assess-ch-arrays';
export const CONCEPT_ID = 'js.array-filter';

function checksum(payload: unknown): string {
  return createHash('sha256').update(canonicalise(payload)).digest('hex');
}

const base = (id: string, title: string) => ({
  id,
  version: 1,
  masteryRevision: 1,
  title,
  conceptIds: [CONCEPT_ID],
  prerequisiteIds: [],
});

export const FN_EXERCISE = {
  ...base(FN_EXERCISE_ID, 'Count open support tickets'),
  kind: 'exercise' as const,
  bodyMarkdown: 'Practice selecting records without changing the input.',
  lessonId: LESSON_ID,
  sortOrder: 0,
  type: 'function' as const,
  difficulty: 'foundation' as const,
  estimatedMinutes: 6,
  promptMarkdown: 'Return the number of tickets whose status is exactly open.',
  hints: [
    'Separate selecting matching tickets from counting them.',
    'Array.filter returns a new array containing matching records.',
    "Filter by ticket.status === 'open', then read the resulting length.",
  ] as [string, string, string],
  solution: {
    code: 'function countOpen(t){return t.filter(x=>x.status==="open").length;}',
    explanationMarkdown: 'Filtering selects matching records without changing the original array.',
  },
  grading: {
    kind: 'function-cases' as const,
    language: 'javascript' as const,
    entrypoint: 'countOpen',
    starterCode: 'function countOpen(tickets) { return 0; }',
    assertInputUnchanged: true,
    cases: [
      { id: 'empty', args: [[]], expected: 0, hidden: false },
      { id: 'mixed', args: [[{ status: 'open' }, { status: 'closed' }]], expected: 1, hidden: false },
      { id: 'all-closed', args: [[{ status: 'closed' }]], expected: 0, hidden: false },
    ],
  },
  primaryConceptId: CONCEPT_ID,
  requiredForLessonCompletion: true,
};

export const CHOICE_EXERCISE = {
  ...base(CHOICE_EXERCISE_ID, 'Which call selects without mutating?'),
  kind: 'exercise' as const,
  bodyMarkdown: 'Read the options carefully.',
  lessonId: LESSON_ID,
  sortOrder: 1,
  type: 'choice' as const,
  difficulty: 'foundation' as const,
  estimatedMinutes: 3,
  promptMarkdown: 'Which expression returns matching tickets without changing the input?',
  hints: ['One of these changes the array in place.', 'splice mutates.', 'filter returns a copy.'] as [
    string,
    string,
    string,
  ],
  solution: { modelAnswer: 'filter', explanationMarkdown: 'filter returns a new array.' },
  grading: {
    kind: 'choice' as const,
    mode: 'single' as const,
    options: [
      { id: 'filter', textMarkdown: 'tickets.filter(...)', correct: true, explanationMarkdown: 'Correct.' },
      { id: 'splice', textMarkdown: 'tickets.splice(...)', correct: false, explanationMarkdown: 'splice mutates.' },
      { id: 'push', textMarkdown: 'tickets.push(...)', correct: false, explanationMarkdown: 'push appends.' },
    ],
  },
  primaryConceptId: CONCEPT_ID,
  requiredForLessonCompletion: true,
};

export const RUBRIC_EXERCISE = {
  ...base(RUBRIC_EXERCISE_ID, 'Explain shallow copying'),
  kind: 'exercise' as const,
  bodyMarkdown: 'Write a short explanation.',
  lessonId: LESSON_ID,
  sortOrder: 2,
  type: 'explanation' as const,
  difficulty: 'core' as const,
  estimatedMinutes: 8,
  promptMarkdown: 'Explain why filter does not protect nested objects from mutation.',
  hints: ['Think about what is copied.', 'The array is new.', 'The elements are the same references.'] as [
    string,
    string,
    string,
  ],
  solution: { modelAnswer: 'The array is new; the elements are shared references.', explanationMarkdown: 'Shallow copy.' },
  grading: {
    kind: 'rubric' as const,
    criteria: ['Names the new array', 'Notes shared element references'],
    modelAnswerMarkdown: 'filter builds a new array whose elements are the same object references.',
  },
  primaryConceptId: CONCEPT_ID,
  requiredForLessonCompletion: true,
};

/**
 * Lesson two needs at least one exercise: the authored-content schema requires
 * `exerciseIds` to be non-empty, so a lesson with none makes the WHOLE package
 * fail structural validation before any rule under test is reached.
 */
export const LESSON_TWO_EXERCISE = {
  ...base(LESSON_TWO_EXERCISE_ID, 'Predict the grouped counts'),
  kind: 'exercise' as const,
  bodyMarkdown: 'Read the grouping code and predict what it prints.',
  lessonId: LESSON_TWO_ID,
  sortOrder: 0,
  type: 'predict-output' as const,
  difficulty: 'core' as const,
  estimatedMinutes: 4,
  promptMarkdown: 'What does the grouping snippet print for two open and one closed ticket?',
  hints: [
    'Work out which key each ticket contributes to.',
    'A missing key starts at zero before it is incremented.',
    'Two tickets share the open key; one is closed on its own.',
  ] as [string, string, string],
  solution: {
    modelAnswer: 'open=2 closed=1',
    explanationMarkdown: 'Each ticket increments the counter for its own status.',
  },
  grading: {
    kind: 'predict-output' as const,
    normalization: { trim: true, collapseWhitespace: true, caseSensitive: true },
    expected: 'open=2 closed=1',
    acceptedAlternatives: [],
  },
  primaryConceptId: CONCEPT_ID,
  requiredForLessonCompletion: true,
};

export const CARD_ONE = {
  ...base(CARD_ID, 'What does filter return?'),
  kind: 'review_card' as const,
  bodyMarkdown: 'Recall card.',
  lessonId: LESSON_ID,
  type: 'recall' as const,
  promptMarkdown: 'What does Array.prototype.filter return?',
  answerMarkdown: 'A new array containing the matching elements.',
  explanationMarkdown: 'The original array is untouched.',
  gradingOrigin: 'server_objective' as const,
  grading: {
    kind: 'choice' as const,
    mode: 'single' as const,
    options: [
      { id: 'new-array', textMarkdown: 'A new array', correct: true, explanationMarkdown: 'Correct.' },
      { id: 'same-array', textMarkdown: 'The same array', correct: false, explanationMarkdown: 'filter never mutates.' },
    ],
  },
  primaryConceptId: CONCEPT_ID,
};

export const CARD_TWO = {
  ...base(CARD_TWO_ID, 'Free recall: selecting records'),
  kind: 'review_card' as const,
  bodyMarkdown: 'Transfer card.',
  lessonId: LESSON_ID,
  type: 'transfer' as const,
  promptMarkdown: 'How would you count records matching two conditions?',
  answerMarkdown: 'Filter on the combined predicate, then read length.',
  explanationMarkdown: 'Composition of predicates.',
  gradingOrigin: 'self_reported' as const,
  primaryConceptId: CONCEPT_ID,
};

const assessmentEntry = (id: string, correctId: string, critical: boolean) => ({
  id,
  objectiveIds: [CONCEPT_ID],
  critical,
  promptMarkdown: `Placement item ${id}`,
  grading: {
    kind: 'choice' as const,
    mode: 'single' as const,
    options: [
      { id: correctId, textMarkdown: 'right', correct: true, explanationMarkdown: 'Correct.' },
      { id: 'wrong', textMarkdown: 'wrong', correct: false, explanationMarkdown: 'Not this one.' },
    ],
  },
  explanationMarkdown: `Why ${correctId} is right.`,
});

export const ASSESSMENT = {
  ...base(ASSESSMENT_ID, 'Arrays placement'),
  kind: 'assessment' as const,
  bodyMarkdown: 'Five items covering the chapter objectives.',
  chapterId: CHAPTER_ID,
  items: [
    assessmentEntry('p1', 'a', true),
    assessmentEntry('p2', 'b', false),
    assessmentEntry('p3', 'c', false),
    assessmentEntry('p4', 'd', false),
    assessmentEntry('p5', 'e', false),
  ],
  qualification: { minimumCorrect: 4, requireAllCritical: true },
};

export const LESSON = {
  ...base(LESSON_ID, 'Array selection and transformation'),
  kind: 'lesson' as const,
  bodyMarkdown: 'Selecting records without changing them.',
  chapterId: CHAPTER_ID,
  sortOrder: 0,
  objectives: ['Select records with filter'],
  estimatedMinutes: 9,
  workedExampleMarkdown: 'A worked example.',
  commonMistakes: ['Mutating the input'],
  summaryMarkdown: 'filter selects; it does not mutate.',
  exerciseIds: [FN_EXERCISE_ID, CHOICE_EXERCISE_ID, RUBRIC_EXERCISE_ID],
  reviewCardIds: [CARD_ID, CARD_TWO_ID],
  references: [{ label: 'MDN filter', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter' }],
};

export const LESSON_TWO = {
  ...base(LESSON_TWO_ID, 'Lookup and aggregation'),
  kind: 'lesson' as const,
  bodyMarkdown: 'Grouping and counting.',
  chapterId: CHAPTER_ID,
  sortOrder: 1,
  objectives: ['Group records'],
  estimatedMinutes: 9,
  workedExampleMarkdown: 'A worked example.',
  commonMistakes: ['Assuming a record exists'],
  summaryMarkdown: 'Choose the right collection.',
  exerciseIds: [LESSON_TWO_EXERCISE_ID],
  reviewCardIds: [],
  references: [],
};

export const CHAPTER = {
  ...base(CHAPTER_ID, 'Records and collections'),
  kind: 'chapter' as const,
  bodyMarkdown: 'Working with records.',
  trackId: TRACK_ID,
  lessonIds: [LESSON_ID, LESSON_TWO_ID],
  assessmentId: ASSESSMENT_ID,
  objectiveIds: [CONCEPT_ID],
  missionIds: [],
  sortOrder: 0,
};

export const TRACK = {
  ...base(TRACK_ID, 'Web foundations'),
  kind: 'track' as const,
  bodyMarkdown: 'The V1 track.',
  description: 'Practical web application engineering.',
  targetOutcomes: ['Read and debug real code'],
  chapterIds: [CHAPTER_ID],
};

export const ALL_ITEMS = [
  TRACK,
  CHAPTER,
  LESSON,
  LESSON_TWO,
  FN_EXERCISE,
  CHOICE_EXERCISE,
  RUBRIC_EXERCISE,
  LESSON_TWO_EXERCISE,
  CARD_ONE,
  CARD_TWO,
  ASSESSMENT,
];

function projection(item: { kind: string } & Record<string, unknown>): {
  parentId: string | null;
  sortOrder: number;
  primaryConceptId: string | null;
} {
  switch (item.kind) {
    case 'track':
      return { parentId: null, sortOrder: 0, primaryConceptId: null };
    case 'chapter':
      return { parentId: item.trackId as string, sortOrder: item.sortOrder as number, primaryConceptId: null };
    case 'lesson':
      return { parentId: item.chapterId as string, sortOrder: item.sortOrder as number, primaryConceptId: null };
    case 'exercise':
      return {
        parentId: item.lessonId as string,
        sortOrder: (item.sortOrder as number) ?? 0,
        primaryConceptId: item.primaryConceptId as string,
      };
    case 'review_card':
      return { parentId: item.lessonId as string, sortOrder: 0, primaryConceptId: item.primaryConceptId as string };
    case 'assessment':
      return { parentId: item.chapterId as string, sortOrder: 0, primaryConceptId: null };
    default:
      return { parentId: null, sortOrder: 0, primaryConceptId: null };
  }
}

export interface PublishedRelease {
  releaseId: string;
  versionIdByItemId: Map<string, string>;
}

/** Publish a set of authored items as an active release for one owner. */
export async function publishRelease(
  db: PrismaClient,
  ownerId: string,
  items: ({ kind: string; id: string; title: string } & Record<string, unknown>)[] = ALL_ITEMS as never,
  options: { packageVersion?: string; activate?: boolean } = {},
): Promise<PublishedRelease> {
  const packageVersion = options.packageVersion ?? '1.0.0';
  const release = await db.contentRelease.create({
    data: {
      packageId: 'devpractice-v1',
      packageVersion,
      ownerId,
      checksum: checksum(items),
      state: 'published',
      title: `Test release ${packageVersion}`,
      validationSummary: { counts: {}, warnings: [], errors: [] },
      publishedAt: new Date(),
    },
  });

  const versionIdByItemId = new Map<string, string>();
  for (const item of items) {
    const p = projection(item);
    await db.contentItem.upsert({
      where: { id: item.id },
      create: { id: item.id, kind: item.kind as never },
      update: {},
    });
    const version = await db.contentVersion.upsert({
      where: { itemId_version: { itemId: item.id, version: (item.version as number) ?? 1 } },
      create: {
        itemId: item.id,
        version: (item.version as number) ?? 1,
        masteryRevision: (item.masteryRevision as number) ?? 1,
        kind: item.kind as never,
        parentId: p.parentId,
        sortOrder: p.sortOrder,
        primaryConceptId: p.primaryConceptId,
        title: item.title,
        payload: item as object,
        checksum: checksum(item),
      },
      update: {},
    });
    versionIdByItemId.set(item.id, version.id);
    await db.releaseItem.create({
      data: {
        releaseId: release.id,
        itemId: item.id,
        versionId: version.id,
        kind: item.kind as never,
        parentId: p.parentId,
        sortOrder: p.sortOrder,
      },
    });
  }

  if (options.activate !== false) {
    await db.user.update({
      where: { id: ownerId },
      data: { activeReleaseId: release.id, activeReleaseRevision: { increment: 1 } },
    });
  }

  return { releaseId: release.id, versionIdByItemId };
}

/** A runner report that legitimately accounts for every pinned case. */
export function passingRunnerReport(): {
  status: 'passed';
  passedCaseIds: string[];
  failedCaseIds: string[];
  durationMs: number;
} {
  return {
    status: 'passed',
    passedCaseIds: FN_EXERCISE.grading.cases.map((c) => c.id),
    failedCaseIds: [],
    durationMs: 12,
  };
}
