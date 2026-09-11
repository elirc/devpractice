import { prisma } from '../db.js';

/**
 * REFERENCE SOLUTION for M08.
 *
 * Four changes, and each one replaces a decision made by timing with a decision
 * made by the database.
 *
 * 1. THE CLAIM IS ONE STATEMENT. `updateMany` with the old status in its WHERE
 *    clause is a conditional update: PostgreSQL locks the row, re-evaluates the
 *    condition, and reports how many rows it changed. Exactly one of two
 *    concurrent workers sees `count === 1`; the other sees 0 and stops. The
 *    read-then-write version could not do this, because the decision happened in
 *    the gap between two round trips.
 *
 * 2. A RERUN RESUMES. Before processing, the runner asks which products this job
 *    has already committed and skips them. That one query is the whole
 *    difference between a resume and a repeat. Note what it is NOT: it is not a
 *    check that prevents duplicates. The unique index on (jobId, productId) is
 *    what prevents duplicates. This query is what lets the job make progress
 *    instead of dying on its own past work.
 *
 * 3. FAILURE SETS A BACKOFF AND RESPECTS A CAP. `runAfter` moves forward by a
 *    doubling delay so a failing job does not spin, and `attempts` is compared
 *    against `maxAttempts` in the claim, so a hopeless job stops being picked up
 *    instead of retrying forever.
 *
 * 4. A SUCCEEDED JOB IS NOT CLAIMABLE, so running it again is a no-op that does
 *    not touch the attempt counter. "I did nothing" and "I did the work" are
 *    different answers and the caller needs to be able to tell them apart.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE. The runner is invoked AT LEAST ONCE and
 * may be invoked again at any time; a scheduler that ticks twice, a redeploy
 * part-way through a run, and an operator pressing retry are all second
 * invocations, and nothing in this file can prevent them. What is exactly once
 * is the committed EFFECT: each (jobId, productId) line is written once, however
 * many invocations it takes. Saying "exactly-once execution" would be a claim no
 * single-process job runner can make.
 *
 * ONE LIMITATION, STATED RATHER THAN HIDDEN. A process that dies while holding a
 * claim leaves the job in `running`, and nothing here will pick it up again.
 * Recovering that needs a lease with an expiry and a heartbeat, which is a
 * bigger mechanism than this mission. The safe failure was chosen deliberately:
 * a stuck job is visible and needs a human, whereas reclaiming on a timeout
 * risks two workers on one job, which is the bug we just fixed.
 */

export interface RunOptions {
  /**
   * Test seam for failure injection. Called before each product is written, so
   * a check can make the job die part-way through and then rerun it.
   * Production code passes nothing.
   */
  beforeItem?: (productId: string, index: number) => Promise<void> | void;
}

export type RunStatus = 'succeeded' | 'failed' | 'skipped';

export interface RunOutcome {
  status: RunStatus;
  /** Lines this invocation wrote. A resume writes only what was missing. */
  linesWritten: number;
  /** The job's attempt counter after this invocation. */
  attempts: number;
  /** Why the job was skipped, or why it failed. */
  detail: string | null;
}

export class UnknownJob extends Error {
  constructor(jobId: string) {
    super(`No such report job: ${jobId}`);
    this.name = 'UnknownJob';
  }
}

/** Doubling backoff, in seconds, from the attempt that just failed. */
const BASE_BACKOFF_SECONDS = 30;

function backoffFrom(attempts: number): Date {
  const seconds = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attempts - 1);
  return new Date(Date.now() + seconds * 1000);
}

/** On-hand quantity for one product, read from the movement ledger. */
async function onHandOf(productId: string): Promise<number> {
  const result = await prisma.stockMovement.aggregate({
    where: { productId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export async function runReportJob(jobId: string, options: RunOptions = {}): Promise<RunOutcome> {
  const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new UnknownJob(jobId);

  /*
   * The claim. Everything that decides whether this invocation may proceed is
   * in the WHERE clause of a single UPDATE:
   *
   *   - status must be pending or failed. A succeeded job is finished, and a
   *     running one belongs to somebody else.
   *   - attempts must still be below maxAttempts, so an exhausted job is not
   *     picked up.
   *
   * `runAfter` is deliberately NOT part of this condition. It says when a
   * SCHEDULER should next consider the job (see runDueJobs), not whether an
   * operator may retry it now. Conflating the two would make a manual retry
   * silently do nothing.
   */
  const claim = await prisma.reportJob.updateMany({
    where: {
      id: job.id,
      status: { in: ['pending', 'failed'] },
      attempts: { lt: job.maxAttempts },
    },
    data: { status: 'running', attempts: { increment: 1 } },
  });

  if (claim.count === 0) {
    const current = await prisma.reportJob.findUniqueOrThrow({ where: { id: job.id } });
    const detail =
      current.status === 'succeeded'
        ? 'Already succeeded; nothing to do.'
        : current.status === 'running'
          ? 'Another worker holds this job.'
          : `No attempts left (${current.attempts} of ${current.maxAttempts} used).`;
    return { status: 'skipped', linesWritten: 0, attempts: current.attempts, detail };
  }

  const attempts = job.attempts + 1;
  const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });

  // The one query that turns a rerun into a resume: what has this job already
  // committed? Everything else follows from the answer.
  const done = new Set(
    (
      await prisma.reportLine.findMany({
        where: { jobId: job.id },
        select: { productId: true },
      })
    ).map((line) => line.productId),
  );

  let linesWritten = 0;

  try {
    for (const [index, product] of products.entries()) {
      if (done.has(product.id)) continue;

      await options.beforeItem?.(product.id, index);

      const onHand = await onHandOf(product.id);
      await prisma.reportLine.create({
        data: {
          jobId: job.id,
          productId: product.id,
          onHand,
          value: onHand * product.unitPrice,
        },
      });
      linesWritten += 1;
    }

    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'succeeded', lastError: null },
    });
    return { status: 'succeeded', linesWritten, attempts, detail: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Back to `failed`, not stuck on `running`, with the next attempt delayed
    // and whatever was committed left in place for the resume to build on.
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: message, runAfter: backoffFrom(attempts) },
    });
    return { status: 'failed', linesWritten, attempts, detail: message };
  }
}

/**
 * Run every job a scheduler should consider now, oldest first. This is where
 * `runAfter` earns its place: a job that failed a moment ago is not due yet, so
 * a worker loop does not spin on it.
 */
export async function runDueJobs(options: RunOptions = {}): Promise<RunOutcome[]> {
  const due = await prisma.reportJob.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      runAfter: { lte: new Date() },
    },
    orderBy: { createdAt: 'asc' },
  });

  const outcomes: RunOutcome[] = [];
  for (const job of due) outcomes.push(await runReportJob(job.id, options));
  return outcomes;
}
