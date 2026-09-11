using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

public class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static string ConnectionString =>
        Environment.GetEnvironmentVariable("SUPPORTDESK_TEST_CONNECTION")
        ?? "Host=127.0.0.1;Port=5440;Database=m10_efcore_test;Username=postgres";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Environment.SetEnvironmentVariable("SUPPORTDESK_CONNECTION", ConnectionString);
    }

    public SqlLog Sql => Services.GetRequiredService<SqlLog>();

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

    public async Task ResetAsync()
    {
        await using var db = NewContext();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE \"Comments\", \"Tickets\" RESTART IDENTITY CASCADE;");
    }

    /// <summary>Two fictional dispatchers, each with one ticket and comments.</summary>
    public async Task SeedTwoDispatchersAsync()
    {
        await ResetAsync();
        await using var db = NewContext();
        var t0 = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);

        var rosa = new Ticket { Id = Guid.Parse("dddd0000-0000-0000-0000-000000000011"), Title = "Rosa ticket", CustomerName = "Perch Bakery", OwnerId = Dispatchers.Rosa, CreatedAt = t0 };
        var rosa2 = new Ticket { Id = Guid.Parse("dddd0000-0000-0000-0000-000000000012"), Title = "Rosa second", CustomerName = "Halloway Books", OwnerId = Dispatchers.Rosa, CreatedAt = t0.AddMinutes(5) };
        var ade = new Ticket { Id = Guid.Parse("dddd0000-0000-0000-0000-000000000020"), Title = "Ade ticket", CustomerName = "Ferry Lane Cafe", OwnerId = Dispatchers.Ade, CreatedAt = t0.AddMinutes(10) };

        db.Tickets.AddRange(rosa, rosa2, ade);
        db.Comments.AddRange(
            new Comment { TicketId = rosa.Id, Author = "Rosa Little", Body = "a", CreatedAt = t0 },
            new Comment { TicketId = rosa.Id, Author = "Perch Bakery", Body = "b", CreatedAt = t0.AddMinutes(1) },
            new Comment { TicketId = rosa2.Id, Author = "Rosa Little", Body = "c", CreatedAt = t0.AddMinutes(2) },
            new Comment { TicketId = ade.Id, Author = "Ade Nwosu", Body = "d", CreatedAt = t0.AddMinutes(3) });
        await db.SaveChangesAsync();
    }

    public HttpClient ClientFor(Guid dispatcher)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(CurrentDispatcher.HeaderName, dispatcher.ToString());
        return client;
    }

    public new async Task DisposeAsync() => await base.DisposeAsync();
}

[CollectionDefinition("api")]
public class ApiCollection : ICollectionFixture<ApiFixture>;
