import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

/**
 * Checksums for bundled release assets (spec §10.1).
 *
 * A mission starter is a directory, not a file, so "its checksum" has to be
 * defined rather than assumed. The definition here is deliberately boring and
 * written down, because a checksum nobody can reproduce is decoration:
 *
 *   1. Walk the directory, skipping the EXCLUDED names below.
 *   2. Sort the relative paths, with '/' separators on every platform, so the
 *      Windows and POSIX answers agree.
 *   3. For each file, emit `<sha256 of its bytes>  <relative path>\n`.
 *   4. The asset checksum is the sha256 of that manifest text.
 *
 * File contents are hashed as BYTES, so a CRLF checkout and an LF checkout of
 * the same repository legitimately produce different answers. That is a
 * property of the bundle, which is what is being identified, and pretending
 * otherwise would mean normalising binary files too.
 *
 * Exclusions are the things that are not part of the assignment and not
 * reproducible across machines: installed dependencies, build output, a local
 * `.env` holding someone's own connection string, and version-control
 * metadata. `.env.example` IS included - it is authored content.
 */
export const EXCLUDED_NAMES = new Set([
  'node_modules',
  'dist',
  'bin',
  'obj',
  '.git',
  '.env',
  '.vs',
  'TestResults',
]);

export interface AssetFile {
  /** Relative path with '/' separators. */
  path: string;
  sha256: string;
}

export interface AssetChecksum {
  /** The value to put in a release manifest, including the `sha256:` prefix. */
  checksum: string;
  files: AssetFile[];
}

async function walk(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const next = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await walk(root, next)));
    } else if (entry.isFile()) {
      found.push(next);
    }
    // Symlinks are skipped: what they point at is not part of the bundle.
  }
  return found;
}

/** Compute the checksum of one asset directory. */
export async function checksumAsset(directory: string): Promise<AssetChecksum> {
  const paths = (await walk(directory)).sort();
  const files: AssetFile[] = [];
  const manifest: string[] = [];

  for (const path of paths) {
    const bytes = await readFile(join(directory, path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    files.push({ path, sha256 });
    manifest.push(`${sha256}  ${path}\n`);
  }

  const checksum = createHash('sha256').update(manifest.join(''), 'utf8').digest('hex');
  return { checksum: `sha256:${checksum}`, files };
}
