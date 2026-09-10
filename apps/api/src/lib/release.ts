import type { ContentKind, ContentVersion } from '@prisma/client';
import type { Tx } from '../db/client.js';
import { problem } from './errors.js';
import type { OwnerContext } from './auth-context.js';

/**
 * Reading content through the owner's ACTIVE release (spec 8.2).
 *
 * A published release is an immutable map of stable item id -> version. Every
 * read goes through it, so activating an earlier release changes what is shown
 * without touching a single attempt, note or bookmark.
 */

export async function requireActiveReleaseId(tx: Tx, owner: OwnerContext): Promise<string> {
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

/** Resolve one stable item id to its version in the active release. */
export async function resolveItem(
  tx: Tx,
  releaseId: string,
  itemId: string,
  expectedKind?: ContentKind,
): Promise<ContentVersion> {
  const row = await tx.releaseItem.findUnique({
    where: { releaseId_itemId: { releaseId, itemId } },
    include: { version: true },
  });
  if (!row) throw problem.notFound('That content is not part of the active release.');
  if (expectedKind && row.version.kind !== expectedKind) {
    throw problem.notFound('That content is not part of the active release.');
  }
  return row.version;
}

/** Resolve without throwing — used where archived content is expected. */
export async function findItem(
  tx: Tx,
  releaseId: string,
  itemId: string,
): Promise<ContentVersion | null> {
  const row = await tx.releaseItem.findUnique({
    where: { releaseId_itemId: { releaseId, itemId } },
    include: { version: true },
  });
  return row?.version ?? null;
}

/** All items of a kind, in authored order. Indexed by (releaseId, kind, ...). */
export async function listByKind(
  tx: Tx,
  releaseId: string,
  kind: ContentKind,
): Promise<ContentVersion[]> {
  const rows = await tx.releaseItem.findMany({
    where: { releaseId, kind },
    include: { version: true },
    orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }],
  });
  return rows.map((r) => r.version);
}

/**
 * Latest known version of an item regardless of release membership, so a note
 * or bookmark on archived content can still show what it pointed at.
 */
export async function latestVersionOf(tx: Tx, itemId: string): Promise<ContentVersion | null> {
  return tx.contentVersion.findFirst({
    where: { itemId },
    orderBy: { version: 'desc' },
  });
}
