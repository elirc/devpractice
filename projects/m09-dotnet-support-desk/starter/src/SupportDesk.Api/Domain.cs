namespace SupportDesk.Api;

/// <summary>
/// A support ticket. Every customer and dispatcher in this repository is
/// fictional; there are no real records here.
/// </summary>
public class Ticket
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Status { get; set; } = "open";
    public string CustomerName { get; set; } = string.Empty;

    /// <summary>The dispatcher this ticket belongs to. Access is scoped by it.</summary>
    public Guid OwnerId { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<Comment> Comments { get; set; } = new();
}

public class Comment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TicketId { get; set; }
    public Ticket? Ticket { get; set; }
    public string Author { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Fixed fictional dispatcher ids, so tests and seed agree.</summary>
public static class Dispatchers
{
    public static readonly Guid Rosa = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid Ade = Guid.Parse("22222222-2222-2222-2222-222222222222");
}
