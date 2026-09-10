import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prisma } from '../db/client.js';

/**
 * Development seed.
 *
 * Seeds ONLY the stable concept catalogue that authored content references.
 * Lessons, exercises and cards are never seeded here — they arrive through a
 * validated content package import, so the development database goes through
 * exactly the same publication path as production (spec 10.4).
 *
 * The catalogue is read from curriculum/concepts.json rather than duplicated
 * here. An earlier version of this script carried its own hand-written copy,
 * which silently drifted from the authored catalogue: it held 70 concepts
 * against the catalogue's 115, and had diverged on ids (`web.client-server`
 * here versus `web.client-vs-server` in the catalogue). Authored content
 * references the catalogue's ids, so a stale duplicate produces content that
 * cannot resolve its own concepts. One source of truth avoids that entirely.
 */

interface ConceptSeed {
  id: string;
  title: string;
  description: string;
  release?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGUE = resolve(HERE, '../../../../curriculum/concepts.json');

function loadCatalogue(): ConceptSeed[] {
  const raw: unknown = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const list: unknown = Array.isArray(raw) ? raw : (raw as { concepts?: unknown }).concepts;
  if (!Array.isArray(list)) {
    throw new Error(`Concept catalogue at ${CATALOGUE} did not contain a concepts array.`);
  }
  return list.map((entry, index) => {
    const c = entry as Partial<ConceptSeed>;
    if (!c.id || !c.title || !c.description) {
      throw new Error(`Concept catalogue entry ${index} is missing id, title or description.`);
    }
    return { id: c.id, title: c.title, description: c.description };
  });
}

async function main(): Promise<void> {
  const concepts = loadCatalogue();
  for (const concept of concepts) {
    await prisma.concept.upsert({
      where: { id: concept.id },
      create: { id: concept.id, title: concept.title, description: concept.description },
      update: { title: concept.title, description: concept.description },
    });
  }
  console.log(`Seeded ${concepts.length} concepts from ${CATALOGUE}.`);
  console.log('Import a validated content package to add lessons and exercises.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
