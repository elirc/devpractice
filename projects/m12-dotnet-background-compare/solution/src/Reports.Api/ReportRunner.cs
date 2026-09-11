using Microsoft.EntityFrameworkCore;

namespace Reports.Api;

/// <summary>REFERENCE SOLUTION for M12.</summary>
public class ReportRunner(ReportsContext db)
{
    public Func<string, bool>? FailOn { get; set; }

    public int ProcessedThisRun { get; private set; }

    public async Task<ReportJob> RunAsync(Guid jobId, CancellationToken ct = default)
    {
        ProcessedThisRun = 0;

        var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId, ct)
            ?? throw new InvalidOperationException($"Unknown job {jobId}");

        // Already finished: nothing to do, and re-running must not add effects.
        if (job.State == JobState.Succeeded)
        {
            return job;
        }

        job.State = JobState.Running;
        job.AttemptCount += 1;
        await db.SaveChangesAsync(ct);

        // Effects this job already committed on an earlier attempt. Resuming
        // means finishing the work, not repeating it.
        var alreadyDone = await db.Rows
            .Where(r => r.JobId == job.Id)
            .Select(r => r.ItemKey)
            .ToListAsync(ct);
        var done = alreadyDone.ToHashSet();

        try
        {
            foreach (var key in SourceItems.Keys)
            {
                // Cancellation is cooperative: a token nobody checks cannot
                // stop anything. Checking at the item boundary means we stop
                // between units of work, never half-way through one.
                ct.ThrowIfCancellationRequested();

                if (done.Contains(key))
                {
                    continue;
                }

                if (FailOn is not null && FailOn(key))
                {
                    throw new InvalidOperationException($"processing failed on {key}");
                }

                db.Rows.Add(new ReportRow
                {
                    JobId = job.Id,
                    ItemKey = key,
                    Amount = SourceItems.AmountFor(key),
                });

                await db.SaveChangesAsync(ct);
                ProcessedThisRun++;
            }

            job.State = JobState.Succeeded;
            job.CompletedAt = DateTimeOffset.UtcNow;
            job.LastError = null;
            await db.SaveChangesAsync(CancellationToken.None);
            return job;
        }
        catch (OperationCanceledException)
        {
            // A cancelled job is not a failed job: it goes back to the queue
            // with its committed effects intact, ready to resume.
            job.State = JobState.Queued;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            job.State = JobState.Failed;
            job.LastError = ex.Message;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
    }
}
