/**
 * MISSION checks - these FAIL on a fresh checkout. That is the assignment.
 *
 * They do not fail because a clean first run is wrong; the baseline proves it is
 * right. They fail on the SECOND run. A job that cannot be rerun safely is a job
 * you cannot operate: every retry, every redeploy part-way through a run, and
 * every duplicated scheduler tick is a second run.
 *
 * A word on what is being claimed, because it is the vocabulary the reflection
 * asks for. The runner is invoked AT LEAST ONCE and may be invoked again at any
 * moment; nothing here makes the invocation happen exactly once, and no code
 * could. What these checks require is that the committed EFFECT - the set of
 * ReportLine rows belonging to a job - ends up written exactly once, however
 * many invocations it took to get there.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  PRODUCTS,
  enqueueJob,
  jobRow,
  linesOf,
  expectedReport,
  failBeforeItem,
} from './helpers.js';
import { runReportJob } from '../src/jobs/report.js';

const TOTAL_PRODUCTS = PRODUCTS.length;

describe('M08 a rerun resumes instead of repeating', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the failure injection really does interrupt the run, so this suite measures something', async () => {
    const jobId = await enqueueJob();
    const outcome = await runReportJob(jobId, { beforeItem: failBeforeItem(2) });

    // A guard on the instrument. If the hook were never called, every check
    // below would pass vacuously against a job that simply ran to completion.
    expect(outcome.status).toBe('failed');
    expect(outcome.linesWritten, 'two products are written before the failure').toBe(2);
    expect(await prisma.reportLine.count()).toBe(2);
    expect(TOTAL_PRODUCTS, 'the fixture needs more products than the failure point').toBeGreaterThan(3);
  });

  it('a rerun after a partial failure completes the job', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId, { beforeItem: failBeforeItem(2) });

    const second = await runReportJob(jobId);
    expect(second.status, 'the rerun must finish the job, not die on work already committed').toBe(
      'succeeded',
    );
    expect((await jobRow(jobId)).status).toBe('succeeded');
  });

  it('a rerun writes only the work that was missing', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId, { beforeItem: failBeforeItem(2) });
    const second = await runReportJob(jobId);

    expect(
      second.linesWritten,
      `the first attempt committed 2 lines, so the resume owes ${TOTAL_PRODUCTS - 2}`,
    ).toBe(TOTAL_PRODUCTS - 2);
  });

  it('leaves exactly one line per product, with the right numbers', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId, { beforeItem: failBeforeItem(2) });
    await runReportJob(jobId);

    const lines = await linesOf(jobId);
    expect(lines).toHaveLength(TOTAL_PRODUCTS);
    expect(new Set(lines.map((line) => line.productId)).size).toBe(TOTAL_PRODUCTS);

    const expected = await expectedReport();
    expect(
      lines.map((line) => ({ productId: line.productId, onHand: line.onHand, value: line.value })),
    ).toEqual(expected);
  });

  it('counts both attempts, so the history is not rewritten', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId, { beforeItem: failBeforeItem(2) });
    await runReportJob(jobId);

    expect((await jobRow(jobId)).attempts, 'this job was attempted twice').toBe(2);
  });

  it('records why the attempt failed', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId, { beforeItem: failBeforeItem(1) });

    const job = await jobRow(jobId);
    expect(job.status).toBe('failed');
    expect(job.lastError, 'an operator needs to know what went wrong').toContain('Injected failure');
  });
});

describe('M08 a job that already succeeded does nothing', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reports that it was skipped and writes no lines', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId);

    const again = await runReportJob(jobId);
    expect(again.status).toBe('skipped');
    expect(again.linesWritten).toBe(0);
    expect(await linesOf(jobId)).toHaveLength(TOTAL_PRODUCTS);
  });

  it('does not count a skipped invocation as an attempt', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId);
    await runReportJob(jobId);

    const job = await jobRow(jobId);
    expect(job.status).toBe('succeeded');
    expect(job.attempts, 'nothing was attempted the second time').toBe(1);
  });
});

describe('M08 attempts are capped and delayed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('moves runAfter forward after a failure, so a retry is not immediate', async () => {
    const jobId = await enqueueJob();
    const before = (await jobRow(jobId)).runAfter;

    await runReportJob(jobId, { beforeItem: failBeforeItem(0) });

    const after = (await jobRow(jobId)).runAfter;
    expect(after.getTime(), 'a job that just failed is not due again this instant').toBeGreaterThan(
      before.getTime(),
    );
  });

  it('backs off further on each successive failure', async () => {
    const jobId = await enqueueJob({ maxAttempts: 5 });

    await runReportJob(jobId, { beforeItem: failBeforeItem(0) });
    const firstDelay = (await jobRow(jobId)).runAfter.getTime();

    await runReportJob(jobId, { beforeItem: failBeforeItem(0) });
    const secondDelay = (await jobRow(jobId)).runAfter.getTime();

    expect(secondDelay, 'a second failure should wait longer than the first').toBeGreaterThan(
      firstDelay,
    );
  });

  it('stops attempting once maxAttempts is reached', async () => {
    const jobId = await enqueueJob({ maxAttempts: 2 });

    await runReportJob(jobId, { beforeItem: failBeforeItem(0) });
    await runReportJob(jobId, { beforeItem: failBeforeItem(0) });

    const exhausted = await jobRow(jobId);
    expect(exhausted.attempts).toBe(2);
    expect(exhausted.status).toBe('failed');

    const third = await runReportJob(jobId);
    expect(third.status, 'a job out of attempts must not be picked up again').toBe('skipped');
    expect((await jobRow(jobId)).attempts, 'a refused run is not an attempt').toBe(2);
  });

  it('an exhausted job keeps whatever it did commit, for an operator to inspect', async () => {
    const jobId = await enqueueJob({ maxAttempts: 1 });
    await runReportJob(jobId, { beforeItem: failBeforeItem(2) });

    expect(await linesOf(jobId)).toHaveLength(2);
    expect((await jobRow(jobId)).status).toBe('failed');
  });
});

describe('M08 two workers cannot run one job twice', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * The claim has to be ONE atomic statement. A read followed by a write leaves
   * a gap, and two workers that both read `pending` will both proceed - which is
   * not hypothetical, it is what a deployment with two overlapping schedulers
   * does every single time.
   */
  it('exactly one of two concurrent runs does the work', async () => {
    const jobId = await enqueueJob();

    const [a, b] = await Promise.all([runReportJob(jobId), runReportJob(jobId)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses, `got ${statuses.join(' and ')}`).toEqual(['skipped', 'succeeded']);
    expect(a.linesWritten + b.linesWritten).toBe(TOTAL_PRODUCTS);
  });

  it('leaves one line per product after a concurrent double run', async () => {
    const jobId = await enqueueJob();
    await Promise.all([runReportJob(jobId), runReportJob(jobId)]);

    const lines = await linesOf(jobId);
    expect(lines).toHaveLength(TOTAL_PRODUCTS);
    expect(new Set(lines.map((line) => line.productId)).size).toBe(TOTAL_PRODUCTS);
  });

  it('counts one attempt, not two, for a concurrent double run', async () => {
    const jobId = await enqueueJob();
    await Promise.all([runReportJob(jobId), runReportJob(jobId)]);

    expect((await jobRow(jobId)).attempts).toBe(1);
  });
});

describe('M08 the failure itself is not swallowed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('an injected failure is reported as a failure, never as success', async () => {
    const jobId = await enqueueJob();
    const outcome = await runReportJob(jobId, { beforeItem: failBeforeItem(1) });

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('Injected failure');
  });
});
