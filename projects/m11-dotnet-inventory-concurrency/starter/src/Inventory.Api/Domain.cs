namespace Inventory.Api;

/// <summary>A stocked product. Every product here is fictional.</summary>
public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Sku { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int QuantityOnHand { get; set; }

    /// <summary>
    /// PostgreSQL's system column `xmin` changes on every UPDATE. EF Core maps
    /// it as a concurrency token, so a stale write is detected rather than
    /// silently overwriting a value someone else already changed.
    /// </summary>
    public uint Version { get; set; }
}

public class StockMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public int Delta { get; set; }
    public string Reason { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Reference { get; set; } = string.Empty;
    public string Status { get; set; } = "placed";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<OrderLine> Lines { get; set; } = new();
}

public class OrderLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public int Quantity { get; set; }
}
