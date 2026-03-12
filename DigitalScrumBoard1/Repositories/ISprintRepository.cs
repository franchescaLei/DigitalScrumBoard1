using DigitalScrumBoard1.Models;

namespace DigitalScrumBoard1.Repositories;

public interface ISprintRepository
{
    Task<bool> UserExistsAsync(int userId, CancellationToken ct);
    Task<bool> TeamExistsAsync(int teamId, CancellationToken ct);

    Task<Sprint?> GetByIdAsync(int sprintId, CancellationToken ct);

    Task AddAsync(Sprint sprint, CancellationToken ct);
    Task SaveChangesAsync(CancellationToken ct);

    Task<int> DeleteSprintAndUnassignWorkItemsAsync(int sprintId, CancellationToken ct);

    Task StartSprintAsync(int sprintId, CancellationToken ct);
}