using Microsoft.EntityFrameworkCore;

namespace Inventory.Api;

public static class Seed
{
    public static readonly Guid Beans = Guid.Parse("cccc0000-0000-0000-0000-000000000001");
    public static readonly Guid Cups = Guid.Parse("cccc0000-0000-0000-0000-000000000002");
    public static readonly Guid Lids = Guid.Parse("cccc0000-0000-0000-0000-000000000003");

    public static async Task<int> RunAsync(InventoryContext db)
    {
        var rows = new (Guid Id, string Sku, string Name, int Qty)[]
        {
            (Beans, "BEAN-1KG", "House blend beans 1kg", 40),
            (Cups, "CUP-12OZ", "Takeaway cup 12oz", 500),
            (Lids, "LID-12OZ", "Takeaway lid 12oz", 12),
        };

        foreach (var row in rows)
        {
            if (!await db.Products.AnyAsync(p => p.Id == row.Id))
            {
                db.Products.Add(new Product
                {
                    Id = row.Id,
                    Sku = row.Sku,
                    Name = row.Name,
                    QuantityOnHand = row.Qty,
                });
            }
        }

        await db.SaveChangesAsync();
        return await db.Products.CountAsync();
    }
}
