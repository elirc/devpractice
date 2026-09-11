using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

/// <summary>
/// MISSION — three defects, described by behaviour rather than by line number.
/// These FAIL before you repair the code.
/// </summary>
[Collection("api")]
[Trait("Category", "Mission")]
public class MissionTests(ApiFixture fixture)
{
    private static readonly Guid RosaTicket = Guid.Parse("dddd0000-0000-0000-0000-000000000011");
    private static readonly Guid AdeTicket = Guid.Parse("dddd0000-0000-0000-0000-000000000020");

    // ---- defect 1: resource ownership ----

    [Fact]
    public async Task a_dispatcher_cannot_read_another_dispatchers_ticket()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var response = await rosa.GetAsync($"/tickets/{AdeTicket}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task a_dispatcher_cannot_read_another_dispatchers_comments()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var response = await rosa.GetAsync($"/tickets/{AdeTicket}/comments");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task a_dispatcher_cannot_rename_another_dispatchers_ticket()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var response = await rosa.PatchAsJsonAsync($"/tickets/{AdeTicket}", new { title = "seized" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        await using var db = fixture.NewContext();
        var ade = await db.Tickets.AsNoTracking().FirstAsync(t => t.Id == AdeTicket);
        Assert.Equal("Ade ticket", ade.Title);
    }

    [Fact]
    public async Task a_foreign_ticket_is_404_and_leaks_nothing_about_it()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var response = await rosa.GetAsync($"/tickets/{AdeTicket}");
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("Ade", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Ferry Lane", body, StringComparison.OrdinalIgnoreCase);
    }

    // ---- defect 2: N+1 on the list ----

    [Fact]
    public async Task listing_tickets_does_not_issue_a_query_per_row()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        fixture.Sql.Start();
        var payload = await rosa.GetFromJsonAsync<Envelope<List<TicketSummaryDto>>>("/tickets");
        fixture.Sql.Stop();

        Assert.NotNull(payload);
        Assert.Equal(2, payload!.Data.Count);
        Assert.Equal(2, payload.Data[0].CommentCount);

        // Two tickets must not cost three round trips. One query is enough:
        // the comment count can be computed in the projection.
        Assert.True(fixture.Sql.SelectCount <= 1,
            $"listing 2 tickets issued {fixture.Sql.SelectCount} SELECT statements: {string.Join(" | ", fixture.Sql.Commands)}");
    }

    // ---- defect 3: projection and tracking ----

    [Fact]
    public async Task the_detail_query_does_not_load_the_comment_graph_it_never_returns()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        fixture.Sql.Start();
        var response = await rosa.GetAsync($"/tickets/{RosaTicket}");
        fixture.Sql.Stop();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var sql = string.Join(" | ", fixture.Sql.Commands);
        // TicketDto carries no comments, so joining them is pure waste.
        Assert.DoesNotContain("Comments", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task read_only_queries_do_not_track_entities()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        fixture.Sql.Start();
        var response = await rosa.GetAsync($"/tickets/{RosaTicket}/comments");
        fixture.Sql.Stop();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var sql = string.Join(" | ", fixture.Sql.Commands);
        // Comments should be queried directly and filtered in SQL, not pulled
        // through the ticket graph and sorted in memory.
        Assert.Contains("FROM \"Comments\"", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("LEFT JOIN", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task comments_still_come_back_in_order_for_the_owner()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var payload = await rosa.GetFromJsonAsync<Envelope<List<CommentDto>>>(
            $"/tickets/{RosaTicket}/comments");

        Assert.NotNull(payload);
        Assert.Equal(2, payload!.Data.Count);
        Assert.Equal("Rosa Little", payload.Data[0].Author);
    }
}
