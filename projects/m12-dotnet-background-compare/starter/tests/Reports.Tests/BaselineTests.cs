using Microsoft.EntityFrameworkCore;
using Reports.Api;
using Xunit;

namespace Reports.Tests;

/// <summary>BASELINE — the runner works on the happy path.</summary>
[Collection("reports")]
[Trait("Category", "Baseline")]
public class BaselineTests(ReportsFixture fixture)
{
    [Fact]
    public async Task the_database_is_reachable()
    {
        await using var db = fixture.NewContext();
        Assert.True(await db.Database.CanConnectAsync());
    }

    [Fact]
    public async Task a_clean_run_writes_one_row_per_source_item()
    {
        var jobId = await fixture.ResetWithJobAsync();
        await using var db = fixture.NewContext();
        var runner = new ReportRunner(db);

        var job = await runner.RunAsync(jobId);

        Assert.Equal(JobState.Succeeded, job.State);

        await using var check = fixture.NewContext();
        Assert.Equal(SourceItems.Keys.Length, await check.Rows.CountAsync());
    }

    [Fact]
    public async Task the_unique_index_stops_the_same_item_being_written_twice()
    {
        var jobId = await fixture.ResetWithJobAsync();
        await using var db = fixture.NewContext();

        db.Rows.Add(new ReportRow { JobId = jobId, ItemKey = "perch-bakery", Amount = 1 });
        await db.SaveChangesAsync();

        db.Rows.Add(new ReportRow { JobId = jobId, ItemKey = "perch-bakery", Amount = 1 });
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
