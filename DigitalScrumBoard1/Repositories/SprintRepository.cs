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
}