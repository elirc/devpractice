import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CONTENT_SCHEMA_VERSION } from '@devpractice/contracts';

/**
 * Snapshot assembly (spec §10.1).
 *
 * V1 packages are mode=snapshot: a COMPLETE desired release manifest. Authors
 * write one file per chapter; adding a chapter means re-assembling every
 * existing chapter file plus the new one into a fresh snapshot. A single
 * chapter file is NOT a publishable package, and the CLI says so.
 */

export const releaseManifestSchema = z
  .object({
    packageId: z.string().min(1),
    packageVersion: z.string().min(1),
    title: z.string().min(1),
    baseReleaseId: z.string().uuid().nullable().default(null),
    /** Chapter source files, in order, relative to the curriculum directory. */
    chapterFiles: z.array(z.string().min(1)).min(1),
    assets: z
      .array(z.object({ id: z.string().min(1), path: z.string().min(1), checksum: z.string().min(1) }))
      .default([]),
  })
  .strict();

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

const chapterFileSchema = z
  .object({
    /** Free-text note for authors; not part of the published package. */
    note: z.string().optional(),
    items: z.array(z.unknown()).min(1),
  })
  .strict();

export interface AssembledSnapshot {
  raw: unknown;
  checksum: string;
  sourceByItemId: Map<string, string>;
}

export function checksumOf(pkg: unknown): string {
  return createHash('sha256').update(stableStringify(pkg)).digest('hex');
}

/** Key order must not change the checksum. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export async function loadManifest(curriculumDir: string): Promise<ReleaseManifest> {
  const path = join(curriculumDir, 'release.json');
  if (!existsSync(path)) {
    throw new Error(
      `No release manifest at ${path}. Create one listing packageId, packageVersion, title and chapterFiles.`,
    );
  }
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const parsed = releaseManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${path} is invalid:\n  ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
    );
  }
  return parsed.data;
}

export async function assembleSnapshot(
  curriculumDir: string,
  manifest: ReleaseManifest,
): Promise<AssembledSnapshot> {
  const items: unknown[] = [];
  const sourceByItemId = new Map<string, string>();

  for (const relative of manifest.chapterFiles) {
    const path = join(curriculumDir, relative);
    if (!existsSync(path)) {
      throw new Error(`Chapter file listed in release.json is missing: ${path}`);
    }
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    const parsed = chapterFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${path} is not a chapter source file:\n  ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
      );
    }
    for (const item of parsed.data.items) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') {
        const previous = sourceByItemId.get(id);
        if (previous) {
          throw new Error(`Item '${id}' appears in both ${previous} and ${relative}`);
        }
        sourceByItemId.set(id, relative);
      }
      items.push(item);
    }
  }

  const raw = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    baseReleaseId: manifest.baseReleaseId,
    mode: 'snapshot' as const,
    title: manifest.title,
    items,
    assets: manifest.assets,
  };

  return { raw, checksum: checksumOf(raw), sourceByItemId };
}

/** Chapter files present on disk but absent from release.json. */
export async function findOrphanChapterFiles(
  curriculumDir: string,
  manifest: ReleaseManifest,
): Promise<string[]> {
  const chaptersDir = join(curriculumDir, 'chapters');
  if (!existsSync(chaptersDir)) return [];
  const listed = new Set(manifest.chapterFiles.map((f) => f.replace(/\\/g, '/')));
  const entries = await readdir(chaptersDir);
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => `chapters/${name}`)
    .filter((relative) => !listed.has(relative));
}
