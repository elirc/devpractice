namespace SupportDesk.Api;

public record TicketSummaryDto(
    Guid Id,
    string Title,
    string Status,
    string CustomerName,
    int CommentCount);

public record RenameTicketRequest(string? Title);
