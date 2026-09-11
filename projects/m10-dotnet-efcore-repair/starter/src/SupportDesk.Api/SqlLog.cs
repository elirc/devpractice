using System.Collections.Concurrent;
using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace SupportDesk.Api;

/// <summary>
/// Records the SQL EF Core actually sends.
///
/// This is how the mission tests can assert about QUERY BEHAVIOUR rather than
/// just about the JSON that comes back: an N+1 and a single joined query return
/// identical responses, so the response alone cannot tell you which you wrote.
/// </summary>
public sealed class SqlLog
{
    private readonly ConcurrentQueue<string> _commands = new();
    private bool _recording;

    public IReadOnlyList<string> Commands => _commands.ToArray();

    public int SelectCount => Commands.Count(c =>
        c.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase));

    public void Start()
    {
        _commands.Clear();
        _recording = true;
    }

    public void Stop() => _recording = false;

    public void Record(string sql)
    {
        if (_recording) _commands.Enqueue(sql);
    }
}

public sealed class SqlLogInterceptor(SqlLog log) : DbCommandInterceptor
{
    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result)
    {
        log.Record(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        log.Record(command.CommandText);
        return ValueTask.FromResult(result);
    }
}
