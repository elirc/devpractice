using Inventory.Api;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connection =
    Environment.GetEnvironmentVariable("INVENTORY_CONNECTION")
    ?? "Host=127.0.0.1;Port=5440;Database=m11_inventory;Username=postgres";

builder.Services.AddDbContext<InventoryContext>(o => o.UseNpgsql(connection));
builder.Services.AddScoped<OrderService>();

var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.Run();

public partial class Program;
