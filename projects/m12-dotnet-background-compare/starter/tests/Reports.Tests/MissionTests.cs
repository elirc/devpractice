using Microsoft.EntityFrameworkCore;
using Reports.Api;
using Xunit;

namespace Reports.Tests;

/// <summary>
/// MISSION — cancellation and rerun safety. These FAIL on the starter.
/// </summary>
[Collection("reports")]
[Trait("Category", "Mission")]
public class MissionTests(ReportsFixture fixture)
{
    [Fact]
    public async Task cancellation_is_observed_partway_through()
    {
        var jobId = await fixture.ResetWithJobAsync();
        await using var db = fixture.NewContext();

        // Cancel from INSIDE the loop, while the third item is being processed.
        // A token that is already cancelled on entry is observed by EF Core on
        // the very first query, before the runner's own code runs at all; that
        // proves nothing about the runner. Cancelling mid-run means the runner
        // itself has to notice: the third item completes, the fourth must never
        // start.
        using var cts = new CancellationTokenSource();
        var runner = new ReportRunner(db)
        {
            FailOn = key =>
            {
                if (key == "ferry-lane-cafe")
                {
                    cts.Cancel();
                }
                return false;
            },
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => runner.RunAsync(jobId, cts.Token));

        await using var check = fixture.NewContext();

        // Cancellation happens at an item boundary: a whole number of completed
        // items, never a torn write.
        Assert.Equal(3, await check.Rows.CountAsync());

        // A cancelled job is not a failed job. It goes back to the queue with
        // its committed effects intact, ready to resume.
        var job = await check.Jobs.AsNoTracking().FirstAsync(j => j.Id == jobId);
        Assert.Equal(JobState.Queued, job.State);
    }

    [Fact]
    public async Task a_rerun_after_a_partial_failure_does_not_duplicate_committed_effects()
    {
        var jobId = await fixture.ResetWithJobAsync();

        // First attempt fails on the fourth item, after three are committed.
        await using (var db = fixture.NewContext())
        {
            var runner = new ReportRunner(db) { FailOn = key => key == "quay-street-deli" };
            await Assert.ThrowsAsync<InvalidOperationException>(() => runner.RunAsync(jobId));
        }

        await using (var check = fixture.NewContext())
        {
            Assert.Equal(3, await check.Rows.CountAsync());
            Assert.Equal(JobState.Failed, (await check.Jobs.AsNoTracking().FirstAsync(j => j.Id == jobId)).State);
        }

        // Second attempt succeeds. The three already-committed rows must not be
        // written again.
        await using (var db = fixture.NewContext())
        {
            var runner = new ReportRunner(db);
            var job = await runner.RunAsync(jobId);
            Assert.Equal(JobState.Succeeded, job.State);
        }

        await using (var check = fixture.NewContext())
        {
            Assert.Equal(SourceItems.Keys.Length, await check.Rows.CountAsync());
            Assert.Equal(2, (await check.Jobs.AsNoTracking().FirstAsync(j => j.Id == jobId)).AttemptCount);
        }
    }

    [Fact]
    public async Task a_rerun_of_a_finished_job_is_a_no_op()
    {
        var jobId = await fixture.ResetWithJobAsync();

        await using (var db = fixture.NewContext())
        {
            await new ReportRunner(db).RunAsync(jobId);
        }

        await using (var db = fixture.NewContext())
        {
            var runner = new ReportRunner(db);
            await runner.RunAsync(jobId);
            Assert.Equal(0, runner.ProcessedThisRun);
        }

        await using var check = fixture.NewContext();
        Assert.Equal(SourceItems.Keys.Length, await check.Rows.CountAsync());
    }
}
