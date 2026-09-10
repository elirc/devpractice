import { z } from 'zod';
import { problem } from './errors.js';

/**
 * Zod parsing at the route boundary.
 *
 * These are application-authored static schemas. Imported course data is
 * validated by the content schema and never becomes route-validator code
 * (spec 5.3).
 */

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parse a request body/query/params, converting failures into a 400. */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  message = 'Malformed request.',
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw problem.badRequest(message, fieldErrorsOf(result.error));
  }
  return result.data;
}

/** Size guard applied BEFORE expensive parsing (spec 8.3). */
export function assertByteLimit(value: string, maxBytes: number, label: string): void {
  const size = Buffer.byteLength(value, 'utf8');
  if (size > maxBytes) {
    throw problem.tooLarge(`${label} exceeds the ${maxBytes} byte limit.`);
  }
}
