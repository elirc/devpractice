using System.Text;

namespace SupportDesk.Api;

/// <summary>
/// Opaque cursor over the total order (CreatedAt, Id).
/// Opaque to the caller, but not secret — it is base64 of the sort key.
/// </summary>
public static class Cursor
{
    public static string Encode(DateTimeOffset createdAt, Guid id) =>
        Convert.ToBase64String(
            Encoding.UTF8.GetBytes($"{createdAt.UtcDateTime:O}|{id}"));

    public static bool TryDecode(string? raw, out DateTimeOffset createdAt, out Guid id)
    {
        createdAt = default;
        id = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        try
        {
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(raw)).Split('|');
            if (parts.Length != 2) return false;
            createdAt = DateTimeOffset.Parse(parts[0]).ToUniversalTime();
            id = Guid.Parse(parts[1]);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
