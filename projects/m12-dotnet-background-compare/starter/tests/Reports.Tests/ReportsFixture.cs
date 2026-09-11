using Microsoft.EntityFrameworkCore;
using Reports.Api;
using Xunit;

namespace Reports.Tests;

public class ReportsFixture : IAsyncLifetime
{
    public static string ConnectionString =>
        Environment.GetEnvironmentVariable("REPORTS_TEST_CONNECTION")
        ?? "Host=127.0.0.1;Port=5440;Database=m12_reports_test;Username=postgres";

    public ReportsContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ReportsContext>()
            .UseNpgsql(ConnectionString)
            .Options;
        return new ReportsContext(options);
    }

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task<Guid> ResetWithJobAsync(string reference = "REP-1")
    {
        await using var db = NewContext();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE \"Rows\", \"Jobs\" RESTART IDENTITY CASCADE;");

        var job = new ReportJob { Reference = reference };
        db.Jobs.Add(job);
        await db.SaveChangesAsync();
        return job.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;
}

[CollectionDefinition("reports")]
public class ReportsCollection : ICollectionFixture<ReportsFixture>;
