import { z } from 'zod';

/**
 * Authored content package schema (spec section 10).
 * These schemas validate DATA ONLY. Imported content never becomes executable
 * code: no route-schema compilation, no eval, no MDX.
 */

export const CONTENT_SCHEMA_VERSION = 1;

export const stableId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'stable ids use lowercase letters, digits and hyphens');

export const conceptId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/, 'concept ids use lowercase letters, digits, dots and hyphens');

export const markdown = z.string().min(1).max(50_000);

const baseItem = {
  id: stableId,
  version: z.number().int().min(1),
  masteryRevision: z.number().int().min(1),
  title: z.string().min(1).max(200),
  conceptIds: z.array(conceptId).max(20),
  prerequisiteIds: z.array(conceptId).max(20).default([]),
  bodyMarkdown: markdown,
};

export const referenceSchema = z.object({
  label: z.string().min(1).max(200),
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'references must be http(s) urls'),
});

/* ------------------------------- grading --------------------------------- */

export const choiceOptionSchema = z.object({
  id: stableId,
  textMarkdown: z.string().min(1).max(2000),
  correct: z.boolean(),
  /** Shown after submission. Required for distractors so mistakes teach. */
  explanationMarkdown: z.string().min(1).max(2000),
});

export const choiceGradingSchema = z.object({
  kind: z.literal('choice'),
  mode: z.enum(['single', 'multiple']),
  options: z.array(choiceOptionSchema).min(2).max(8),
});

export const predictOutputGradingSchema = z.object({
  kind: z.literal('predict-output'),
  /** Explicit normalization; nothing is implicit (spec 3.3). */
  normalization: z.object({
    trim: z.boolean().default(true),
    collapseWhitespace: z.boolean().default(true),
    caseSensitive: z.boolean().default(true),
  }),
  expected: z.string().min(1).max(2000),
  acceptedAlternatives: z.array(z.string().max(2000)).max(10).default([]),
});

export const functionCaseSchema = z.object({
  id: stableId,
  args: z.array(z.unknown()),
  expected: z.unknown(),
  /** Optional exact-equality escape hatch for float math. */
  tolerance: z.number().positive().optional(),
  hidden: z.boolean().default(false),
});

export const functionGradingSchema = z.object({
  kind: z.literal('function-cases'),
  language: z.enum(['javascript', 'typescript']),
  entrypoint: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  starterCode: z.string().min(1).max(65_536),
  assertInputUnchanged: z.boolean().default(false),
  cases: z.array(functionCaseSchema).min(2).max(25),
});

export const rubricGradingSchema = z.object({
  kind: z.literal('rubric'),
  criteria: z.array(z.string().min(1).max(500)).min(2).max(10),
  modelAnswerMarkdown: markdown,
});

export const gradingSchema = z.discriminatedUnion('kind', [
  choiceGradingSchema,
  predictOutputGradingSchema,
  functionGradingSchema,
  rubricGradingSchema,
]);

export type Grading = z.infer<typeof gradingSchema>;

/* -------------------------------- items ---------------------------------- */

export const trackItemSchema = z.object({
  ...baseItem,
  kind: z.literal('track'),
  description: z.string().min(1).max(2000),
  targetOutcomes: z.array(z.string().min(1).max(300)).min(1).max(12),
  chapterIds: z.array(stableId).min(1),
});

export const chapterItemSchema = z.object({
  ...baseItem,
  kind: z.literal('chapter'),
  trackId: stableId,
  lessonIds: z.array(stableId).min(1),
  assessmentId: stableId,
  objectiveIds: z.array(conceptId).min(1),
  missionIds: z.array(stableId).default([]),
  sortOrder: z.number().int().min(0),
});

export const lessonItemSchema = z.object({
  ...baseItem,
  kind: z.literal('lesson'),
  chapterId: stableId,
  sortOrder: z.number().int().min(0),
  objectives: z.array(z.string().min(1).max(300)).min(1).max(3),
  estimatedMinutes: z.number().int().min(1).max(120),
  workedExampleMarkdown: markdown,
  commonMistakes: z.array(z.string().min(1).max(600)).min(1).max(8),
  summaryMarkdown: z.string().min(1).max(4000),
  exerciseIds: z.array(stableId).min(1),
  reviewCardIds: z.array(stableId).default([]),
  references: z.array(referenceSchema).default([]),
});

export const exerciseItemSchema = z.object({
  ...baseItem,
  kind: z.literal('exercise'),
  lessonId: stableId,
  sortOrder: z.number().int().min(0).default(0),
  type: z.enum([
    'choice',
    'predict-output',
    'code-reading',
    'function',
    'explanation',
    'local-project',
  ]),
  difficulty: z.enum(['foundation', 'core', 'stretch']),
  estimatedMinutes: z.number().int().min(1).max(60),
  promptMarkdown: markdown,
  /** Exactly three progressive hints, each adding new information. */
  hints: z.tuple([
    z.string().min(1).max(1000),
    z.string().min(1).max(1000),
    z.string().min(1).max(1000),
  ]),
  solution: z.object({
    code: z.string().max(65_536).optional(),
    modelAnswer: z.string().max(8000).optional(),
    explanationMarkdown: markdown,
  }),
  grading: gradingSchema,
  /** The one objective this exercise primarily evidences. */
  primaryConceptId: conceptId,
  requiredForLessonCompletion: z.boolean().default(true),
});

export const reviewCardItemSchema = z.object({
  ...baseItem,
  kind: z.literal('review_card'),
  lessonId: stableId,
  type: z.enum(['recall', 'transfer', 'code-reading', 'debugging']),
  promptMarkdown: markdown,
  answerMarkdown: markdown,
  explanationMarkdown: z.string().min(1).max(4000),
  gradingOrigin: z.enum(['server_objective', 'self_reported']),
  grading: choiceGradingSchema.optional(),
  primaryConceptId: conceptId,
});

export const assessmentItemEntrySchema = z.object({
  id: stableId,
  objectiveIds: z.array(conceptId).min(1),
  critical: z.boolean().default(false),
  promptMarkdown: markdown,
  grading: gradingSchema,
  explanationMarkdown: markdown,
});

export const assessmentItemSchema = z.object({
  ...baseItem,
  kind: z.literal('assessment'),
  chapterId: stableId,
  items: z.array(assessmentItemEntrySchema).length(5),
  qualification: z.object({
    minimumCorrect: z.number().int().min(1).max(5).default(4),
    requireAllCritical: z.boolean().default(true),
  }),
});

export const missionItemSchema = z.object({
  ...baseItem,
  kind: z.literal('mission'),
  projectId: stableId,
  workType: z.enum(['build', 'extend', 'repair', 'refactor', 'investigate']),
  stack: z.enum(['react', 'node', 'fullstack', 'dotnet']),
  release: z.enum(['v1', 'v2', 'v3']),
  chapterPrerequisiteIds: z.array(stableId).default([]),
  starterAssetId: z.string().min(1).max(200),
  starterCommit: z.string().max(80).nullable(),
  setupMarkdown: markdown,
  baselineChecks: z.array(z.string().min(1).max(300)).min(1),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(3),
  verificationCommands: z.array(z.string().min(1).max(300)).min(1),
  checklist: z.array(z.object({ id: stableId, label: z.string().min(1).max(300) })).min(1),
  hints: z.tuple([
    z.string().min(1).max(1000),
    z.string().min(1).max(1000),
    z.string().min(1).max(1000),
  ]),
  solutionMarkdown: markdown,
  reflectionRubric: z.array(z.string().min(1).max(500)).min(1),
});

export const contentItemSchema = z.discriminatedUnion('kind', [
  trackItemSchema,
  chapterItemSchema,
  lessonItemSchema,
  exerciseItemSchema,
  reviewCardItemSchema,
  assessmentItemSchema,
  missionItemSchema,
]);

export const contentPackageSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    packageId: stableId,
    packageVersion: z.string().min(1).max(40),
    baseReleaseId: z.string().uuid().nullable().default(null),
    mode: z.literal('snapshot'),
    title: z.string().min(1).max(200),
    items: z.array(contentItemSchema).min(1).max(2000),
    assets: z
      .array(z.object({ id: z.string().min(1).max(200), path: z.string().min(1).max(400), checksum: z.string().min(1) }))
      .default([]),
  })
  .strict();

export type ContentPackage = z.infer<typeof contentPackageSchema>;
export type ContentItem = z.infer<typeof contentItemSchema>;
export type TrackItem = z.infer<typeof trackItemSchema>;
export type ChapterItem = z.infer<typeof chapterItemSchema>;
export type LessonItem = z.infer<typeof lessonItemSchema>;
export type ExerciseItem = z.infer<typeof exerciseItemSchema>;
export type ReviewCardItem = z.infer<typeof reviewCardItemSchema>;
export type AssessmentItem = z.infer<typeof assessmentItemSchema>;
export type MissionItem = z.infer<typeof missionItemSchema>;

/** Fields that must never appear in authored payloads (spec 10.1). */
export const FORBIDDEN_AUTHORED_FIELDS = [
  'ownerId',
  'userId',
  'progress',
  'xp',
  'publishedAt',
  'createdAt',
  'updatedAt',
] as const;
