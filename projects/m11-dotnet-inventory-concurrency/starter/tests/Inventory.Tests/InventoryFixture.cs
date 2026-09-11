using Inventory.Api;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Inventory.Tests;

public class InventoryFixture : IAsyncLifetime
{
    public static string ConnectionString =>
        Environment.GetEnvironmentVariable("INVENTORY_TEST_CONNECTION")
        ?? "Host=127.0.0.1;Port=5440;Database=m11_inventory_test;Username=postgres";

    public InventoryContext NewContext()
    {
        var options = new DbContextOptionsBuilder<InventoryContext>()
            .UseNpgsql(ConnectionString)
            .Options;
        return new InventoryContext(options);
    }

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task ResetAsync()
    {
        await using var db = NewContext();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE \"OrderLines\", \"Orders\", \"Movements\", \"Products\" RESTART IDENTITY CASCADE;");
        await Seed.RunAsync(db);
    }

    public Task DisposeAsync() => Task.CompletedTask;
}

[CollectionDefinition("inventory")]
public class InventoryCollection : ICollectionFixture<InventoryFixture>;
