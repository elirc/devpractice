using Inventory.Api;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Inventory.Tests;

/// <summary>BASELINE — the starter runs and places a simple order.</summary>
[Collection("inventory")]
[Trait("Category", "Baseline")]
public class BaselineTests(InventoryFixture fixture)
{
    [Fact]
    public async Task the_database_is_reachable_and_seeded()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        Assert.Equal(3, await db.Products.CountAsync());
    }

    [Fact]
    public async Task the_seed_is_repeatable()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        var first = await Seed.RunAsync(db);
        var second = await Seed.RunAsync(db);
        Assert.Equal(first, second);
        Assert.Equal(3, second);
    }

    [Fact]
    public async Task a_single_order_reduces_stock()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        var service = new OrderService(db);

        await service.PlaceOrderAsync(new PlaceOrderRequest("ORD-1", new()
        {
            new OrderLineRequest(Seed.Beans, 2),
        }));

        await using var check = fixture.NewContext();
        var beans = await check.Products.AsNoTracking().FirstAsync(p => p.Id == Seed.Beans);
        Assert.Equal(38, beans.QuantityOnHand);
    }

    [Fact]
    public async Task the_database_rejects_negative_stock()
    {
        await fixture.ResetAsync();
        await using var db = fixture.NewContext();
        var lids = await db.Products.FirstAsync(p => p.Id == Seed.Lids);
        lids.QuantityOnHand = -1;

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    // Demonstrates that the xmin concurrency token in the SCHEMA works. This
    // is baseline, not mission: it passes before you write anything, and it
    // is the mechanism your OrderService has to start HANDLING.
    [Fact]
    public async Task a_conflicting_concurrent_edit_is_detected_not_overwritten()
    {
        await fixture.ResetAsync();

        // Two contexts read the same product, so both hold the same version.
        await using var first = fixture.NewContext();
        await using var second = fixture.NewContext();

        var a = await first.Products.FirstAsync(p => p.Id == Seed.Beans);
        var b = await second.Products.FirstAsync(p => p.Id == Seed.Beans);

        a.QuantityOnHand -= 5;
        await first.SaveChangesAsync();

        b.QuantityOnHand -= 7;

        // The second write is based on a version that no longer exists.
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());

        await using var check = fixture.NewContext();
        var beans = await check.Products.AsNoTracking().FirstAsync(p => p.Id == Seed.Beans);

        // 35, not 33: the losing write must not have been applied.
        Assert.Equal(35, beans.QuantityOnHand);
    }
}
