/**
 * All scheduling in this package is measured from an injected server time.
 * Nothing here reads Date.now() directly, so every rule is testable with a
 * controlled clock and no test needs to sleep (spec 14.1).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test helper: a clock the caller advances explicitly. */
export function fixedClock(start: Date | string): Clock & { set(next: Date | string): void; advanceMs(ms: number): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
    advanceMs(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MS_PER_MINUTE);
}

/** UTC calendar date key, used wherever "separate dates" is a rule. */
export function utcDateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}
