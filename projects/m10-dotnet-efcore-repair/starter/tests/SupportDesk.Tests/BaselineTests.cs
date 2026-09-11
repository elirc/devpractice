using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

/// <summary>
/// BASELINE — the starter RUNS and returns plausible data. All of these pass
/// before you change anything. That is the uncomfortable part of this mission:
/// the defects do not announce themselves as crashes.
/// </summary>
[Collection("api")]
[Trait("Category", "Baseline")]
public class BaselineTests(ApiFixture fixture)
{
    [Fact]
    public async Task the_application_starts()
    {
        var client = fixture.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task the_database_is_reachable()
    {
        await using var db = fixture.NewContext();
        Assert.True(await db.Database.CanConnectAsync());
    }

    [Fact]
    public async Task the_owning_dispatcher_can_read_their_own_ticket()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var response = await rosa.GetAsync("/tickets/dddd0000-0000-0000-0000-000000000011");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task the_list_returns_the_dispatchers_own_tickets_with_comment_counts()
    {
        await fixture.SeedTwoDispatchersAsync();
        var rosa = fixture.ClientFor(Dispatchers.Rosa);

        var payload = await rosa.GetFromJsonAsync<Envelope<List<TicketSummaryDto>>>("/tickets");
        Assert.NotNull(payload);
        Assert.Equal(2, payload!.Data.Count);
        Assert.Equal(2, payload.Data[0].CommentCount);
    }
}
