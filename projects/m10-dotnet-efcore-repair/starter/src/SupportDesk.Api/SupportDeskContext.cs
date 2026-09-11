using Microsoft.EntityFrameworkCore;

namespace SupportDesk.Api;

public class SupportDeskContext(DbContextOptions<SupportDeskContext> options) : DbContext(options)
{
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<Comment> Comments => Set<Comment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Ticket>(e =>
        {
            e.HasKey(t => t.Id);
            e.Property(t => t.Title).HasMaxLength(200).IsRequired();
            e.Property(t => t.Status).HasMaxLength(20).IsRequired();
            e.Property(t => t.CustomerName).HasMaxLength(200).IsRequired();
            // Cursor pagination needs a TOTAL order, so the index carries the
            // tiebreaker column too (spec: ordering by a timestamp alone is not
            // enough when two rows share a timestamp).
            e.HasIndex(t => new { t.OwnerId, t.CreatedAt, t.Id });
        });

        b.Entity<Comment>(e =>
        {
            e.HasKey(c => c.Id);
            e.Property(c => c.Author).HasMaxLength(200).IsRequired();
            e.HasOne(c => c.Ticket)
                .WithMany(t => t.Comments)
                .HasForeignKey(c => c.TicketId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(c => new { c.TicketId, c.CreatedAt, c.Id });
        });
    }
}
