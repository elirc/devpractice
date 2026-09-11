using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;

var connection =
    Environment.GetEnvironmentVariable("SUPPORTDESK_CONNECTION")
    ?? "Host=127.0.0.1;Port=5440;Database=m09_supportdesk;Username=postgres";

var options = new DbContextOptionsBuilder<SupportDeskContext>().UseNpgsql(connection).Options;
await using var db = new SupportDeskContext(options);

await db.Database.EnsureCreatedAsync();
var (tickets, comments) = await Seed.RunAsync(db);
Console.WriteLine($"seeded: tickets={tickets} comments={comments}");
