namespace Inventory.Api;

public record OrderLineRequest(Guid ProductId, int Quantity);
public record PlaceOrderRequest(string Reference, List<OrderLineRequest> Lines);

public record OrderDto(Guid Id, string Reference, string Status, List<OrderLineDto> Lines);
public record OrderLineDto(Guid ProductId, int Quantity);
public record ProductDto(Guid Id, string Sku, string Name, int QuantityOnHand);

public record ErrorBody(string Code, string Message);
public record ErrorEnvelope(ErrorBody Error);
public record Envelope<T>(T Data);

/// <summary>Raised when the order cannot be satisfied from stock on hand.</summary>
public class InsufficientStockException(string sku, int requested, int available)
    : Exception($"Insufficient stock for {sku}: requested {requested}, available {available}")
{
    public string Sku { get; } = sku;
}
