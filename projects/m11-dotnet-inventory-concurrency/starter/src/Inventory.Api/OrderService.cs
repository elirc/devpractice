using Microsoft.EntityFrameworkCore;

namespace Inventory.Api;

/// <summary>
/// MISSION FILE.
///
/// `PlaceOrderAsync` currently writes each line as it goes and saves as it
/// goes. It looks fine against a single request on an idle machine. The
/// mission tests put it under a conflicting concurrent edit and under a
/// mid-order failure, which is where it comes apart.
///
/// Two things are missing, and they are related:
///   1. the whole order must commit or not at all;
///   2. a stale read of QuantityOnHand must be DETECTED, not overwritten.
/// </summary>
public class OrderService(InventoryContext db)
{
    public async Task<Order> PlaceOrderAsync(PlaceOrderRequest request, CancellationToken ct = default)
    {
        var order = new Order { Reference = request.Reference };
        db.Orders.Add(order);
        await db.SaveChangesAsync(ct);

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

            // Saving inside the loop is what makes a later failure leave a
            // half-applied order behind.
            await db.SaveChangesAsync(ct);
        }

        return order;
    }
}
