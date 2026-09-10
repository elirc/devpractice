import type { AssessmentItem, ExerciseItem, Grading } from '@devpractice/contracts';

/**
 * Public projections of authored content (spec 9.2).
 *
 * The ordinary exercise payload deliberately excludes stored model answers,
 * hints and solutions. Those are only returned by an explicit reveal, which is
 * recorded as assistance.
 *
 * Browser-delivered function test cases ARE included and are inspectable by
 * design — the runner is personal-learning feedback, not proctoring, and the
 * spec forbids advertising these as secret.
 */

export interface PublicChoiceOption {
  id: string;
  textMarkdown: string;
}

export type PublicGrading =
  | { kind: 'choice'; mode: 'single' | 'multiple'; options: PublicChoiceOption[] }
  | { kind: 'predict-output'; normalization: { trim: boolean; collapseWhitespace: boolean; caseSensitive: boolean } }
  | {
      kind: 'function-cases';
      language: 'javascript' | 'typescript';
      entrypoint: string;
      starterCode: string;
      assertInputUnchanged: boolean;
      cases: { id: string; args: unknown[]; expected: unknown; tolerance?: number; hidden: boolean }[];
    }
  | { kind: 'rubric'; criteria: string[] };

export function publicGrading(grading: Grading): PublicGrading {
  switch (grading.kind) {
    case 'choice':
      return {
        kind: 'choice',
        mode: grading.mode,
        // `correct` and the per-option explanations are withheld until after
        // submission, where they become teaching feedback.
        options: grading.options.map((o) => ({ id: o.id, textMarkdown: o.textMarkdown })),
      };
    case 'predict-output':
      // The expected string and its accepted alternatives are withheld.
      return { kind: 'predict-output', normalization: grading.normalization };
    case 'function-cases':
      return {
        kind: 'function-cases',
        language: grading.language,
        entrypoint: grading.entrypoint,
        starterCode: grading.starterCode,
        assertInputUnchanged: grading.assertInputUnchanged,
        cases: grading.cases.map((c) => ({
          id: c.id,
          args: c.args,
          expected: c.expected,
          ...(c.tolerance === undefined ? {} : { tolerance: c.tolerance }),
          hidden: c.hidden,
        })),
      };
    case 'rubric':
      // Criteria guide the attempt; the model answer appears after submission.
      return { kind: 'rubric', criteria: grading.criteria };
  }
}

export interface PublicExercise {
  id: string;
  versionId: string;
  version: number;
  masteryRevision: number;
  lessonId: string;
  title: string;
  type: ExerciseItem['type'];
  difficulty: ExerciseItem['difficulty'];
  estimatedMinutes: number;
  bodyMarkdown: string;
  promptMarkdown: string;
  conceptIds: string[];
  primaryConceptId: string;
  requiredForLessonCompletion: boolean;
  grading: PublicGrading;
  hintCount: number;
  /** Assistance already spent on this mastery revision, and what it bought. */
  revealedHints: { index: number; text: string }[];
  solutionRevealed: boolean;
  solution: { code?: string; modelAnswer?: string; explanationMarkdown: string } | null;
}

export interface RevealState {
  hintIndexes: number[];
  solutionRevealed: boolean;
}

export function projectExercise(
  item: ExerciseItem,
  meta: { versionId: string; version: number; masteryRevision: number },
  reveals: RevealState,
): PublicExercise {
  const revealedHints = reveals.hintIndexes
    .filter((i) => i >= 0 && i < item.hints.length)
    .sort((a, b) => a - b)
    .map((index) => ({ index, text: item.hints[index] as string }));

  return {
    id: item.id,
    versionId: meta.versionId,
    version: meta.version,
    masteryRevision: meta.masteryRevision,
    lessonId: item.lessonId,
    title: item.title,
    type: item.type,
    difficulty: item.difficulty,
    estimatedMinutes: item.estimatedMinutes,
    bodyMarkdown: item.bodyMarkdown,
    promptMarkdown: item.promptMarkdown,
    conceptIds: item.conceptIds,
    primaryConceptId: item.primaryConceptId,
    requiredForLessonCompletion: item.requiredForLessonCompletion,
    grading: publicGrading(item.grading),
    hintCount: item.hints.length,
    revealedHints,
    solutionRevealed: reveals.solutionRevealed,
    solution: reveals.solutionRevealed ? item.solution : null,
  };
}

/** Placement items carry no hints or solutions before submission (spec 3.5). */
export interface PublicAssessmentItem {
  id: string;
  promptMarkdown: string;
  objectiveIds: string[];
  grading: PublicGrading;
}

export function projectAssessment(item: AssessmentItem): {
  id: string;
  title: string;
  chapterId: string;
  bodyMarkdown: string;
  qualification: AssessmentItem['qualification'];
  items: PublicAssessmentItem[];
} {
  return {
    id: item.id,
    title: item.title,
    chapterId: item.chapterId,
    bodyMarkdown: item.bodyMarkdown,
    qualification: item.qualification,
    items: item.items.map((entry) => ({
      id: entry.id,
      promptMarkdown: entry.promptMarkdown,
      objectiveIds: entry.objectiveIds,
      // `critical` is withheld so the flag cannot steer answering strategy.
      grading: publicGrading(entry.grading),
    })),
  };
}
