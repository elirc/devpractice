using Inventory.Api;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Inventory.Tests;

/// <summary>
/// MISSION — transaction and concurrency behaviour. These FAIL on the starter.
/// </summary>
[Collection("inventory")]
[Trait("Category", "Mission")]
public class MissionTests(InventoryFixture fixture)
{
    [Fact]
    public async Task a_failed_line_leaves_no_partial_order()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        var service = new OrderService(db);

        // Cups are plentiful; lids run out. The first line succeeds and the
        // second cannot, so the whole order must be abandoned.
        await Assert.ThrowsAsync<InsufficientStockException>(() =>
            service.PlaceOrderAsync(new PlaceOrderRequest("ORD-PARTIAL", new()
            {
                new OrderLineRequest(Seed.Cups, 5),
                new OrderLineRequest(Seed.Lids, 99),
            })));

        await using var check = fixture.NewContext();

        Assert.False(await check.Orders.AnyAsync(o => o.Reference == "ORD-PARTIAL"),
            "the order row survived a failed line");
        Assert.Equal(0, await check.OrderLines.CountAsync());
        Assert.Equal(0, await check.Movements.CountAsync());

        var cups = await check.Products.AsNoTracking().FirstAsync(p => p.Id == Seed.Cups);
        Assert.Equal(500, cups.QuantityOnHand);
    }

    [Fact]
    public async Task two_concurrent_orders_cannot_oversell_the_same_product()
    {
        await fixture.ResetAsync();

        // 12 lids on hand. Two orders of 8 cannot both succeed.
        async Task<bool> TryOrder(string reference)
        {
            await using var db = fixture.NewContext();
            var service = new OrderService(db);
            try
            {
                await service.PlaceOrderAsync(new PlaceOrderRequest(reference, new()
                {
                    new OrderLineRequest(Seed.Lids, 8),
                }));
                return true;
            }
            catch (Exception e) when (
                e is InsufficientStockException
                or DbUpdateConcurrencyException
                or DbUpdateException)
            {
                return false;
            }
        }

        var results = await Task.WhenAll(TryOrder("ORD-A"), TryOrder("ORD-B"));

        Assert.Equal(1, results.Count(r => r));

        await using var check = fixture.NewContext();
        var lids = await check.Products.AsNoTracking().FirstAsync(p => p.Id == Seed.Lids);
        Assert.Equal(4, lids.QuantityOnHand);
        Assert.Equal(1, await check.Orders.CountAsync());
    }

    [Fact]
    public async Task a_successful_order_still_records_lines_and_movements()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        var service = new OrderService(db);

        await service.PlaceOrderAsync(new PlaceOrderRequest("ORD-OK", new()
        {
            new OrderLineRequest(Seed.Beans, 3),
            new OrderLineRequest(Seed.Cups, 10),
        }));

        await using var check = fixture.NewContext();
        Assert.Equal(2, await check.OrderLines.CountAsync());
        Assert.Equal(2, await check.Movements.CountAsync());
        Assert.Equal(37, (await check.Products.AsNoTracking().FirstAsync(p => p.Id == Seed.Beans)).QuantityOnHand);
    }
}
