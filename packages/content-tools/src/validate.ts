import { createHash } from 'node:crypto';
import {
  contentItemSchema,
  contentPackageSchema,
  FORBIDDEN_AUTHORED_FIELDS,
  type ChapterItem,
  type ContentItem,
  type ContentPackage,
  type ExerciseItem,
  type LessonItem,
} from '@devpractice/contracts';
import { err, warn, type Issue, type ItemsById } from './types.js';
import type { ConceptCatalog } from './concepts.js';

/** Known keys per item kind, derived from the schema so it never drifts. */
const KNOWN_KEYS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const option of contentItemSchema.options) {
    const shape = option.shape as Record<string, unknown>;
    const kindLiteral = (option.shape.kind as { value: string }).value;
    map.set(kindLiteral, new Set(Object.keys(shape)));
  }
  return map;
})();

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /lorem ipsum/i,
  /\bcoming soon\b/i,
  /\bfill (this|me) in\b/i,
  /\bXXX\b/,
  /\bwrite (this|the rest) later\b/i,
  /\b(placeholder|filler|dummy)\s+(text|copy|content|prose)\b/i,
  /\bthis is a placeholder\b/i,
];

/**
 * Prose scanning ignores code samples.
 *
 * Authored material legitimately shows `placeholder="..."`, and an accessibility
 * lesson has to be able to name the attribute in order to teach that a
 * placeholder is not a label. Matching the bare word across all prose made that
 * impossible, so the patterns above target authoring filler ("placeholder
 * text") and the scan runs on prose with fenced blocks and inline code removed.
 */
function proseOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

const UNSAFE_LINK = /\]\(\s*(javascript:|data:|vbscript:)/i;
const MARKDOWN_LINK = /\]\(\s*([^)\s]+)/g;

function fingerprint(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

/* ------------------------- 1. schema-level checks ------------------------ */

export function validateSchema(raw: unknown): { issues: Issue[]; pkg?: ContentPackage } {
  const parsed = contentPackageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.length
          ? issue.path
              .map((segment, index) =>
                typeof segment === 'number'
                  ? `[${segment}]`
                  : index === 0
                    ? String(segment)
                    : `.${String(segment)}`,
              )
              .join('')
          : '<root>';
        return err('schema.invalid', path, issue.message);
      }),
    };
  }
  return { issues: [], pkg: parsed.data };
}

/** Unknown and forbidden fields must be REPORTED, never silently ignored. */
export function validateFieldSurface(raw: unknown): Issue[] {
  const issues: Issue[] = [];
  const pkg = raw as { items?: unknown };
  if (!Array.isArray(pkg.items)) return issues;

  pkg.items.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return;
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? record.kind : undefined;
    const itemId = typeof record.id === 'string' ? record.id : undefined;
    const known = kind ? KNOWN_KEYS.get(kind) : undefined;

    for (const key of Object.keys(record)) {
      if ((FORBIDDEN_AUTHORED_FIELDS as readonly string[]).includes(key)) {
        issues.push(
          err(
            'field.forbidden',
            `items[${index}].${key}`,
            `'${key}' is a runtime field and must never appear in authored content`,
            itemId,
          ),
        );
        continue;
      }
      if (known && !known.has(key)) {
        issues.push(
          err(
            'field.unknown',
            `items[${index}].${key}`,
            `unsupported field '${key}' for kind '${kind}'`,
            itemId,
          ),
        );
      }
    }
  });
  return issues;
}

/* --------------------------- 2. identity checks -------------------------- */

export function validateIdentity(pkg: ContentPackage): { issues: Issue[]; byId: ItemsById } {
  const issues: Issue[] = [];
  const byId: ItemsById = new Map();
  const seenVersion = new Map<string, number>();

  pkg.items.forEach((item, index) => {
    const versionKey = `${item.id}@${item.version}`;
    if (seenVersion.has(versionKey)) {
      // Same id AND same version twice: a version number must never be reused
      // for different bytes, so this is always an authoring error.
      issues.push(
        err(
          'version.duplicate',
          `items[${index}].version`,
          `id '${item.id}' already declares version ${item.version}; never reuse a version number with different bytes`,
          item.id,
        ),
      );
    } else if (byId.has(item.id)) {
      // Same id at a different version: a snapshot names exactly one version
      // of each item, so two versions of one id cannot both be published.
      issues.push(
        err(
          'id.duplicate',
          `items[${index}].id`,
          `item id '${item.id}' appears more than once; a snapshot contains exactly one version of each item`,
          item.id,
        ),
      );
    }
    seenVersion.set(versionKey, index);
    if (!byId.has(item.id)) byId.set(item.id, item);
  });

  return { issues, byId };
}

/* -------------------------- 3. reference checks -------------------------- */

function expectKind(
  byId: ItemsById,
  id: string,
  kind: ContentItem['kind'],
  path: string,
  ownerId: string,
): Issue | null {
  const target = byId.get(id);
  if (!target) return err('reference.missing', path, `'${id}' is not present in this package`, ownerId);
  if (target.kind !== kind) {
    return err(
      'reference.kind',
      path,
      `'${id}' is a ${target.kind}, expected ${kind}`,
      ownerId,
    );
  }
  return null;
}

/**
 * Reachability, which is the reverse of every other reference check here.
 *
 * The UI renders the curriculum from `track.chapterIds` and a chapter's missions
 * from `chapter.missionIds`. Everything else in this file walks references
 * FORWARDS - does the id this item names exist - and forwards checks cannot see
 * an item that nothing points at. Both of these have shipped broken: eighteen
 * chapters validated green while no track listed them, and nine missions
 * validated green while no chapter claimed them. In both cases the content was
 * complete, correct, and invisible in the application.
 *
 * A mission's `chapterPrerequisiteIds` is NOT the reverse edge. It says which
 * chapters you should have done first; it does not put the mission on a page.
 */
function validateReachability(pkg: ContentPackage): Issue[] {
  const issues: Issue[] = [];

  const listedByTrack = new Set<string>();
  const claimedByChapter = new Set<string>();
  for (const item of pkg.items) {
    if (item.kind === 'track') for (const id of item.chapterIds) listedByTrack.add(id);
    if (item.kind === 'chapter') for (const id of item.missionIds) claimedByChapter.add(id);
  }

  pkg.items.forEach((item, index) => {
    if (item.kind === 'chapter' && !listedByTrack.has(item.id)) {
      issues.push(
        err(
          'reachability.chapter-unlisted',
          `items[${index}].id`,
          `chapter '${item.id}' is in this release but no track lists it in chapterIds, so it is unreachable in curriculum navigation`,
          item.id,
        ),
      );
    }
    if (item.kind === 'mission' && !claimedByChapter.has(item.id)) {
      issues.push(
        err(
          'reachability.mission-unclaimed',
          `items[${index}].id`,
          `mission '${item.id}' is in this release but no chapter lists it in missionIds, so no chapter page can link to it (chapterPrerequisiteIds is not the reverse edge)`,
          item.id,
        ),
      );
    }
  });

  return issues;
}

export function validateReferences(pkg: ContentPackage, byId: ItemsById): Issue[] {
  const issues: Issue[] = [];
  const push = (issue: Issue | null): void => {
    if (issue) issues.push(issue);
  };

  pkg.items.forEach((item, index) => {
    const base = `items[${index}]`;
    switch (item.kind) {
      case 'track':
        item.chapterIds.forEach((id, i) =>
          push(expectKind(byId, id, 'chapter', `${base}.chapterIds[${i}]`, item.id)),
        );
        break;

      case 'chapter': {
        push(expectKind(byId, item.trackId, 'track', `${base}.trackId`, item.id));
        item.lessonIds.forEach((id, i) => {
          push(expectKind(byId, id, 'lesson', `${base}.lessonIds[${i}]`, item.id));
          const lesson = byId.get(id);
          if (lesson && lesson.kind === 'lesson' && lesson.chapterId !== item.id) {
            issues.push(
              err(
                'reference.asymmetric',
                `${base}.lessonIds[${i}]`,
                `lesson '${id}' declares chapterId '${lesson.chapterId}' but is listed under chapter '${item.id}'`,
                item.id,
              ),
            );
          }
        });
        push(expectKind(byId, item.assessmentId, 'assessment', `${base}.assessmentId`, item.id));
        item.missionIds.forEach((id, i) =>
          push(expectKind(byId, id, 'mission', `${base}.missionIds[${i}]`, item.id)),
        );
        break;
      }

      case 'lesson': {
        push(expectKind(byId, item.chapterId, 'chapter', `${base}.chapterId`, item.id));
        item.exerciseIds.forEach((id, i) => {
          push(expectKind(byId, id, 'exercise', `${base}.exerciseIds[${i}]`, item.id));
          const exercise = byId.get(id);
          if (exercise && exercise.kind === 'exercise' && exercise.lessonId !== item.id) {
            issues.push(
              err(
                'reference.asymmetric',
                `${base}.exerciseIds[${i}]`,
                `exercise '${id}' declares lessonId '${exercise.lessonId}' but is listed under lesson '${item.id}'`,
                item.id,
              ),
            );
          }
        });
        item.reviewCardIds.forEach((id, i) =>
          push(expectKind(byId, id, 'review_card', `${base}.reviewCardIds[${i}]`, item.id)),
        );
        break;
      }

      case 'exercise':
        push(expectKind(byId, item.lessonId, 'lesson', `${base}.lessonId`, item.id));
        break;

      case 'review_card':
        push(expectKind(byId, item.lessonId, 'lesson', `${base}.lessonId`, item.id));
        break;

      case 'assessment': {
        push(expectKind(byId, item.chapterId, 'chapter', `${base}.chapterId`, item.id));
        const chapter = byId.get(item.chapterId);
        if (chapter && chapter.kind === 'chapter' && chapter.assessmentId !== item.id) {
          issues.push(
            err(
              'reference.asymmetric',
              `${base}.chapterId`,
              `chapter '${item.chapterId}' points at assessment '${chapter.assessmentId}', not '${item.id}'`,
              item.id,
            ),
          );
        }
        break;
      }

      case 'mission':
        item.chapterPrerequisiteIds.forEach((id, i) =>
          push(expectKind(byId, id, 'chapter', `${base}.chapterPrerequisiteIds[${i}]`, item.id)),
        );
        break;
    }
  });

  return issues;
}

/* -------------------------- 4. prerequisite cycles ----------------------- */

/**
 * Concept prerequisites form a suggestion graph. It guides recommendations and
 * never blocks navigation, but a CYCLE is meaningless and is rejected.
 */
export function validatePrerequisiteCycles(pkg: ContentPackage): Issue[] {
  const graph = new Map<string, Set<string>>();
  for (const item of pkg.items) {
    for (const concept of item.conceptIds) {
      const edges = graph.get(concept) ?? new Set<string>();
      for (const prerequisite of item.prerequisiteIds) {
        if (prerequisite !== concept) edges.add(prerequisite);
      }
      graph.set(concept, edges);
    }
  }

  const issues: Issue[] = [];
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    colour.set(node, GREY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        const cycleStart = stack.indexOf(next);
        const cycle = [...stack.slice(cycleStart), next].join(' -> ');
        issues.push(
          err('prerequisite.cycle', 'items[*].prerequisiteIds', `prerequisite cycle: ${cycle}`),
        );
      } else if (state === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(node, BLACK);
  };

  for (const node of graph.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) visit(node);
  }

  // De-duplicate rotations of the same cycle.
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [...issue.message.split(': ')[1]!.split(' -> ')].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* --------------------------- 5. ordering checks -------------------------- */

export function validateOrdering(pkg: ContentPackage, byId: ItemsById): Issue[] {
  const issues: Issue[] = [];
  const chapterOrders = new Map<string, Map<number, string>>();

  for (const item of pkg.items) {
    if (item.kind === 'chapter') {
      const track = chapterOrders.get(item.trackId) ?? new Map<number, string>();
      const clash = track.get(item.sortOrder);
      if (clash) {
        issues.push(
          err(
            'order.duplicate',
            `chapter '${item.id}'.sortOrder`,
            `chapters '${clash}' and '${item.id}' share sortOrder ${item.sortOrder} in track '${item.trackId}'`,
            item.id,
          ),
        );
      }
      track.set(item.sortOrder, item.id);
      chapterOrders.set(item.trackId, track);
    }
  }

  const lessonOrders = new Map<string, Map<number, string>>();
  for (const item of pkg.items) {
    if (item.kind !== 'lesson') continue;
    const chapter = lessonOrders.get(item.chapterId) ?? new Map<number, string>();
    const clash = chapter.get(item.sortOrder);
    if (clash) {
      issues.push(
        err(
          'order.duplicate',
          `lesson '${item.id}'.sortOrder`,
          `lessons '${clash}' and '${item.id}' share sortOrder ${item.sortOrder} in chapter '${item.chapterId}'`,
          item.id,
        ),
      );
    }
    chapter.set(item.sortOrder, item.id);
    lessonOrders.set(item.chapterId, chapter);
  }

  // A chapter's lessonIds order must agree with the lessons' own sortOrder.
  for (const item of pkg.items) {
    if (item.kind !== 'chapter') continue;
    const orders = item.lessonIds.map((id) => {
      const lesson = byId.get(id);
      return lesson && lesson.kind === 'lesson' ? lesson.sortOrder : Number.NaN;
    });
    for (let i = 1; i < orders.length; i += 1) {
      const previous = orders[i - 1];
      const current = orders[i];
      if (Number.isFinite(previous) && Number.isFinite(current) && current! <= previous!) {
        issues.push(
          err(
            'order.inconsistent',
            `chapter '${item.id}'.lessonIds[${i}]`,
            `lessonIds order disagrees with lesson sortOrder values (${previous} then ${current})`,
            item.id,
          ),
        );
      }
    }
  }

  return issues;
}

/* ---------------------- 6. concept coverage + catalog -------------------- */

export function validateConcepts(pkg: ContentPackage, catalog: ConceptCatalog): Issue[] {
  const issues: Issue[] = [];
  const known = new Set(catalog.concepts.map((c) => c.id));

  pkg.items.forEach((item, index) => {
    const ids = new Set([...item.conceptIds, ...item.prerequisiteIds]);
    if (item.kind === 'exercise' || item.kind === 'review_card') ids.add(item.primaryConceptId);
    if (item.kind === 'chapter') for (const id of item.objectiveIds) ids.add(id);
    for (const id of ids) {
      if (!known.has(id)) {
        issues.push(
          err(
            'concept.unknown',
            `items[${index}]`,
            `concept '${id}' is not in curriculum/concepts.json`,
            item.id,
          ),
        );
      }
    }
    if (item.kind === 'exercise' && !item.conceptIds.includes(item.primaryConceptId)) {
      issues.push(
        err(
          'concept.primary-not-listed',
          `items[${index}].primaryConceptId`,
          `primaryConceptId '${item.primaryConceptId}' must also appear in conceptIds`,
          item.id,
        ),
      );
    }
  });

  // Every chapter objective needs at least one exercise that evidences it.
  const exercisesByLesson = new Map<string, ExerciseItem[]>();
  for (const item of pkg.items) {
    if (item.kind !== 'exercise') continue;
    const list = exercisesByLesson.get(item.lessonId) ?? [];
    list.push(item);
    exercisesByLesson.set(item.lessonId, list);
  }

  for (const item of pkg.items) {
    if (item.kind !== 'chapter') continue;
    const covered = new Set<string>();
    for (const lessonId of item.lessonIds) {
      for (const exercise of exercisesByLesson.get(lessonId) ?? []) {
        covered.add(exercise.primaryConceptId);
        for (const id of exercise.conceptIds) covered.add(id);
      }
    }
    for (const objective of item.objectiveIds) {
      if (!covered.has(objective)) {
        issues.push(
          err(
            'concept.uncovered-objective',
            `chapter '${item.id}'.objectiveIds`,
            `objective '${objective}' has no exercise in this chapter that practises it`,
            item.id,
          ),
        );
      }
    }
  }

  return issues;
}

/* ----------------------- 7. prose quality + safety ----------------------- */

export function validateProse(pkg: ContentPackage): Issue[] {
  const issues: Issue[] = [];
  const fingerprints = new Map<string, string>();

  const checkText = (text: string, path: string, itemId: string, label: string): void => {
    const prose = proseOnly(text);
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(prose)) {
        issues.push(
          err('prose.placeholder', path, `${label} contains placeholder text (${pattern})`, itemId),
        );
        break;
      }
    }
    if (UNSAFE_LINK.test(text)) {
      issues.push(
        err('link.unsafe', path, `${label} contains a javascript:/data: link`, itemId),
      );
    }
    let match: RegExpExecArray | null;
    const linkPattern = new RegExp(MARKDOWN_LINK.source, 'g');
    while ((match = linkPattern.exec(text)) !== null) {
      const href = match[1] ?? '';
      const allowed =
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('#') ||
        href.startsWith('./') ||
        href.startsWith('/');
      if (!allowed) {
        issues.push(
          warn('link.unrecognised', path, `${label} links to '${href}' which is not http(s) or a relative path`, itemId),
        );
      }
    }
  };

  pkg.items.forEach((item, index) => {
    const base = `items[${index}]`;
    checkText(item.bodyMarkdown, `${base}.bodyMarkdown`, item.id, 'bodyMarkdown');

    const print = fingerprint(item.bodyMarkdown);
    const clash = fingerprints.get(print);
    if (clash && clash !== item.id) {
      issues.push(
        err(
          'prose.duplicate',
          `${base}.bodyMarkdown`,
          `body text is identical to '${clash}' — duplicated filler does not teach`,
          item.id,
        ),
      );
    }
    fingerprints.set(print, item.id);

    if (item.kind === 'lesson') {
      checkText(item.workedExampleMarkdown, `${base}.workedExampleMarkdown`, item.id, 'worked example');
      checkText(item.summaryMarkdown, `${base}.summaryMarkdown`, item.id, 'summary');
    }
    if (item.kind === 'exercise') {
      checkText(item.promptMarkdown, `${base}.promptMarkdown`, item.id, 'prompt');
      checkText(item.solution.explanationMarkdown, `${base}.solution.explanationMarkdown`, item.id, 'solution explanation');
      item.hints.forEach((hint, i) => checkText(hint, `${base}.hints[${i}]`, item.id, `hint ${i + 1}`));

      // Hints must ADD information, not repeat the answer three times.
      const normalised = item.hints.map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
      for (let i = 0; i < normalised.length; i += 1) {
        for (let j = i + 1; j < normalised.length; j += 1) {
          if (normalised[i] === normalised[j]) {
            issues.push(
              err(
                'hint.duplicate',
                `${base}.hints[${j}]`,
                `hint ${j + 1} repeats hint ${i + 1}; each hint must add new information`,
                item.id,
              ),
            );
          }
        }
      }
    }
    if (item.kind === 'review_card') {
      checkText(item.promptMarkdown, `${base}.promptMarkdown`, item.id, 'prompt');
      checkText(item.answerMarkdown, `${base}.answerMarkdown`, item.id, 'answer');
    }
    if (item.kind === 'assessment') {
      item.items.forEach((entry, i) => {
        checkText(entry.promptMarkdown, `${base}.items[${i}].promptMarkdown`, item.id, 'assessment prompt');
        checkText(entry.explanationMarkdown, `${base}.items[${i}].explanationMarkdown`, item.id, 'assessment explanation');
      });
    }
    if (item.kind === 'mission') {
      checkText(item.setupMarkdown, `${base}.setupMarkdown`, item.id, 'setup');
      checkText(item.solutionMarkdown, `${base}.solutionMarkdown`, item.id, 'solution');
    }
  });

  return issues;
}

/* ------------------------ 8. grading definition checks ------------------- */

export function validateGrading(pkg: ContentPackage): Issue[] {
  const issues: Issue[] = [];

  const checkGrading = (
    grading: ExerciseItem['grading'],
    path: string,
    itemId: string,
    solutionCode: string | undefined,
  ): void => {
    switch (grading.kind) {
      case 'choice': {
        const correct = grading.options.filter((o) => o.correct);
        if (correct.length === 0) {
          issues.push(err('grading.no-correct', `${path}.options`, 'no option is marked correct', itemId));
        }
        if (grading.mode === 'single' && correct.length > 1) {
          issues.push(
            err('grading.single-multiple-correct', `${path}.options`, `single-choice item has ${correct.length} correct options`, itemId),
          );
        }
        if (grading.mode === 'multiple' && correct.length === grading.options.length) {
          issues.push(
            warn('grading.all-correct', `${path}.options`, 'every option is correct, so the item tests nothing', itemId),
          );
        }
        const ids = new Set<string>();
        grading.options.forEach((option, i) => {
          if (ids.has(option.id)) {
            issues.push(err('grading.duplicate-option', `${path}.options[${i}].id`, `duplicate option id '${option.id}'`, itemId));
          }
          ids.add(option.id);
        });
        break;
      }

      case 'function-cases': {
        if (grading.cases.length > 25) {
          issues.push(err('grading.too-many-cases', `${path}.cases`, 'at most 25 cases are supported', itemId));
        }
        const caseIds = new Set<string>();
        grading.cases.forEach((testCase, i) => {
          if (caseIds.has(testCase.id)) {
            issues.push(err('grading.duplicate-case', `${path}.cases[${i}].id`, `duplicate case id '${testCase.id}'`, itemId));
          }
          caseIds.add(testCase.id);
        });

        // Cases that all expect the same value cannot reject a constant mutant.
        const distinct = new Set(grading.cases.map((c) => JSON.stringify(c.expected)));
        if (distinct.size < 2) {
          issues.push(
            err(
              'grading.uniform-expectations',
              `${path}.cases`,
              'every case expects the same value, so a constant implementation would pass',
              itemId,
            ),
          );
        }

        // V1 runner supports a single file with no imports.
        for (const [label, code] of [
          ['starterCode', grading.starterCode],
          ['solution.code', solutionCode ?? ''],
        ] as const) {
          if (/^\s*(import|export)\s/m.test(code)) {
            issues.push(
              err(
                'runner.unsupported-import',
                `${path === '' ? '' : path}.${label}`,
                'the V1 runner supports a single file with no imports or exports',
                itemId,
              ),
            );
          }
          if (/\b(require|fetch|XMLHttpRequest|localStorage|document|window|process)\b/.test(code)) {
            issues.push(
              err(
                'runner.unsupported-api',
                `${path}.${label}`,
                'browser exercises get no DOM, Node, network or storage APIs — teach this locally instead',
                itemId,
              ),
            );
          }
        }

        const entry = new RegExp(`\\b${grading.entrypoint}\\b`);
        if (!entry.test(grading.starterCode)) {
          issues.push(
            err('runner.missing-entrypoint', `${path}.starterCode`, `starter does not define '${grading.entrypoint}'`, itemId),
          );
        }
        if (solutionCode !== undefined && solutionCode !== '' && !entry.test(solutionCode)) {
          issues.push(
            err('runner.missing-entrypoint', `${path}`, `solution does not define '${grading.entrypoint}'`, itemId),
          );
        }
        break;
      }

      case 'predict-output':
        if (grading.expected.trim() === '') {
          issues.push(err('grading.empty-expected', `${path}.expected`, 'expected output is empty', itemId));
        }
        break;

      case 'rubric':
        if (grading.criteria.length < 2) {
          issues.push(err('grading.thin-rubric', `${path}.criteria`, 'a rubric needs at least two criteria', itemId));
        }
        break;
    }
  };

  pkg.items.forEach((item, index) => {
    if (item.kind === 'exercise') {
      checkGrading(item.grading, `items[${index}].grading`, item.id, item.solution.code);
      const needsCode = item.grading.kind === 'function-cases';
      if (needsCode && !item.solution.code) {
        issues.push(
          err('solution.missing-code', `items[${index}].solution.code`, 'a function exercise needs a reference solution', item.id),
        );
      }
      if (!needsCode && !item.solution.code && !item.solution.modelAnswer) {
        issues.push(
          err('solution.missing', `items[${index}].solution`, 'provide either code or a model answer', item.id),
        );
      }
    }
    if (item.kind === 'assessment') {
      item.items.forEach((entry, i) => {
        checkGrading(entry.grading, `items[${index}].items[${i}].grading`, item.id, undefined);
      });
      const ids = new Set<string>();
      item.items.forEach((entry, i) => {
        if (ids.has(entry.id)) {
          issues.push(err('assessment.duplicate-item', `items[${index}].items[${i}].id`, `duplicate assessment item id '${entry.id}'`, item.id));
        }
        ids.add(entry.id);
      });
      if (!item.items.some((entry) => entry.critical)) {
        issues.push(
          warn('assessment.no-critical', `items[${index}].items`, 'no item is flagged critical, so qualification rests on the count alone', item.id),
        );
      }
    }
    if (item.kind === 'review_card' && item.gradingOrigin === 'server_objective' && !item.grading) {
      issues.push(
        err('card.missing-grading', `items[${index}].grading`, 'an objectively graded card needs a grading definition', item.id),
      );
    }
  });

  return issues;
}

/* -------------------- 9. placement independence (spec §11.4) ------------- */

/** Placement items must be SEPARATELY authored, not copies of lesson exercises. */
export function validatePlacementIndependence(pkg: ContentPackage): Issue[] {
  const issues: Issue[] = [];
  const exercisePrompts = new Map<string, string>();
  for (const item of pkg.items) {
    if (item.kind === 'exercise') exercisePrompts.set(fingerprint(item.promptMarkdown), item.id);
  }
  pkg.items.forEach((item, index) => {
    if (item.kind !== 'assessment') return;
    item.items.forEach((entry, i) => {
      const clash = exercisePrompts.get(fingerprint(entry.promptMarkdown));
      if (clash) {
        issues.push(
          err(
            'placement.copied',
            `items[${index}].items[${i}].promptMarkdown`,
            `placement item duplicates lesson exercise '${clash}'; placement items must be separately authored`,
            item.id,
          ),
        );
      }
    });
  });
  return issues;
}

/* ------------------------------ 10. assets ------------------------------- */

export function validateAssets(pkg: ContentPackage): Issue[] {
  const issues: Issue[] = [];
  const declared = new Set(pkg.assets.map((asset) => asset.id));

  pkg.assets.forEach((asset, index) => {
    if (asset.path.includes('..') || asset.path.startsWith('/') || /^[a-z]:/i.test(asset.path)) {
      issues.push(
        err('asset.path-traversal', `assets[${index}].path`, `asset path '${asset.path}' must be a bundled relative path`),
      );
    }
  });

  pkg.items.forEach((item, index) => {
    if (item.kind === 'mission' && !declared.has(item.starterAssetId)) {
      issues.push(
        err('asset.missing', `items[${index}].starterAssetId`, `mission references asset '${item.starterAssetId}' which the package does not declare`, item.id),
      );
    }
  });

  return issues;
}

/* ------------------------- structural entry point ------------------------ */

export function validateStructure(
  raw: unknown,
  catalog: ConceptCatalog,
): { issues: Issue[]; pkg?: ContentPackage; byId?: ItemsById } {
  const surfaceIssues = validateFieldSurface(raw);
  const { issues: schemaIssues, pkg } = validateSchema(raw);
  if (!pkg) return { issues: [...schemaIssues, ...surfaceIssues] };

  const { issues: identityIssues, byId } = validateIdentity(pkg);
  const issues = [
    ...schemaIssues,
    ...surfaceIssues,
    ...identityIssues,
    ...validateReferences(pkg, byId),
    ...validateReachability(pkg),
    ...validatePrerequisiteCycles(pkg),
    ...validateOrdering(pkg, byId),
    ...validateConcepts(pkg, catalog),
    ...validateProse(pkg),
    ...validateGrading(pkg),
    ...validatePlacementIndependence(pkg),
    ...validateAssets(pkg),
  ];

  return { issues, pkg, byId };
}

export type { ChapterItem, LessonItem };
