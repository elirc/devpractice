using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;
using Xunit;

namespace SupportDesk.Tests;

/// <summary>
/// MISSION — these describe the behaviour you must build. They are EXPECTED TO
/// FAIL before you start: every endpoint answers 501 Not Implemented.
///
/// This is the same HTTP contract M02 served from Node, because the M01 React
/// frontend is not changing. That is the point of the mission.
/// </summary>
[Collection("api")]
[Trait("Category", "Mission")]
public class MissionTests(ApiFixture fixture)
{
    private static readonly JsonSerializerOptions Json =
        new(JsonSerializerDefaults.Web);

    private async Task<HttpClient> FreshClientAsync()
    {
        await fixture.ResetAsync();
        return fixture.ClientFor(Dispatchers.Rosa);
    }

    [Fact]
    public async Task create_returns_201_with_the_stored_record_and_a_trimmed_title()
    {
        var client = await FreshClientAsync();

        var response = await client.PostAsJsonAsync("/tickets", new
        {
            title = "   Card reader rejects every tap   ",
            body = "Reported by phone.",
            customerName = "Perch Bakery",
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<Envelope<TicketDto>>(Json);
        Assert.NotNull(payload);
        Assert.Equal("Card reader rejects every tap", payload!.Data.Title);
        Assert.Equal("open", payload.Data.Status);
        Assert.NotEqual(Guid.Empty, payload.Data.Id);
    }

    [Fact]
    public async Task create_rejects_a_whitespace_only_title_and_writes_no_row()
    {
        var client = await FreshClientAsync();

        var response = await client.PostAsJsonAsync("/tickets", new
        {
            title = "    ",
            body = "x",
            customerName = "Perch Bakery",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var error = await response.Content.ReadFromJsonAsync<ErrorEnvelope>(Json);
        Assert.NotNull(error);
        Assert.Contains("title", JsonSerializer.Serialize(error), StringComparison.OrdinalIgnoreCase);

        await using var db = fixture.NewContext();
        Assert.Equal(0, await db.Tickets.CountAsync());
    }

    [Fact]
    public async Task list_returns_an_empty_page_rather_than_an_error_when_there_is_nothing()
    {
        var client = await FreshClientAsync();

        var response = await client.GetAsync("/tickets");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<Envelope<List<TicketDto>>>(Json);
        Assert.NotNull(payload);
        Assert.Empty(payload!.Data);
        Assert.Null(payload.Meta?.NextCursor);
    }

    [Fact]
    public async Task list_orders_by_created_at_then_id_so_the_order_is_total()
    {
        var client = await FreshClientAsync();
        await using (var db = fixture.NewContext())
        {
            // Two tickets sharing a timestamp: ordering by time alone is
            // ambiguous, so the id must break the tie deterministically.
            var shared = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
            db.Tickets.AddRange(
                new Ticket { Id = Guid.Parse("00000000-0000-0000-0000-0000000000b2"), Title = "second", CustomerName = "c", OwnerId = Dispatchers.Rosa, CreatedAt = shared },
                new Ticket { Id = Guid.Parse("00000000-0000-0000-0000-0000000000a1"), Title = "first", CustomerName = "c", OwnerId = Dispatchers.Rosa, CreatedAt = shared });
            await db.SaveChangesAsync();
        }

        var payload = await client.GetFromJsonAsync<Envelope<List<TicketDto>>>("/tickets", Json);
        Assert.NotNull(payload);
        Assert.Equal(new[] { "first", "second" }, payload!.Data.Select(t => t.Title).ToArray());
    }

    [Fact]
    public async Task cursor_pagination_covers_every_row_exactly_once()
    {
        var client = await FreshClientAsync();
        await using (var db = fixture.NewContext())
        {
            var baseTime = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
            for (var i = 0; i < 7; i++)
            {
                db.Tickets.Add(new Ticket
                {
                    Title = $"ticket {i}",
                    CustomerName = "Perch Bakery",
                    OwnerId = Dispatchers.Rosa,
                    CreatedAt = baseTime.AddMinutes(i),
                });
            }
            await db.SaveChangesAsync();
        }

        var seen = new List<Guid>();
        string? cursor = null;
        for (var page = 0; page < 10; page++)
        {
            var url = cursor is null ? "/tickets?limit=3" : $"/tickets?limit=3&cursor={Uri.EscapeDataString(cursor)}";
            var payload = await client.GetFromJsonAsync<Envelope<List<TicketDto>>>(url, Json);
            Assert.NotNull(payload);
            seen.AddRange(payload!.Data.Select(t => t.Id));
            cursor = payload.Meta?.NextCursor;
            if (cursor is null) break;
        }

        Assert.Equal(7, seen.Count);
        Assert.Equal(7, seen.Distinct().Count());
    }

    [Fact]
    public async Task list_page_size_is_bounded()
    {
        var client = await FreshClientAsync();
        await using (var db = fixture.NewContext())
        {
            for (var i = 0; i < 60; i++)
            {
                db.Tickets.Add(new Ticket
                {
                    Title = $"t{i}",
                    CustomerName = "c",
                    OwnerId = Dispatchers.Rosa,
                    CreatedAt = DateTimeOffset.UtcNow.AddSeconds(i),
                });
            }
            await db.SaveChangesAsync();
        }

        var payload = await client.GetFromJsonAsync<Envelope<List<TicketDto>>>("/tickets?limit=500", Json);
        Assert.NotNull(payload);
        Assert.True(payload!.Data.Count <= TicketEndpoints.MaxPageSize,
            $"a caller asking for 500 rows received {payload.Data.Count}");
    }

    [Fact]
    public async Task an_unknown_ticket_is_404_not_500()
    {
        var client = await FreshClientAsync();
        var response = await client.GetAsync($"/tickets/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task a_ticket_can_be_read_back_by_id()
    {
        var client = await FreshClientAsync();
        var created = await client.PostAsJsonAsync("/tickets", new
        {
            title = "Printer pairs then drops",
            body = "b",
            customerName = "Ferry Lane Cafe",
        });
        var createdPayload = await created.Content.ReadFromJsonAsync<Envelope<TicketDto>>(Json);
        Assert.NotNull(createdPayload);

        var fetched = await client.GetFromJsonAsync<Envelope<TicketDto>>(
            $"/tickets/{createdPayload!.Data.Id}", Json);

        Assert.NotNull(fetched);
        Assert.Equal("Printer pairs then drops", fetched!.Data.Title);
    }

    [Fact]
    public async Task a_comment_requires_an_existing_ticket()
    {
        var client = await FreshClientAsync();

        var response = await client.PostAsJsonAsync($"/tickets/{Guid.NewGuid()}/comments", new
        {
            author = "Rosa Little",
            body = "following up",
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        await using var db = fixture.NewContext();
        Assert.Equal(0, await db.Comments.CountAsync());
    }

    [Fact]
    public async Task comments_round_trip_for_a_real_ticket()
    {
        var client = await FreshClientAsync();
        var created = await client.PostAsJsonAsync("/tickets", new
        {
            title = "Weekly export arrives empty",
            body = "b",
            customerName = "Halloway Books",
        });
        var ticket = (await created.Content.ReadFromJsonAsync<Envelope<TicketDto>>(Json))!.Data;

        var posted = await client.PostAsJsonAsync($"/tickets/{ticket.Id}/comments", new
        {
            author = "Rosa Little",
            body = "Asked for a screenshot.",
        });
        Assert.Equal(HttpStatusCode.Created, posted.StatusCode);

        var listed = await client.GetFromJsonAsync<Envelope<List<CommentDto>>>(
            $"/tickets/{ticket.Id}/comments", Json);

        Assert.NotNull(listed);
        var single = Assert.Single(listed!.Data);
        Assert.Equal("Rosa Little", single.Author);
    }

    [Fact]
    public async Task a_comment_rejects_an_empty_body_and_writes_nothing()
    {
        var client = await FreshClientAsync();
        var created = await client.PostAsJsonAsync("/tickets", new
        {
            title = "Cannot add a second till",
            body = "b",
            customerName = "Perch Bakery",
        });
        var ticket = (await created.Content.ReadFromJsonAsync<Envelope<TicketDto>>(Json))!.Data;

        var posted = await client.PostAsJsonAsync($"/tickets/{ticket.Id}/comments", new
        {
            author = "Rosa Little",
            body = "   ",
        });

        Assert.Equal(HttpStatusCode.BadRequest, posted.StatusCode);

        await using var db = fixture.NewContext();
        Assert.Equal(0, await db.Comments.CountAsync());
    }

    [Fact]
    public async Task a_dispatcher_only_sees_their_own_tickets()
    {
        await fixture.ResetAsync();
        await using (var db = fixture.NewContext())
        {
            db.Tickets.AddRange(
                new Ticket { Title = "rosa ticket", CustomerName = "c", OwnerId = Dispatchers.Rosa, CreatedAt = DateTimeOffset.UtcNow },
                new Ticket { Title = "ade ticket", CustomerName = "c", OwnerId = Dispatchers.Ade, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        var rosa = fixture.ClientFor(Dispatchers.Rosa);
        var payload = await rosa.GetFromJsonAsync<Envelope<List<TicketDto>>>("/tickets", Json);

        Assert.NotNull(payload);
        var only = Assert.Single(payload!.Data);
        Assert.Equal("rosa ticket", only.Title);
    }
}
