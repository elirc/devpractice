import type { ContentKind, Prisma, ReleaseState } from '@prisma/client';
import type {
  AssessmentItem,
  ChapterItem,
  ContentItem,
  ExerciseItem,
  LessonItem,
  MissionItem,
  ReviewCardItem,
  TrackItem,
} from '@devpractice/contracts';
import type { Tx } from '../../db/client.js';
import type { OwnerContext } from '../../lib/auth-context.js';
import { problem } from '../../lib/errors.js';

/**
 * Release resolution and content loading (spec 8.2).
 *
 * A published release is an immutable map of stable item id -> ContentVersion.
 * Listing queries read the PROJECTED columns (kind, parentId, sortOrder,
 * title) so rendering a curriculum page never scans every JSON payload; the
 * payload is loaded only for the bounded set of items actually rendered.
 */

export interface LoadedVersion<T extends ContentItem = ContentItem> {
  versionId: string;
  itemId: string;
  version: number;
  masteryRevision: number;
  kind: ContentKind;
  parentId: string | null;
  sortOrder: number;
  title: string;
  payload: T;
}

/** Lightweight row used for catalogue listings; carries no payload. */
export interface CatalogRow {
  itemId: string;
  versionId: string;
  kind: ContentKind;
  parentId: string | null;
  sortOrder: number;
  title: string;
  masteryRevision: number;
}

export async function requireActiveReleaseId(
  tx: Tx,
  owner: OwnerContext,
): Promise<string> {
  if (owner.activeReleaseId) return owner.activeReleaseId;
  const user = await tx.user.findUnique({
    where: { id: owner.userId },
    select: { activeReleaseId: true },
  });
  if (!user?.activeReleaseId) {
    throw problem.notFound('No published content release is active yet.');
  }
  return user.activeReleaseId;
}

const catalogSelect = {
  itemId: true,
  versionId: true,
  kind: true,
  parentId: true,
  sortOrder: true,
  version: { select: { title: true, masteryRevision: true } },
} satisfies Prisma.ReleaseItemSelect;

function toCatalogRow(row: {
  itemId: string;
  versionId: string;
  kind: ContentKind;
  parentId: string | null;
  sortOrder: number;
  version: { title: string; masteryRevision: number };
}): CatalogRow {
  return {
    itemId: row.itemId,
    versionId: row.versionId,
    kind: row.kind,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    title: row.version.title,
    masteryRevision: row.version.masteryRevision,
  };
}

/** Projected-column listing; no JSON payload is read. */
export async function listCatalog(
  tx: Tx,
  releaseId: string,
  kind: ContentKind,
  parentId?: string,
): Promise<CatalogRow[]> {
  const rows = await tx.releaseItem.findMany({
    where: { releaseId, kind, ...(parentId === undefined ? {} : { parentId }) },
    select: catalogSelect,
    orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }],
  });
  return rows.map(toCatalogRow);
}

/** Counts by parent using projected columns only. */
export async function countByParent(
  tx: Tx,
  releaseId: string,
  kind: ContentKind,
): Promise<Map<string, number>> {
  const grouped = await tx.releaseItem.groupBy({
    by: ['parentId'],
    where: { releaseId, kind },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of grouped) {
    if (row.parentId) counts.set(row.parentId, row._count._all);
  }
  return counts;
}

export async function loadItem<T extends ContentItem>(
  tx: Tx,
  releaseId: string,
  itemId: string,
  expectedKind: ContentKind,
): Promise<LoadedVersion<T>> {
  const row = await tx.releaseItem.findUnique({
    where: { releaseId_itemId: { releaseId, itemId } },
    include: { version: true },
  });
  if (!row || row.kind !== expectedKind) throw problem.notFound();
  return {
    versionId: row.versionId,
    itemId: row.itemId,
    version: row.version.version,
    masteryRevision: row.version.masteryRevision,
    kind: row.kind,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    title: row.version.title,
    payload: row.version.payload as unknown as T,
  };
}

export async function loadItems<T extends ContentItem>(
  tx: Tx,
  releaseId: string,
  itemIds: string[],
  expectedKind: ContentKind,
): Promise<LoadedVersion<T>[]> {
  if (itemIds.length === 0) return [];
  const rows = await tx.releaseItem.findMany({
    where: { releaseId, itemId: { in: itemIds }, kind: expectedKind },
    include: { version: true },
  });
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  // Preserve the authored order rather than the database's.
  return itemIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        versionId: row.versionId,
        itemId: row.itemId,
        version: row.version.version,
        masteryRevision: row.version.masteryRevision,
        kind: row.kind,
        parentId: row.parentId,
        sortOrder: row.sortOrder,
        title: row.version.title,
        payload: row.version.payload as unknown as T,
      },
    ];
  });
}

/**
 * Resolve a ContentVersion by id for an ATTEMPT. Any version that belongs to a
 * release that has BEEN published is acceptable, so an in-flight attempt can
 * finish against the version the learner actually loaded even after a newer
 * release activates.
 *
 * `superseded` counts: it is what a published release becomes the moment
 * another one is published or an earlier one is reactivated (spec 2.1 scenario
 * C, "existing attempts still point at the versions they used", and A18).
 * Accepting only `published` would leave exactly one release resolvable — the
 * active one — which is the opposite of the guarantee, and would make the
 * `contentUpdated` notice on POST /attempts unreachable. Only `draft` (never
 * released to the learner) and `invalid` are refused.
 */
export interface PublishedVersion<T extends ContentItem = ContentItem> {
  versionId: string;
  itemId: string;
  version: number;
  masteryRevision: number;
  kind: ContentKind;
  payload: T;
  /** False when a newer release has since superseded this version. */
  isInActiveRelease: boolean;
}

/** States a release reaches only by having been published to the learner. */
const RELEASED_STATES: ReadonlySet<ReleaseState> = new Set<ReleaseState>([
  'published',
  'superseded',
]);

export async function loadPublishedVersion<T extends ContentItem = ContentItem>(
  tx: Tx,
  versionId: string,
  activeReleaseId: string | null,
): Promise<PublishedVersion<T>> {
  const version = await tx.contentVersion.findUnique({
    where: { id: versionId },
    include: {
      releaseItems: {
        select: { releaseId: true, release: { select: { state: true } } },
      },
    },
  });
  if (!version) throw problem.notFound();

  const publishedIn = version.releaseItems.filter((ri) => RELEASED_STATES.has(ri.release.state));
  if (publishedIn.length === 0) {
    throw problem.notFound('That content version has never been published.');
  }

  return {
    versionId: version.id,
    itemId: version.itemId,
    version: version.version,
    masteryRevision: version.masteryRevision,
    kind: version.kind,
    payload: version.payload as unknown as T,
    isInActiveRelease:
      activeReleaseId !== null && publishedIn.some((ri) => ri.releaseId === activeReleaseId),
  };
}

export type LoadedTrack = LoadedVersion<TrackItem>;
export type LoadedChapter = LoadedVersion<ChapterItem>;
export type LoadedLesson = LoadedVersion<LessonItem>;
export type LoadedExercise = LoadedVersion<ExerciseItem>;
export type LoadedCard = LoadedVersion<ReviewCardItem>;
export type LoadedAssessment = LoadedVersion<AssessmentItem>;
export type LoadedMission = LoadedVersion<MissionItem>;
