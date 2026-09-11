using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

/// <summary>
/// MISSION FILE — this code runs, returns plausible JSON, and is wrong.
///
/// It was written by someone who reached for the shape that "worked" in the
/// debugger. Three things are wrong with it, and the mission tests describe
/// them. Read the SQL the tests capture before you start changing lines.
/// </summary>
public static class TicketEndpoints
{
    public static void MapTicketEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/tickets");
        group.MapGet("/", ListTickets);
        group.MapGet("/{id:guid}", GetTicket);
        group.MapGet("/{id:guid}/comments", ListComments);
        group.MapPatch("/{id:guid}", RenameTicket);
    }

    private static IResult NotFound() =>
        Results.Json(
            new ErrorEnvelope(new ErrorBody("NOT_FOUND", "Not found.")),
            statusCode: StatusCodes.Status404NotFound);

    private static TicketDto ToDto(Ticket t) =>
        new(t.Id, t.Title, t.Body, t.Status, t.CustomerName, t.CreatedAt);

    public static async Task<IResult> ListTickets(SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        // Loads whole tracked entities, then counts comments per ticket by
        // going back to the database once per row.
        var tickets = await db.Tickets
            .Where(t => t.OwnerId == owner)
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .ToListAsync();

        var rows = new List<TicketSummaryDto>();
        foreach (var ticket in tickets)
        {
            var commentCount = await db.Comments.CountAsync(c => c.TicketId == ticket.Id);
            rows.Add(new TicketSummaryDto(
                ticket.Id, ticket.Title, ticket.Status, ticket.CustomerName, commentCount));
        }

        return Results.Ok(new Envelope<List<TicketSummaryDto>>(rows));
    }

    public static async Task<IResult> GetTicket(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var ticket = await db.Tickets
            .Include(t => t.Comments)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (ticket is null) return NotFound();

        return Results.Ok(new Envelope<TicketDto>(ToDto(ticket)));
    }

    public static async Task<IResult> ListComments(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var ticket = await db.Tickets
            .Include(t => t.Comments)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (ticket is null) return NotFound();

        var rows = ticket.Comments
            .OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.TicketId, c.Author, c.Body, c.CreatedAt))
            .ToList();

        return Results.Ok(new Envelope<List<CommentDto>>(rows));
    }

    public static async Task<IResult> RenameTicket(
        Guid id,
        RenameTicketRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id);
        if (ticket is null) return NotFound();

        var title = request.Title?.Trim() ?? string.Empty;
        if (title.Length == 0)
        {
            return Results.Json(
                new ErrorEnvelope(new ErrorBody("BAD_REQUEST", "A title is required.")),
                statusCode: StatusCodes.Status400BadRequest);
        }

        ticket.Title = title;
        await db.SaveChangesAsync();

        return Results.Ok(new Envelope<TicketDto>(ToDto(ticket)));
    }
}
