using Microsoft.EntityFrameworkCore;

namespace Inventory.Api;

public class InventoryContext(DbContextOptions<InventoryContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<StockMovement> Movements => Set<StockMovement>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>(e =>
        {
            e.HasKey(p => p.Id);
            e.HasIndex(p => p.Sku).IsUnique();
            e.Property(p => p.Sku).HasMaxLength(40).IsRequired();
            e.Property(p => p.Name).HasMaxLength(200).IsRequired();

            // The database enforces the invariant too: application checks and
            // constraints are not redundant, they fail at different moments.
            e.ToTable(t => t.HasCheckConstraint("ck_products_qty_non_negative", "\"QuantityOnHand\" >= 0"));

            // Map PostgreSQL's xmin as the concurrency token.
            e.Property(p => p.Version).HasColumnName("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
        });

        b.Entity<StockMovement>(e =>
        {
            e.HasKey(m => m.Id);
            e.HasOne(m => m.Product).WithMany().HasForeignKey(m => m.ProductId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Order>(e =>
        {
            e.HasKey(o => o.Id);
            e.HasIndex(o => o.Reference).IsUnique();
            e.Property(o => o.Reference).HasMaxLength(60).IsRequired();
        });

        b.Entity<OrderLine>(e =>
        {
            e.HasKey(l => l.Id);
            e.HasOne(l => l.Order).WithMany(o => o.Lines).HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(l => l.Product).WithMany().HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => t.HasCheckConstraint("ck_order_lines_qty_positive", "\"Quantity\" > 0"));
        });
    }
}
