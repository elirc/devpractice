import { createHash } from 'node:crypto';
import {
  FORBIDDEN_AUTHORED_FIELDS,
  contentPackageSchema,
  type ContentItem,
  type ContentPackage,
} from '@devpractice/contracts';
import { canonicalise } from '@devpractice/learning-core';

/**
 * Server-side content validation (spec 10.4).
 *
 * The import endpoint treats a package as DATA. It performs structural
 * validation and bounded reference checks only: no eval, no MDX compilation,
 * no npm hooks, and nothing from the package ever becomes a route validator or
 * server code. Executing reference solutions is a separate build-time gate in
 * the content CLI, whose report the author reviews before importing.
 */

export interface ValidationIssue {
  path: string;
  itemId?: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  counts: Record<string, number>;
  checksum: string;
}

export function packageChecksum(pkg: unknown): string {
  return createHash('sha256').update(canonicalise(pkg)).digest('hex');
}

/** Markdown links are limited to http, https and approved relative paths. */
const UNSAFE_LINK = /\]\(\s*(javascript|data|vbscript|file)\s*:/i;
const UNSAFE_AUTOLINK = /<\s*(javascript|data|vbscript|file)\s*:/i;
const PATH_TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;

export function validatePackage(raw: unknown): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = contentPackageSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: issue.path.join('.') || '_', message: issue.message });
    }
    return { valid: false, errors, warnings, counts: {}, checksum: '' };
  }

  const pkg: ContentPackage = parsed.data;
  const items = pkg.items;
  const byId = new Map<string, ContentItem>();
  const counts: Record<string, number> = {};

  /**
   * Unknown keys must be inspected on the RAW input.
   *
   * Zod strips keys it does not know, so a runtime field smuggled into an
   * authored item is already gone by the time the parsed value is examined —
   * checking the parsed item silently accepted it. Spec 10.1 also requires
   * that unsupported fields are identified rather than ignored in silence.
   */
  const rawItems = Array.isArray((raw as { items?: unknown }).items)
    ? ((raw as { items: unknown[] }).items)
    : [];

  for (const [index, item] of items.entries()) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    if (byId.has(item.id)) {
      errors.push({
        path: `items[${index}].id`,
        itemId: item.id,
        message: `duplicate item id "${item.id}"; stable ids are never reused`,
      });
    }
    byId.set(item.id, item);

    const rawItem = rawItems[index];
    if (rawItem && typeof rawItem === 'object') {
      const knownKeys = new Set(Object.keys(item));
      for (const key of Object.keys(rawItem as Record<string, unknown>)) {
        if (knownKeys.has(key)) continue;
        if ((FORBIDDEN_AUTHORED_FIELDS as readonly string[]).includes(key)) {
          errors.push({
            path: `items[${index}].${key}`,
            itemId: item.id,
            message: `"${key}" is a runtime field and must not appear in authored content`,
          });
        } else {
          warnings.push({
            path: `items[${index}].${key}`,
            itemId: item.id,
            message: `"${key}" is not a supported field for a ${item.kind} and was ignored`,
          });
        }
      }
    }

    const serialised = JSON.stringify(item);
    if (UNSAFE_LINK.test(serialised) || UNSAFE_AUTOLINK.test(serialised)) {
      errors.push({
        path: `items[${index}]`,
        itemId: item.id,
        message: 'markdown links are limited to http, https and approved relative paths',
      });
    }
  }

  const assetIds = new Set(pkg.assets.map((a) => a.id));
  for (const asset of pkg.assets) {
    if (PATH_TRAVERSAL.test(asset.path) || asset.path.startsWith('/') || /^[A-Za-z]:/.test(asset.path)) {
      errors.push({
        path: `assets.${asset.id}`,
        message: 'asset paths must be bundle-relative and must not traverse outside the package',
      });
    }
  }

  const ref = (
    fromId: string,
    path: string,
    targetId: string,
    expectedKind: ContentItem['kind'],
  ): void => {
    const target = byId.get(targetId);
    if (!target) {
      errors.push({ path, itemId: fromId, message: `references unknown item "${targetId}"` });
    } else if (target.kind !== expectedKind) {
      errors.push({
        path,
        itemId: fromId,
        message: `"${targetId}" is a ${target.kind}, expected a ${expectedKind}`,
      });
    }
  };

  for (const item of items) {
    const base = `items.${item.id}`;
    switch (item.kind) {
      case 'track':
        item.chapterIds.forEach((id, i) => ref(item.id, `${base}.chapterIds[${i}]`, id, 'chapter'));
        break;
      case 'chapter':
        ref(item.id, `${base}.trackId`, item.trackId, 'track');
        ref(item.id, `${base}.assessmentId`, item.assessmentId, 'assessment');
        item.lessonIds.forEach((id, i) => ref(item.id, `${base}.lessonIds[${i}]`, id, 'lesson'));
        item.missionIds.forEach((id, i) => ref(item.id, `${base}.missionIds[${i}]`, id, 'mission'));
        break;
      case 'lesson':
        ref(item.id, `${base}.chapterId`, item.chapterId, 'chapter');
        item.exerciseIds.forEach((id, i) => ref(item.id, `${base}.exerciseIds[${i}]`, id, 'exercise'));
        item.reviewCardIds.forEach((id, i) =>
          ref(item.id, `${base}.reviewCardIds[${i}]`, id, 'review_card'),
        );
        break;
      case 'exercise':
        ref(item.id, `${base}.lessonId`, item.lessonId, 'lesson');
        break;
      case 'review_card':
        ref(item.id, `${base}.lessonId`, item.lessonId, 'lesson');
        if (item.gradingOrigin === 'server_objective' && !item.grading) {
          errors.push({
            path: `${base}.grading`,
            itemId: item.id,
            message: 'an objectively graded card must define its grading',
          });
        }
        break;
      case 'assessment': {
        ref(item.id, `${base}.chapterId`, item.chapterId, 'chapter');
        const entryIds = new Set<string>();
        for (const entry of item.items) {
          if (entryIds.has(entry.id)) {
            errors.push({
              path: `${base}.items.${entry.id}`,
              itemId: item.id,
              message: 'duplicate assessment item id',
            });
          }
          entryIds.add(entry.id);
        }
        if (item.qualification.minimumCorrect > item.items.length) {
          errors.push({
            path: `${base}.qualification.minimumCorrect`,
            itemId: item.id,
            message: 'minimumCorrect exceeds the number of assessment items',
          });
        }
        break;
      }
      case 'mission':
        if (item.starterAssetId && !assetIds.has(item.starterAssetId)) {
          warnings.push({
            path: `${base}.starterAssetId`,
            itemId: item.id,
            message: `starter asset "${item.starterAssetId}" is not bundled with this package`,
          });
        }
        if (item.starterCommit === null) {
          warnings.push({
            path: `${base}.starterCommit`,
            itemId: item.id,
            message: 'starter commit is not pinned yet; record the real commit once it exists',
          });
        }
        break;
    }
  }

  // Two-way membership: an exercise must be listed by the lesson it claims.
  for (const item of items) {
    if (item.kind === 'exercise' || item.kind === 'review_card') {
      const lesson = byId.get(item.lessonId);
      if (lesson && lesson.kind === 'lesson') {
        const listed =
          item.kind === 'exercise'
            ? lesson.exerciseIds.includes(item.id)
            : lesson.reviewCardIds.includes(item.id);
        if (!listed) {
          errors.push({
            path: `items.${item.id}.lessonId`,
            itemId: item.id,
            message: `lesson "${lesson.id}" does not list this ${item.kind}`,
          });
        }
      }
    }
    if (item.kind === 'lesson') {
      const chapter = byId.get(item.chapterId);
      if (chapter && chapter.kind === 'chapter' && !chapter.lessonIds.includes(item.id)) {
        errors.push({
          path: `items.${item.id}.chapterId`,
          itemId: item.id,
          message: `chapter "${chapter.id}" does not list this lesson`,
        });
      }
    }
  }

  // Sequence ordering must be unambiguous within a parent.
  const seen = new Map<string, Set<number>>();
  for (const item of items) {
    let parent: string | null = null;
    let order: number | null = null;
    if (item.kind === 'chapter') {
      parent = `track:${item.trackId}`;
      order = item.sortOrder;
    } else if (item.kind === 'lesson') {
      parent = `chapter:${item.chapterId}`;
      order = item.sortOrder;
    }
    if (parent === null || order === null) continue;
    const used = seen.get(parent) ?? new Set<number>();
    if (used.has(order)) {
      errors.push({
        path: `items.${item.id}.sortOrder`,
        itemId: item.id,
        message: `sortOrder ${order} is already used within ${parent}`,
      });
    }
    used.add(order);
    seen.set(parent, used);
  }

  errors.push(...detectPrerequisiteCycles(items));

  // Duplicate content fingerprints catch copy-paste filler.
  const fingerprints = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'exercise' && item.kind !== 'lesson') continue;
    const fingerprint = createHash('sha256')
      .update(canonicalise({ body: item.bodyMarkdown, title: item.title }))
      .digest('hex');
    const existing = fingerprints.get(fingerprint);
    if (existing) {
      warnings.push({
        path: `items.${item.id}`,
        itemId: item.id,
        message: `content is identical to "${existing}" — duplicated filler does not teach`,
      });
    }
    fingerprints.set(fingerprint, item.id);
  }

  warnings.push({
    path: '_',
    message:
      'Reference solutions, deliberate incorrect variants and starter behaviour are verified by the content CLI at build time, not by this endpoint.',
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
    checksum: packageChecksum(pkg),
  };
}

/**
 * Suggested prerequisites form a recommendation graph over CONCEPTS. Cycles
 * are rejected at validation time even though navigation is never blocked.
 */
export function detectPrerequisiteCycles(items: ContentItem[]): ValidationIssue[] {
  const edges = new Map<string, Set<string>>();
  for (const item of items) {
    for (const concept of item.conceptIds) {
      const set = edges.get(concept) ?? new Set<string>();
      for (const prerequisite of item.prerequisiteIds) {
        if (prerequisite !== concept) set.add(prerequisite);
      }
      edges.set(concept, set);
    }
  }

  const issues: ValidationIssue[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    const current = state.get(node);
    if (current === 'done') return;
    if (current === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(node)), node].join(' -> ');
      issues.push({ path: 'prerequisites', message: `cyclic prerequisites: ${cycle}` });
      return;
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of edges.keys()) visit(node);
  return issues;
}

/** Projected columns stored alongside the payload so listings avoid JSON scans. */
export function projectionFor(item: ContentItem): {
  parentId: string | null;
  sortOrder: number;
  primaryConceptId: string | null;
} {
  switch (item.kind) {
    case 'track':
      return { parentId: null, sortOrder: 0, primaryConceptId: null };
    case 'chapter':
      return { parentId: item.trackId, sortOrder: item.sortOrder, primaryConceptId: null };
    case 'lesson':
      return { parentId: item.chapterId, sortOrder: item.sortOrder, primaryConceptId: null };
    case 'exercise':
      return {
        parentId: item.lessonId,
        sortOrder: item.sortOrder,
        primaryConceptId: item.primaryConceptId,
      };
    case 'review_card':
      return { parentId: item.lessonId, sortOrder: 0, primaryConceptId: item.primaryConceptId };
    case 'assessment':
      return { parentId: item.chapterId, sortOrder: 0, primaryConceptId: null };
    case 'mission':
      return { parentId: item.projectId, sortOrder: 0, primaryConceptId: null };
  }
}
