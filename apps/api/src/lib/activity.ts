import type { Tx } from '../db/client.js';
import type { Clock } from './clock.js';

/**
 * Recent-activity feed (spec 8.1).
 *
 * ActivityEvent is a plain append-only log that powers Today and history. It is
 * deliberately NOT an event-sourcing spine: mastery and progress are derived
 * from attempts, reveals and reviews, not replayed from here.
 */

export type ActivityKind =
  | 'lesson_started'
  | 'lesson_completed'
  | 'lesson_skipped'
  | 'exercise_attempted'
  | 'hint_revealed'
  | 'solution_revealed'
  | 'review_completed'
  | 'placement_submitted'
  | 'mission_started'
  | 'mission_completed'
  | 'note_created'
  | 'bookmark_added'
  | 'release_published'
  | 'release_activated';

export interface RecordActivityInput {
  userId: string;
  kind: ActivityKind;
  contentItemId?: string | null;
  relatedRecordId?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function recordActivity(
  tx: Tx,
  clock: Clock,
  input: RecordActivityInput,
): Promise<void> {
  await tx.activityEvent.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      contentItemId: input.contentItemId ?? null,
      relatedRecordId: input.relatedRecordId ?? null,
      detail: (input.detail ?? undefined) as object | undefined,
      createdAt: clock.now(),
    },
  });
}
