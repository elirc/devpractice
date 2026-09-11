using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

/// <summary>
/// REFERENCE SOLUTION.
///
/// The same HTTP contract M02 served from Node, now served by ASP.NET Core.
/// The React frontend does not know the difference, which is the whole point.
/// </summary>
public static class TicketEndpoints
{
    public const int MaxPageSize = 50;

    public static void MapTicketEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/tickets");

        group.MapPost("/", CreateTicket);
        group.MapGet("/", ListTickets);
        group.MapGet("/{id:guid}", GetTicket);
        group.MapPost("/{id:guid}/comments", CreateComment);
        group.MapGet("/{id:guid}/comments", ListComments);
    }

    private static IResult Invalid(string field, string message) =>
        Results.Json(
            new ErrorEnvelope(new ErrorBody(
                "BAD_REQUEST",
                "The request could not be accepted.",
                new Dictionary<string, string[]> { [field] = new[] { message } })),
            statusCode: StatusCodes.Status400BadRequest);

    private static IResult NotFound() =>
        Results.Json(
            new ErrorEnvelope(new ErrorBody("NOT_FOUND", "Not found.")),
            statusCode: StatusCodes.Status404NotFound);

    private static TicketDto ToDto(Ticket t) =>
        new(t.Id, t.Title, t.Body, t.Status, t.CustomerName, t.CreatedAt);

    public static async Task<IResult> CreateTicket(
        CreateTicketRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        // Runtime validation at the boundary: the C# type says `string?`, which
        // is a compile-time hint, not a guarantee about what arrived over HTTP.
        var title = request.Title?.Trim() ?? string.Empty;
        if (title.Length == 0)
        {
            return Invalid("title", "A title is required.");
        }
        if (title.Length > 200)
        {
            return Invalid("title", "A title may be at most 200 characters.");
        }

        var customer = request.CustomerName?.Trim() ?? string.Empty;
        if (customer.Length == 0)
        {
            return Invalid("customerName", "A customer name is required.");
        }

        var ticket = new Ticket
        {
            Title = title,
            Body = request.Body?.Trim() ?? string.Empty,
            CustomerName = customer,
            Status = "open",
            OwnerId = CurrentDispatcher.Resolve(http),
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Tickets.Add(ticket);
        await db.SaveChangesAsync();

        return Results.Created($"/tickets/{ticket.Id}", new Envelope<TicketDto>(ToDto(ticket)));
    }

    public static async Task<IResult> ListTickets(
        SupportDeskContext db,
        HttpContext http,
        string? cursor = null,
        int limit = 20)
    {
        var owner = CurrentDispatcher.Resolve(http);
        var size = Math.Clamp(limit, 1, MaxPageSize);

        // Ownership lives in the QUERY, not in a later filter: a row the
        // dispatcher may not see is never loaded in the first place.
        var query = db.Tickets.AsNoTracking().Where(t => t.OwnerId == owner);

        if (Cursor.TryDecode(cursor, out var afterTime, out var afterId))
        {
            // Keyset comparison over the SAME total order used to sort.
            query = query.Where(t =>
                t.CreatedAt > afterTime || (t.CreatedAt == afterTime && t.Id.CompareTo(afterId) > 0));
        }

        var rows = await query
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Take(size + 1) // one extra row answers "is there another page?"
            .ToListAsync();

        var hasMore = rows.Count > size;
        var page = rows.Take(size).ToList();

        string? nextCursor = hasMore && page.Count > 0
            ? Cursor.Encode(page[^1].CreatedAt, page[^1].Id)
            : null;

        return Results.Ok(new Envelope<List<TicketDto>>(
            page.Select(ToDto).ToList(),
            new PageMeta(nextCursor, hasMore)));
    }

    public static async Task<IResult> GetTicket(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var ticket = await db.Tickets
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id && t.OwnerId == owner);

        return ticket is null ? NotFound() : Results.Ok(new Envelope<TicketDto>(ToDto(ticket)));
    }

    public static async Task<IResult> CreateComment(
        Guid id,
        CreateCommentRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var exists = await db.Tickets.AnyAsync(t => t.Id == id && t.OwnerId == owner);
        if (!exists)
        {
            return NotFound();
        }

        var body = request.Body?.Trim() ?? string.Empty;
        if (body.Length == 0)
        {
            return Invalid("body", "A comment body is required.");
        }

        var author = request.Author?.Trim() ?? string.Empty;
        if (author.Length == 0)
        {
            return Invalid("author", "An author is required.");
        }

        var comment = new Comment
        {
            TicketId = id,
            Author = author,
            Body = body,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Comments.Add(comment);
        await db.SaveChangesAsync();

        return Results.Created(
            $"/tickets/{id}/comments/{comment.Id}",
            new Envelope<CommentDto>(
                new CommentDto(comment.Id, comment.TicketId, comment.Author, comment.Body, comment.CreatedAt)));
    }

    public static async Task<IResult> ListComments(Guid id, SupportDeskContext db, HttpContext http)
    {
        var owner = CurrentDispatcher.Resolve(http);

        var exists = await db.Tickets.AnyAsync(t => t.Id == id && t.OwnerId == owner);
        if (!exists)
        {
            return NotFound();
        }

        var rows = await db.Comments
            .AsNoTracking()
            .Where(c => c.TicketId == id)
            .OrderBy(c => c.CreatedAt)
            .ThenBy(c => c.Id)
            .ToListAsync();

        return Results.Ok(new Envelope<List<CommentDto>>(
            rows.Select(c => new CommentDto(c.Id, c.TicketId, c.Author, c.Body, c.CreatedAt)).ToList()));
    }
}
