import { prisma } from '../db.js';
import { runDueJobs } from './report.js';

/**
 * `npm run job:run` - one pass of the worker, for playing with the job by hand.
 * A real deployment would call this on a schedule; a loop here would only hide
 * the state machine the mission is about.
 */
runDueJobs()
  .then((outcomes) => {
    if (outcomes.length === 0) {
      console.log('Nothing due.');
      return;
    }
    for (const outcome of outcomes) {
      console.log(`${outcome.status}: ${outcome.linesWritten} line(s), attempt ${outcome.attempts}`, outcome.detail ?? '');
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
