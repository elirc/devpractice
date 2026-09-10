import type { ActivityEventDto } from '@devpractice/contracts';

/** Human-readable timestamps and labels. No invented values. */

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/** Due-date wording for the review queue. */
export function formatDue(iso: string, now: Date = new Date()): string {
  const due = new Date(iso);
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return 'due now';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `due in ${days}d`;
}

const ACTIVITY_LABEL: Record<string, string> = {
  lesson_completed: 'Completed a lesson',
  lesson_skipped: 'Skipped a lesson',
  lesson_started: 'Started a lesson',
  attempt_passed: 'Passed an exercise',
  attempt_failed: 'Attempted an exercise',
  solution_revealed: 'Revealed a solution',
  hint_revealed: 'Revealed a hint',
  review_completed: 'Reviewed a card',
  placement_qualified: 'Placed out of a chapter',
  placement_attempted: 'Took a placement assessment',
  mission_completed: 'Reported a mission complete',
  mission_started: 'Started a mission',
  note_created: 'Wrote a note',
  release_published: 'Published a content release',
};

export function describeActivity(event: ActivityEventDto): string {
  const base = ACTIVITY_LABEL[event.kind] ?? event.kind.replace(/_/g, ' ');
  const title = typeof event.detail?.['title'] === 'string' ? (event.detail['title'] as string) : null;
  return title ? `${base}: ${title}` : base;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
