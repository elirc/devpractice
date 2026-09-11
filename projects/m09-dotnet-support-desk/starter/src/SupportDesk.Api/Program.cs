using Microsoft.EntityFrameworkCore;
using SupportDesk.Api;

var builder = WebApplication.CreateBuilder(args);

var connection =
    Environment.GetEnvironmentVariable("SUPPORTDESK_CONNECTION")
    ?? builder.Configuration.GetConnectionString("SupportDesk")
    ?? "Host=127.0.0.1;Port=5440;Database=m09_supportdesk;Username=postgres";

builder.Services.AddDbContext<SupportDeskContext>(o => o.UseNpgsql(connection));

// The M01 React app is served from its own dev origin, so it needs CORS to
// reach this API. Same contract as M02, different server.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:5173", "http://localhost:4173")
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapTicketEndpoints();

app.Run();

/// <summary>Exposed so the integration tests can build the same app.</summary>
public partial class Program;
