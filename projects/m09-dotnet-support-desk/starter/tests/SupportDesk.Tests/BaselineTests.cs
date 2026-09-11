using System.Net;
using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

/// <summary>
/// BASELINE — proves the starter RUNS. These must pass before you write a line
/// of mission code. If one of these fails, your environment is wrong, not your
/// solution.
/// </summary>
[Collection("api")]
[Trait("Category", "Baseline")]
public class BaselineTests(ApiFixture fixture)
{
    [Fact]
    public async Task the_application_starts_and_reports_healthy()
    {
        var client = fixture.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task the_learning_database_is_reachable_and_migrated()
    {
        await using var db = fixture.NewContext();
        Assert.True(await db.Database.CanConnectAsync());
        Assert.Equal(0, await db.Tickets.CountAsync(t => t.Id == Guid.Empty));
    }

    [Fact]
    public async Task the_comment_foreign_key_is_enforced_by_the_database()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        db.Comments.Add(new Comment
        {
            TicketId = Guid.NewGuid(), // no such ticket
            Author = "Rosa Little",
            Body = "orphan",
        });

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task the_seed_is_repeatable()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();

        var first = await Seed.RunAsync(db);
        var second = await Seed.RunAsync(db);

        Assert.Equal(first, second);
        Assert.Equal(5, second.Tickets);
        Assert.Equal(3, second.Comments);
    }
}
