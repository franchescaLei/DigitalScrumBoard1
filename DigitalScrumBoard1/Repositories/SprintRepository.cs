using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Models;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Repositories;

public sealed class SprintRepository : ISprintRepository
{
    private readonly DigitalScrumBoardContext _db;

    public SprintRepository(DigitalScrumBoardContext db)
    {
        _db = db;
    }

    public Task<bool> UserExistsAsync(int userId, CancellationToken ct)
    {
        return _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.UserID == userId && !u.Disabled, ct);
    }

    public Task<bool> TeamExistsAsync(int teamId, CancellationToken ct)
    {
        return _db.Teams
            .AsNoTracking()
            .AnyAsync(t => t.TeamID == teamId, ct);
    }

    public async Task<Sprint?> GetByIdAsync(int sprintId, CancellationToken ct)
    {
        return await _db.Sprints
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.SprintID == sprintId, ct);
    }

    public async Task<Sprint?> GetTrackedByIdAsync(int sprintId, CancellationToken ct)
    {
        return await _db.Sprints
            .FirstOrDefaultAsync(s => s.SprintID == sprintId, ct);
    }

    public async Task<List<WorkItem>> GetTrackedSprintWorkItemsAsync(int sprintId, CancellationToken ct)
    {
        return await _db.WorkItems
            .Where(w => w.SprintID == sprintId && !w.IsDeleted)
            .ToListAsync(ct);
    }

    public async Task AddAsync(Sprint sprint, CancellationToken ct)
    {
        await _db.Sprints.AddAsync(sprint, ct);
    }

    public Task SaveChangesAsync(CancellationToken ct)
    {
        return _db.SaveChangesAsync(ct);
    }

    public async Task<int> DeleteSprintAndUnassignWorkItemsAsync(int sprintId, CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var sprint = await _db.Sprints
                .FirstOrDefaultAsync(s => s.SprintID == sprintId, ct);

            if (sprint is null)
                return -1;

            var now = DateTime.UtcNow;

            var linkedWorkItems = await _db.WorkItems
                .IgnoreQueryFilters()
                .Where(w => w.SprintID == sprintId)
                .ToListAsync(ct);

            var returnedToBacklogCount = linkedWorkItems.Count(w => !w.IsDeleted && w.Status != "Completed");

            foreach (var workItem in linkedWorkItems)
            {
                workItem.SprintID = null;
                workItem.UpdatedAt = now;
            }

            _db.Sprints.Remove(sprint);

            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            return returnedToBacklogCount;
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    public async Task StartSprintAsync(int sprintId, CancellationToken ct)
    {
        var sprint = await _db.Sprints.FirstOrDefaultAsync(s => s.SprintID == sprintId, ct);
        if (sprint is null)
            return;

        sprint.Status = "Active";
        sprint.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
    }

    public async Task StopSprintAsync(Sprint sprint, CancellationToken ct)
    {
        sprint.Status = "Planned";
        sprint.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
    }

    public async Task CompleteSprintAsync(Sprint sprint, List<WorkItem> sprintWorkItems, CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var now = DateTime.UtcNow;

            foreach (var workItem in sprintWorkItems)
            {
                workItem.SprintID = null;
                workItem.UpdatedAt = now;
            }

            _db.Sprints.Remove(sprint);

            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    public async Task<List<WorkItem>> GetSprintWorkItemsMissingAssigneeAsync(int sprintId, CancellationToken ct)
    {
        return await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                w.SprintID == sprintId &&
                !w.IsDeleted &&
                !w.AssignedUserID.HasValue)
            .OrderBy(w => w.WorkItemID)
            .ToListAsync(ct);
    }

    public async Task<List<int>> GetSprintAssignedUserIdsAsync(int sprintId, CancellationToken ct)
    {
        return await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                w.SprintID == sprintId &&
                !w.IsDeleted &&
                w.AssignedUserID.HasValue)
            .Select(w => w.AssignedUserID!.Value)
            .Distinct()
            .ToListAsync(ct);
    }

    public async Task AddNotificationsAsync(IEnumerable<Notification> notifications, CancellationToken ct)
    {
        var items = notifications.ToList();
        if (items.Count == 0)
            return;

        await _db.Notifications.AddRangeAsync(items, ct);
        await _db.SaveChangesAsync(ct);
    }
}