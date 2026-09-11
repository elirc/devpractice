using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

/// <summary>
/// Repeatable seed: running it twice must not duplicate rows. Every record is
/// fictional.
/// </summary>
public static class Seed
{
    public static async Task<(int Tickets, int Comments)> RunAsync(SupportDeskContext db)
    {
        var rows = new (Guid Id, string Title, string Customer, string Status, Guid Owner)[]
        {
            (Guid.Parse("aaaa1111-0000-0000-0000-000000000001"), "Card reader rejects every tap", "Perch Bakery", "open", Dispatchers.Rosa),
            (Guid.Parse("aaaa1111-0000-0000-0000-000000000002"), "Weekly export arrives empty", "Halloway Books", "open", Dispatchers.Rosa),
            (Guid.Parse("aaaa1111-0000-0000-0000-000000000003"), "Cannot add a second till", "Perch Bakery", "pending", Dispatchers.Rosa),
            (Guid.Parse("aaaa1111-0000-0000-0000-000000000004"), "Refund shows twice on the receipt", "Ferry Lane Cafe", "closed", Dispatchers.Ade),
            (Guid.Parse("aaaa1111-0000-0000-0000-000000000005"), "Printer pairs then drops", "Ferry Lane Cafe", "open", Dispatchers.Ade),
        };

        var baseTime = new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero);
        var i = 0;
        foreach (var row in rows)
        {
            var exists = await db.Tickets.AnyAsync(t => t.Id == row.Id);
            if (!exists)
            {
                db.Tickets.Add(new Ticket
                {
                    Id = row.Id,
                    Title = row.Title,
                    Body = "Reported by phone. Details captured by the dispatcher.",
                    Status = row.Status,
                    CustomerName = row.Customer,
                    OwnerId = row.Owner,
                    CreatedAt = baseTime.AddMinutes(i * 15),
                });
            }
            i++;
        }

        var comments = new (Guid Id, Guid Ticket, string Author)[]
        {
            (Guid.Parse("bbbb2222-0000-0000-0000-000000000001"), rows[0].Id, "Rosa Little"),
            (Guid.Parse("bbbb2222-0000-0000-0000-000000000002"), rows[0].Id, "Perch Bakery"),
            (Guid.Parse("bbbb2222-0000-0000-0000-000000000003"), rows[3].Id, "Ade Nwosu"),
        };

        var j = 0;
        foreach (var c in comments)
        {
            if (!await db.Comments.AnyAsync(x => x.Id == c.Id))
            {
                db.Comments.Add(new Comment
                {
                    Id = c.Id,
                    TicketId = c.Ticket,
                    Author = c.Author,
                    Body = "Followed up and confirmed the symptom.",
                    CreatedAt = baseTime.AddMinutes(j * 5),
                });
            }
            j++;
        }

        await db.SaveChangesAsync();
        return (await db.Tickets.CountAsync(), await db.Comments.CountAsync());
    }
}
