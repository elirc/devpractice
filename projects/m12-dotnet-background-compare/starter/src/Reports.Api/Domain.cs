namespace Reports.Api;

public enum JobState { Queued, Running, Succeeded, Failed }

/// <summary>
/// A database-backed job record. This is deliberately NOT a queue broker: the
/// point of the mission is that durable state plus idempotent effects is what
/// makes a rerun safe, not the delivery machinery on top.
/// </summary>
public class ReportJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Reference { get; set; } = string.Empty;
    public JobState State { get; set; } = JobState.Queued;
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
}

/// <summary>One committed effect of a job. Reruns must not duplicate these.</summary>
public class ReportRow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobId { get; set; }
    public ReportJob? Job { get; set; }

    /// <summary>The source item this row was produced from.</summary>
    public string ItemKey { get; set; } = string.Empty;
    public int Amount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Fixed fictional source data, so a rerun has something stable to process.</summary>
public static class SourceItems
{
    public static readonly string[] Keys =
        ["perch-bakery", "halloway-books", "ferry-lane-cafe", "quay-street-deli", "eastgate-flowers"];

    public static int AmountFor(string key) => key.Length * 10;
}
