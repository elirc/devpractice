using Microsoft.EntityFrameworkCore;

namespace Reports.Api;

/// <summary>
/// Picks up queued jobs and runs them. The hosted service passes its stopping
/// token down, which is only useful if the runner actually observes it.
/// </summary>
public class ReportBackgroundService(IServiceProvider services, ILogger<ReportBackgroundService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ReportsContext>();
                var runner = scope.ServiceProvider.GetRequiredService<ReportRunner>();

                var next = await db.Jobs
                    .Where(j => j.State == JobState.Queued)
                    .OrderBy(j => j.CreatedAt)
                    .FirstOrDefaultAsync(stoppingToken);

                if (next is not null)
                {
                    await runner.RunAsync(next.Id, stoppingToken);
                }
                else
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "report job failed");
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }
}
