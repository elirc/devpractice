namespace SupportDesk.Api;

/// <summary>
/// TRAINING SCAFFOLDING, not authentication.
///
/// A real deployment would resolve the dispatcher from a session. This mission
/// is about the HTTP contract and EF Core, so identity arrives in a header and
/// falls back to a fixed fictional dispatcher. Do not copy this into anything
/// that matters — spec 13.3 calls identity fixtures explicit scaffolding.
/// </summary>
public static class CurrentDispatcher
{
    public const string HeaderName = "X-Dispatcher-Id";

    public static Guid Resolve(HttpContext http)
    {
        if (http.Request.Headers.TryGetValue(HeaderName, out var raw)
            && Guid.TryParse(raw.ToString(), out var parsed))
        {
            return parsed;
        }

        return Dispatchers.Rosa;
    }
}
