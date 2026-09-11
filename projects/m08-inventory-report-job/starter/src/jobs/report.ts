import { prisma } from '../db.js';

/**
 * STARTER — M08. THIS IS THE FILE YOU CHANGE.
 *
 * A nightly stock-valuation report. For every product it writes one ReportLine
 * holding the quantity on hand and its value, and then marks the job succeeded.
 *
 * On a first run, on a quiet machine, it works. `check:baseline` proves that
 * much: a fresh job produces one line per product with the right numbers.
 *
 * It is not safe to RERUN, and a background job that cannot be rerun is a job
 * you cannot operate. Four things are wrong, and the mission checks pin each:
 *
 *   1. A rerun after a partial failure repeats work already committed. The
 *      unique index on (jobId, productId) stops the duplicate row from being
 *      stored — so instead of quietly duplicating, the rerun dies on the first
 *      product it already did and the job can never finish. A loud failure is
 *      still a failure. Resuming means doing the REMAINING work.
 *
 *   2. A job that already succeeded runs all over again.
 *
 *   3. `maxAttempts` and `runAfter` are in the schema and never used. Nothing
 *      stops a hopeless job retrying forever, and nothing delays the next try.
 *
 *   4. The claim is a read followed by a write. Two workers can both read
 *      `pending` and both proceed, because nothing between the two round trips
 *      stops them.
 *
 * A note on vocabulary you will need in the reflection: this runner is invoked
 * AT LEAST ONCE per job and may be invoked again at any time. You cannot make
 * the invocation happen exactly once. What you can make exactly once is its
 * committed EFFECT — the set of ReportLine rows. Say which of the two you mean.
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

  // A read, then a write. Nothing here prevents a second worker that read the
  // same row a millisecond ago from doing all of this as well.
  await prisma.reportJob.update({
    where: { id: job.id },
    data: { status: 'running', attempts: { increment: 1 } },
  });
  const attempts = job.attempts + 1;

  const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
  let linesWritten = 0;

  try {
    for (const [index, product] of products.entries()) {
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
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: message },
    });
    return { status: 'failed', linesWritten, attempts, detail: message };
  }
}

/**
 * Run every job that is due, oldest first. This is the entry point a scheduler
 * or `npm run job:run` uses; the interesting logic is all in runReportJob.
 */
export async function runDueJobs(options: RunOptions = {}): Promise<RunOutcome[]> {
  const due = await prisma.reportJob.findMany({
    where: { status: 'pending', runAfter: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
  });
  const outcomes: RunOutcome[] = [];
  for (const job of due) outcomes.push(await runReportJob(job.id, options));
  return outcomes;
}
