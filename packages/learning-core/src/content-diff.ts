import { canonicalise } from './canonical.js';

/**
 * Content change classification (spec 8.2).
 *
 * Editorial change  -> version++, masteryRevision preserved, evidence intact.
 * Behavioural change -> masteryRevision++, old evidence still visible but the
 *                       new revision may require new practice.
 *
 * Version numbers are never recycled with different bytes.
 */

export type ChangeKind = 'added' | 'unchanged' | 'editorial' | 'behavioural' | 'archived';

export interface DiffItem {
  id: string;
  kind: string;
  version: number;
  masteryRevision: number;
  [field: string]: unknown;
}

/**
 * Fields whose change alters what the learner must be able to DO.
 * Everything else (titles, prose, hints, references, estimates) is editorial.
 */
export const BEHAVIOURAL_FIELDS: Record<string, string[]> = {
  track: ['chapterIds'],
  chapter: ['lessonIds', 'assessmentId', 'objectiveIds'],
  lesson: ['objectives', 'exerciseIds'],
  exercise: ['grading', 'solution', 'type', 'primaryConceptId', 'requiredForLessonCompletion'],
  review_card: ['grading', 'answerMarkdown', 'type', 'primaryConceptId'],
  assessment: ['items', 'qualification'],
  mission: [
    'acceptanceCriteria',
    'baselineChecks',
    'verificationCommands',
    'starterAssetId',
    'starterCommit',
    'checklist',
    'solutionMarkdown',
    'workType',
  ],
};

function fieldChanged(previous: DiffItem, next: DiffItem, field: string): boolean {
  return canonicalise(previous[field]) !== canonicalise(next[field]);
}

/** Compare everything except the bookkeeping fields the publisher controls. */
const IGNORED_FIELDS = new Set(['version', 'masteryRevision']);

export function classifyItemChange(
  previous: DiffItem | null,
  next: DiffItem | null,
): ChangeKind {
  if (!previous && next) return 'added';
  if (previous && !next) return 'archived';
  if (!previous || !next) return 'unchanged';

  const behavioural = BEHAVIOURAL_FIELDS[next.kind] ?? [];
  if (behavioural.some((field) => fieldChanged(previous, next, field))) return 'behavioural';

  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    if (fieldChanged(previous, next, key)) return 'editorial';
  }
  return 'unchanged';
}

export interface VersionDecision {
  version: number;
  masteryRevision: number;
  change: ChangeKind;
}

/**
 * Decide the stored version numbers for an incoming item. Authors do not get
 * to lower a version or silently reuse one: the publisher derives them.
 */
export function decideVersion(previous: DiffItem | null, next: DiffItem): VersionDecision {
  const change = classifyItemChange(previous, next);
  if (!previous) return { version: 1, masteryRevision: 1, change: 'added' };
  if (change === 'unchanged') {
    return { version: previous.version, masteryRevision: previous.masteryRevision, change };
  }
  return {
    version: previous.version + 1,
    masteryRevision:
      change === 'behavioural' ? previous.masteryRevision + 1 : previous.masteryRevision,
    change,
  };
}

export interface ReleaseChangeSummary {
  added: string[];
  editorial: string[];
  behavioural: string[];
  archived: string[];
  unchanged: string[];
  masteryRevisionsAffected: string[];
}

export function summariseRelease(
  previousItems: DiffItem[],
  nextItems: DiffItem[],
): ReleaseChangeSummary {
  const prevById = new Map(previousItems.map((i) => [i.id, i]));
  const nextById = new Map(nextItems.map((i) => [i.id, i]));
  const summary: ReleaseChangeSummary = {
    added: [],
    editorial: [],
    behavioural: [],
    archived: [],
    unchanged: [],
    masteryRevisionsAffected: [],
  };

  for (const item of nextItems) {
    const change = classifyItemChange(prevById.get(item.id) ?? null, item);
    if (change === 'added') summary.added.push(item.id);
    else if (change === 'editorial') summary.editorial.push(item.id);
    else if (change === 'behavioural') {
      summary.behavioural.push(item.id);
      summary.masteryRevisionsAffected.push(item.id);
    } else summary.unchanged.push(item.id);
  }

  for (const item of previousItems) {
    if (!nextById.has(item.id)) summary.archived.push(item.id);
  }

  return summary;
}
