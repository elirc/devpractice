using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

/// <summary>REFERENCE SOLUTION for M10.</summary>
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

    public static async Task<IResult> ListTickets(SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        // One query. The comment count is part of the projection, so the
        // database counts and the server never round-trips per row.
        var rows = await db.Tickets
            .AsNoTracking()
            .Where(t => t.OwnerId == owner)
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Select(t => new TicketSummaryDto(
                t.Id, t.Title, t.Status, t.CustomerName, t.Comments.Count()))
            .ToListAsync();

        return Results.Ok(new Envelope<List<TicketSummaryDto>>(rows));
    }

    public static async Task<IResult> GetTicket(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        // Ownership is part of the QUERY: a foreign row is never materialised.
        // No Include: TicketDto carries no comments, so joining them is waste.
        var dto = await db.Tickets
            .AsNoTracking()
            .Where(t => t.Id == id && t.OwnerId == owner)
            .Select(t => new TicketDto(t.Id, t.Title, t.Body, t.Status, t.CustomerName, t.CreatedAt))
            .FirstOrDefaultAsync();

        return dto is null ? NotFound() : Results.Ok(new Envelope<TicketDto>(dto));
    }

    public static async Task<IResult> ListComments(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var owns = await db.Tickets.AnyAsync(t => t.Id == id && t.OwnerId == owner);
        if (!owns) return NotFound();

        var rows = await db.Comments
            .AsNoTracking()
            .Where(c => c.TicketId == id)
            .OrderBy(c => c.CreatedAt)
            .ThenBy(c => c.Id)
            .Select(c => new CommentDto(c.Id, c.TicketId, c.Author, c.Body, c.CreatedAt))
            .ToListAsync();

        return Results.Ok(new Envelope<List<CommentDto>>(rows));
    }

    public static async Task<IResult> RenameTicket(
        Guid id,
        RenameTicketRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        // Tracked on purpose: this path actually writes.
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id && t.OwnerId == owner);
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

        return Results.Ok(new Envelope<TicketDto>(
            new TicketDto(ticket.Id, ticket.Title, ticket.Body, ticket.Status, ticket.CustomerName, ticket.CreatedAt)));
    }
}
