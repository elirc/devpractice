using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;

var builder = WebApplication.CreateBuilder(args);

var connection =
    Environment.GetEnvironmentVariable("SUPPORTDESK_CONNECTION")
    ?? "Host=127.0.0.1;Port=5440;Database=m10_efcore;Username=postgres";

builder.Services.AddSingleton<SqlLog>();
builder.Services.AddDbContext<SupportDeskContext>((sp, o) =>
    o.UseNpgsql(connection).AddInterceptors(new SqlLogInterceptor(sp.GetRequiredService<SqlLog>())));

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapTicketEndpoints();

app.Run();

public partial class Program;
