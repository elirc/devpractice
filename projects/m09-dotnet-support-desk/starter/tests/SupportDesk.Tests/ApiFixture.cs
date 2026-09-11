using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

/// <summary>
/// Boots the real application against a DEDICATED learning database.
///
/// This database is separate from the DevPractice platform database and from
/// every other mission's database: a training exercise must never be able to
/// touch the platform's learning records.
/// </summary>
public class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static string ConnectionString =>
        Environment.GetEnvironmentVariable("SUPPORTDESK_TEST_CONNECTION")
        ?? "Host=127.0.0.1;Port=5440;Database=m09_supportdesk_test;Username=postgres";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Environment.SetEnvironmentVariable("SUPPORTDESK_CONNECTION", ConnectionString);
    }

    public SupportDeskContext NewContext()
    {
        var options = new DbContextOptionsBuilder<SupportDeskContext>()
            .UseNpgsql(ConnectionString)
            .Options;
        return new SupportDeskContext(options);
    }

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureCreatedAsync();
    }

    /// <summary>Empty the tables so each test starts from a known state.</summary>
    public async Task ResetAsync()
    {
        await using var db = NewContext();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE \"Comments\", \"Tickets\" RESTART IDENTITY CASCADE;");
    }

    public HttpClient ClientFor(Guid dispatcher)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(CurrentDispatcher.HeaderName, dispatcher.ToString());
        return client;
    }

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
    }
}

[CollectionDefinition("api")]
public class ApiCollection : ICollectionFixture<ApiFixture>;
