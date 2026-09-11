using Microsoft.EntityFrameworkCore;

namespace Reports.Api;

/// <summary>
/// MISSION FILE.
///
/// This runner works on a quiet machine and a first run. It has two problems
/// that only appear when the world is less kind:
///
///   1. it never looks at the CancellationToken, so a shutdown or a timeout
///      cannot stop it politely;
///   2. a rerun after a partial failure repeats effects it already committed.
///
/// Compare this with the Node version you built in M08. The mechanics differ;
/// the two questions do not.
/// </summary>
public class ReportRunner(ReportsContext db)
{
    /// <summary>Injected so a test can make one item fail deterministically.</summary>
    public Func<string, bool>? FailOn { get; set; }

    /// <summary>Counts the items actually processed in THIS call.</summary>
    public int ProcessedThisRun { get; private set; }

    public async Task<ReportJob> RunAsync(Guid jobId, CancellationToken ct = default)
    {
        ProcessedThisRun = 0;

        var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId, ct)
            ?? throw new InvalidOperationException($"Unknown job {jobId}");

        job.State = JobState.Running;
        job.AttemptCount += 1;
        await db.SaveChangesAsync(ct);

        try
        {
            foreach (var key in SourceItems.Keys)
            {
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
            await db.SaveChangesAsync(ct);
            return job;
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
