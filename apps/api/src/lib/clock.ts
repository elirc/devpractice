/**
 * Injectable clock.
 *
 * Every timestamp that orders records is generated server-side (spec 8), and
 * tests need to move time without sleeping, so nothing in a service calls
 * `new Date()` directly — it calls `clock.now()`.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test clock: starts at a fixed instant and only moves when told to. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(next: Date | string): void {
    this.current = new Date(next);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 24 * 60 * 60 * 1000);
  }
}
