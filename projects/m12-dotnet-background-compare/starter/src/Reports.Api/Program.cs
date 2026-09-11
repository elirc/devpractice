using Microsoft.EntityFrameworkCore;
using Reports.Api;

var builder = WebApplication.CreateBuilder(args);

var connection =
    Environment.GetEnvironmentVariable("REPORTS_CONNECTION")
    ?? "Host=127.0.0.1;Port=5440;Database=m12_reports;Username=postgres";

builder.Services.AddDbContext<ReportsContext>(o => o.UseNpgsql(connection));
builder.Services.AddScoped<ReportRunner>();
builder.Services.AddHostedService<ReportBackgroundService>();

var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.Run();

public partial class Program;
