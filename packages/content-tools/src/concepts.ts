import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * The stable concept catalog. Concept ids are the spine of the evidence model,
 * so they are declared once here and only referenced by authored content.
 * An id is never reused for a different idea.
 */
export const conceptCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    concepts: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[a-z0-9]+(\.[a-z0-9]+(-[a-z0-9]+)*)+$/, 'concept ids look like js.array-filter'),
          title: z.string().min(1).max(120),
          description: z.string().min(1).max(600),
          /** Which release first needs this concept. */
          release: z.enum(['v1', 'v2', 'v3']),
        }),
      )
      .min(1),
  })
  .strict();

export type ConceptCatalog = z.infer<typeof conceptCatalogSchema>;

export async function loadConceptCatalog(path: string): Promise<ConceptCatalog> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const parsed = conceptCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`${path} is not a valid concept catalog:\n  ${detail}`);
  }
  const seen = new Set<string>();
  for (const concept of parsed.data.concepts) {
    if (seen.has(concept.id)) throw new Error(`${path}: duplicate concept id '${concept.id}'`);
    seen.add(concept.id);
  }
  return parsed.data;
}
