namespace SupportDesk.Api;

/// <summary>
/// The HTTP contract M02 established. The React frontend from M01 talks to
/// THIS shape, so it must not change just because the server is now .NET.
/// </summary>
public record CreateTicketRequest(string? Title, string? Body, string? CustomerName);

public record CreateCommentRequest(string? Author, string? Body);

public record TicketDto(
    Guid Id,
    string Title,
    string Body,
    string Status,
    string CustomerName,
    DateTimeOffset CreatedAt);

public record CommentDto(Guid Id, Guid TicketId, string Author, string Body, DateTimeOffset CreatedAt);

public record PageMeta(string? NextCursor, bool HasMore);

public record Envelope<T>(T Data, PageMeta? Meta = null);

public record ErrorBody(string Code, string Message, Dictionary<string, string[]>? FieldErrors = null);

public record ErrorEnvelope(ErrorBody Error);
