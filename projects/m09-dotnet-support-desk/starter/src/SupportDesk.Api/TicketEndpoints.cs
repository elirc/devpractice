using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

/// <summary>
/// MISSION FILE — this is the file you implement.
///
/// Every endpoint below currently answers 501 Not Implemented. The mission
/// tests describe the behaviour the existing React frontend already expects,
/// because this is the same HTTP contract M02 served from Node.
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

    private static IResult NotImplemented(string what) =>
        Results.Json(
            new ErrorEnvelope(new ErrorBody("NOT_IMPLEMENTED", $"{what} is not implemented yet.")),
            statusCode: StatusCodes.Status501NotImplemented);

    public static async Task<IResult> CreateTicket(
        CreateTicketRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        await Task.CompletedTask;
        return NotImplemented("POST /tickets");
    }

    public static async Task<IResult> ListTickets(
        SupportDeskContext db,
        HttpContext http,
        string? cursor = null,
        int limit = 20)
    {
        await Task.CompletedTask;
        return NotImplemented("GET /tickets");
    }

    public static async Task<IResult> GetTicket(Guid id, SupportDeskContext db, HttpContext http)
    {
        await Task.CompletedTask;
        return NotImplemented("GET /tickets/{id}");
    }

    public static async Task<IResult> CreateComment(
        Guid id,
        CreateCommentRequest request,
        SupportDeskContext db,
        HttpContext http)
    {
        await Task.CompletedTask;
        return NotImplemented("POST /tickets/{id}/comments");
    }

    public static async Task<IResult> ListComments(Guid id, SupportDeskContext db, HttpContext http)
    {
        await Task.CompletedTask;
        return NotImplemented("GET /tickets/{id}/comments");
    }
}
