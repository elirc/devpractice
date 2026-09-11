using Microsoft.EntityFrameworkCore;

namespace Reports.Api;

public class ReportsContext(DbContextOptions<ReportsContext> options) : DbContext(options)
{
    public DbSet<ReportJob> Jobs => Set<ReportJob>();
    public DbSet<ReportRow> Rows => Set<ReportRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ReportJob>(e =>
        {
            e.HasKey(j => j.Id);
            e.HasIndex(j => j.Reference).IsUnique();
            e.Property(j => j.Reference).HasMaxLength(60).IsRequired();
            e.Property(j => j.State).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<ReportRow>(e =>
        {
            e.HasKey(r => r.Id);
            e.HasOne(r => r.Job).WithMany().HasForeignKey(r => r.JobId).OnDelete(DeleteBehavior.Cascade);

            // The database is the backstop for idempotency: even a buggy runner
            // cannot write the same item twice for the same job.
            e.HasIndex(r => new { r.JobId, r.ItemKey }).IsUnique();
            e.Property(r => r.ItemKey).HasMaxLength(120).IsRequired();
        });
    }
}
