using Microsoft.EntityFrameworkCore;

namespace Inventory.Api;

/// <summary>REFERENCE SOLUTION for M11.</summary>
public class OrderService(InventoryContext db)
{
    private const int MaxAttempts = 5;

    public async Task<Order> PlaceOrderAsync(PlaceOrderRequest request, CancellationToken ct = default)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await PlaceOnceAsync(request, ct);
            }
            catch (DbUpdateConcurrencyException) when (attempt < MaxAttempts)
            {
                // Someone else changed a product between our read and our
                // write. Our decision was based on a value that is no longer
                // true, so discard it and decide again on fresh data.
                foreach (var entry in db.ChangeTracker.Entries().ToList())
                {
                    await entry.ReloadAsync(ct);
                    entry.State = EntityState.Detached;
                }
                db.ChangeTracker.Clear();
            }
        }
    }

    private async Task<Order> PlaceOnceAsync(PlaceOrderRequest request, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var order = new Order { Reference = request.Reference };
        db.Orders.Add(order);

        foreach (var line in request.Lines)
        {
            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == line.ProductId, ct)
                ?? throw new InvalidOperationException($"Unknown product {line.ProductId}");

            if (product.QuantityOnHand < line.Quantity)
            {
                throw new InsufficientStockException(product.Sku, line.Quantity, product.QuantityOnHand);
            }

            product.QuantityOnHand -= line.Quantity;

            db.OrderLines.Add(new OrderLine
            {
                OrderId = order.Id,
                ProductId = product.Id,
                Quantity = line.Quantity,
            });

            db.Movements.Add(new StockMovement
            {
                ProductId = product.Id,
                Delta = -line.Quantity,
                Reason = $"order {order.Reference}",
            });
        }

        // One save, one commit: the order exists in full or not at all.
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return order;
    }
}
