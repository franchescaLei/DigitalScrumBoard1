using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.DTOs.WorkItems;
using DigitalScrumBoard1.Models;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Repositories;

public sealed class WorkItemRepository : IWorkItemRepository
{
    private readonly DigitalScrumBoardContext _db;

    public WorkItemRepository(DigitalScrumBoardContext db)
    {
        _db = db;
    }

    public async Task<int?> GetWorkItemTypeIdByNameAsync(string typeName, CancellationToken ct)
    {
        return await _db.WorkItemTypes
            .AsNoTracking()
            .Where(t => t.TypeName == typeName)
            .Select(t => (int?)t.WorkItemTypeID)
            .FirstOrDefaultAsync(ct);
    }

    public async Task<(int WorkItemID, int WorkItemTypeID, bool IsDeleted)?> GetWorkItemTypeInfoByIdAsync(
        int id,
        CancellationToken ct)
    {
        var row = await _db.WorkItems
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(w => w.WorkItemID == id)
            .Select(w => new { w.WorkItemID, w.WorkItemTypeID, w.IsDeleted })
            .FirstOrDefaultAsync(ct);

        if (row is null) return null;

        return (row.WorkItemID, row.WorkItemTypeID, row.IsDeleted);
    }

    public async Task<WorkItem?> GetByIdAsync(int id, CancellationToken ct)
    {
        return await _db.WorkItems
            .AsNoTracking()
            .FirstOrDefaultAsync(w => w.WorkItemID == id, ct);
    }

    public async Task<WorkItem?> GetTrackedByIdAsync(int id, CancellationToken ct)
    {
        return await _db.WorkItems
            .FirstOrDefaultAsync(w => w.WorkItemID == id, ct);
    }

    public async Task AddAsync(WorkItem item, CancellationToken ct)
    {
        await _db.WorkItems.AddAsync(item, ct);
    }

    public Task SaveChangesAsync(CancellationToken ct) => _db.SaveChangesAsync(ct);

    public async Task AddWithAuditAsync(WorkItem item, AuditLog audit, CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            await _db.WorkItems.AddAsync(item, ct);
            await _db.SaveChangesAsync(ct);

            audit.TargetID = item.WorkItemID;

            await _db.AuditLogs.AddAsync(audit, ct);
            await _db.SaveChangesAsync(ct);

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    public async Task<List<(int WorkItemID, string Title, string TypeName)>> ListParentsAsync(int[] allowedTypeIds, CancellationToken ct)
    {
        var rows = await (
            from w in _db.WorkItems.AsNoTracking()
            join t in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals t.WorkItemTypeID
            where !w.IsDeleted && allowedTypeIds.Contains(w.WorkItemTypeID)
            orderby w.WorkItemID descending
            select new { w.WorkItemID, w.Title, t.TypeName })
            .Take(200)
            .ToListAsync(ct);

        return rows.Select(r => (r.WorkItemID, r.Title ?? "", r.TypeName)).ToList();
    }

    public async Task<List<EpicTileDto>> GetEpicTilesAsync(CancellationToken ct)
    {
        var epicTypeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == "Epic")
            .Select(t => t.WorkItemTypeID)
            .FirstAsync(ct);

        var storyTypeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == "Story")
            .Select(t => t.WorkItemTypeID)
            .FirstAsync(ct);

        var taskTypeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == "Task")
            .Select(t => t.WorkItemTypeID)
            .FirstAsync(ct);

        var epics = await _db.WorkItems
            .AsNoTracking()
            .Where(w => !w.IsDeleted && w.WorkItemTypeID == epicTypeId)
            .OrderByDescending(w => w.WorkItemID)
            .Select(w => new { w.WorkItemID, w.Title })
            .ToListAsync(ct);

        var epicIds = epics.Select(e => e.WorkItemID).ToList();

        var stories = await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                !w.IsDeleted &&
                w.WorkItemTypeID == storyTypeId &&
                w.ParentWorkItemID.HasValue &&
                epicIds.Contains(w.ParentWorkItemID.Value))
            .Select(w => new
            {
                w.WorkItemID,
                EpicID = w.ParentWorkItemID!.Value,
                IsCompleted = w.Status == "Completed"
            })
            .ToListAsync(ct);

        var storyIds = stories.Select(s => s.WorkItemID).ToList();
        var storyToEpic = stories.ToDictionary(s => s.WorkItemID, s => s.EpicID);

        var directEpicTasks = await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                !w.IsDeleted &&
                w.WorkItemTypeID == taskTypeId &&
                w.ParentWorkItemID.HasValue &&
                epicIds.Contains(w.ParentWorkItemID.Value))
            .Select(w => new
            {
                EpicID = w.ParentWorkItemID!.Value,
                IsCompleted = w.Status == "Completed"
            })
            .ToListAsync(ct);

        var storyTasks = await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                !w.IsDeleted &&
                w.WorkItemTypeID == taskTypeId &&
                w.ParentWorkItemID.HasValue &&
                storyIds.Contains(w.ParentWorkItemID.Value))
            .Select(w => new
            {
                StoryID = w.ParentWorkItemID!.Value,
                IsCompleted = w.Status == "Completed"
            })
            .ToListAsync(ct);

        var storyCountsByEpic = stories
            .GroupBy(x => x.EpicID)
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    Total = g.Count(),
                    Completed = g.Count(x => x.IsCompleted)
                });

        var allTaskRows = new List<(int EpicID, bool IsCompleted)>();

        allTaskRows.AddRange(directEpicTasks.Select(x => (x.EpicID, x.IsCompleted)));

        foreach (var row in storyTasks)
        {
            if (storyToEpic.TryGetValue(row.StoryID, out var epicId))
                allTaskRows.Add((epicId, row.IsCompleted));
        }

        var taskCountsByEpic = allTaskRows
            .GroupBy(x => x.EpicID)
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    Total = g.Count(),
                    Completed = g.Count(x => x.IsCompleted)
                });

        return epics.Select(e =>
        {
            storyCountsByEpic.TryGetValue(e.WorkItemID, out var storyCounts);
            taskCountsByEpic.TryGetValue(e.WorkItemID, out var taskCounts);

            return new EpicTileDto
            {
                EpicID = e.WorkItemID,
                EpicTitle = e.Title ?? "",
                TotalStories = storyCounts?.Total ?? 0,
                CompletedStories = storyCounts?.Completed ?? 0,
                TotalTasks = taskCounts?.Total ?? 0,
                CompletedTasks = taskCounts?.Completed ?? 0
            };
        }).ToList();
    }

    public async Task<WorkItemDetailsResponseDto?> GetWorkItemDetailsAsync(int workItemId, CancellationToken ct)
    {
        var dto = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals wt.WorkItemTypeID
            join p in _db.WorkItems.AsNoTracking() on w.ParentWorkItemID equals p.WorkItemID into pj
            from p in pj.DefaultIfEmpty()
            join t in _db.Teams.AsNoTracking() on w.TeamID equals t.TeamID into tj
            from t in tj.DefaultIfEmpty()
            join u in _db.Users.AsNoTracking() on w.AssignedUserID equals u.UserID into uj
            from u in uj.DefaultIfEmpty()
            where !w.IsDeleted && w.WorkItemID == workItemId
            select new WorkItemDetailsResponseDto
            {
                WorkItemID = w.WorkItemID,
                TypeName = wt.TypeName,
                Title = w.Title ?? "",
                Description = w.Description,
                Status = w.Status ?? "",
                Priority = w.Priority,
                DueDate = w.DueDate,
                ParentWorkItemID = w.ParentWorkItemID,
                ParentTitle = p != null ? p.Title : null,
                TeamID = w.TeamID,
                TeamName = t != null ? t.TeamName : null,
                AssignedUserID = w.AssignedUserID,
                AssignedUserName = u != null ? (u.FirstName + " " + u.LastName).Trim() : null
            })
            .FirstOrDefaultAsync(ct);

        if (dto is null)
            return null;

        if (string.Equals(dto.TypeName, "Epic", StringComparison.OrdinalIgnoreCase))
        {
            var storyTypeId = await _db.WorkItemTypes
                .Where(t => t.TypeName == "Story")
                .Select(t => t.WorkItemTypeID)
                .FirstAsync(ct);

            var taskTypeId = await _db.WorkItemTypes
                .Where(t => t.TypeName == "Task")
                .Select(t => t.WorkItemTypeID)
                .FirstAsync(ct);

            dto.Stories = await (
                from s in _db.WorkItems.AsNoTracking()
                join st in _db.WorkItemTypes.AsNoTracking() on s.WorkItemTypeID equals st.WorkItemTypeID
                where !s.IsDeleted
                      && s.WorkItemTypeID == storyTypeId
                      && s.ParentWorkItemID == workItemId
                orderby s.WorkItemID
                select new WorkItemChildDto
                {
                    WorkItemID = s.WorkItemID,
                    TypeName = st.TypeName,
                    Title = s.Title ?? "",
                    Status = s.Status ?? "",
                    Priority = s.Priority
                }).ToListAsync(ct);

            dto.Tasks = await (
                from t in _db.WorkItems.AsNoTracking()
                join tt in _db.WorkItemTypes.AsNoTracking() on t.WorkItemTypeID equals tt.WorkItemTypeID
                where !t.IsDeleted
                      && t.WorkItemTypeID == taskTypeId
                      && t.ParentWorkItemID == workItemId
                orderby t.WorkItemID
                select new WorkItemChildDto
                {
                    WorkItemID = t.WorkItemID,
                    TypeName = tt.TypeName,
                    Title = t.Title ?? "",
                    Status = t.Status ?? "",
                    Priority = t.Priority
                }).ToListAsync(ct);
        }
        else if (string.Equals(dto.TypeName, "Story", StringComparison.OrdinalIgnoreCase))
        {
            var taskTypeId = await _db.WorkItemTypes
                .Where(t => t.TypeName == "Task")
                .Select(t => t.WorkItemTypeID)
                .FirstAsync(ct);

            dto.Tasks = await (
                from t in _db.WorkItems.AsNoTracking()
                join tt in _db.WorkItemTypes.AsNoTracking() on t.WorkItemTypeID equals tt.WorkItemTypeID
                where !t.IsDeleted
                      && t.WorkItemTypeID == taskTypeId
                      && t.ParentWorkItemID == workItemId
                orderby t.WorkItemID
                select new WorkItemChildDto
                {
                    WorkItemID = t.WorkItemID,
                    TypeName = tt.TypeName,
                    Title = t.Title ?? "",
                    Status = t.Status ?? "",
                    Priority = t.Priority
                }).ToListAsync(ct);
        }

        return dto;
    }

    public async Task<AgendasResponseDto> GetAgendasAsync(CancellationToken ct)
    {
        var storyTypeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == "Story")
            .Select(t => t.WorkItemTypeID)
            .FirstAsync(ct);

        var taskTypeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == "Task")
            .Select(t => t.WorkItemTypeID)
            .FirstAsync(ct);

        var allowedTypeIds = new[] { storyTypeId, taskTypeId };

        var sprintRows = await _db.Sprints
            .AsNoTracking()
            .OrderByDescending(s => s.SprintID)
            .Select(s => new AgendaSprintDto
            {
                SprintID = s.SprintID,
                SprintName = s.SprintName,
                Status = s.Status,
                StartDate = s.StartDate,
                EndDate = s.EndDate,
                WorkItems = new List<AgendaWorkItemDto>()
            })
            .ToListAsync(ct);

        var sprintIds = sprintRows.Select(s => s.SprintID).ToList();

        var sprintWorkItems = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking()
                on w.WorkItemTypeID equals wt.WorkItemTypeID
            where !w.IsDeleted
                  && w.SprintID.HasValue
                  && sprintIds.Contains(w.SprintID.Value)
                  && allowedTypeIds.Contains(w.WorkItemTypeID)
            orderby w.WorkItemID descending
            select new AgendaWorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                TypeName = wt.TypeName,
                Status = w.Status ?? "",
                Priority = w.Priority,
                ParentWorkItemID = w.ParentWorkItemID,
                SprintID = w.SprintID
            })
            .ToListAsync(ct);

        var sprintWorkItemsBySprint = sprintWorkItems
            .GroupBy(w => w.SprintID!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var sprint in sprintRows)
        {
            if (sprintWorkItemsBySprint.TryGetValue(sprint.SprintID, out var items))
                sprint.WorkItems = items;
        }

        var backlogWorkItems = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking()
                on w.WorkItemTypeID equals wt.WorkItemTypeID
            where !w.IsDeleted
                  && !w.SprintID.HasValue
                  && allowedTypeIds.Contains(w.WorkItemTypeID)
                  && w.Status != "Completed"
            orderby w.WorkItemID descending
            select new AgendaWorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                TypeName = wt.TypeName,
                Status = w.Status ?? "",
                Priority = w.Priority,
                ParentWorkItemID = w.ParentWorkItemID,
                SprintID = w.SprintID
            })
            .ToListAsync(ct);

        return new AgendasResponseDto
        {
            Sprints = sprintRows,
            WorkItems = backlogWorkItems
        };
    }

    public async Task<Sprint?> GetSprintByIdAsync(int sprintId, CancellationToken ct)
    {
        return await _db.Sprints
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.SprintID == sprintId, ct);
    }

    public async Task<int?> GetSprintManagerUserIdAsync(int sprintId, CancellationToken ct)
    {
        return await _db.Sprints
            .AsNoTracking()
            .Where(s => s.SprintID == sprintId)
            .Select(s => s.ManagedBy)
            .FirstOrDefaultAsync(ct);
    }

    public Task AssignToSprintAsync(WorkItem workItem, int sprintId, CancellationToken ct)
    {
        workItem.SprintID = sprintId;
        workItem.UpdatedAt = DateTime.UtcNow;

        _db.WorkItems.Update(workItem);
        return _db.SaveChangesAsync(ct);
    }

    public Task RemoveFromSprintAsync(WorkItem workItem, CancellationToken ct)
    {
        workItem.SprintID = null;
        workItem.UpdatedAt = DateTime.UtcNow;

        _db.WorkItems.Update(workItem);
        return _db.SaveChangesAsync(ct);
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

    public Task<bool> HasActiveChildrenAsync(int workItemId, CancellationToken ct)
    {
        return _db.WorkItems
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(w => w.ParentWorkItemID == workItemId && !w.IsDeleted, ct);
    }

    public async Task AddHistoryAsync(WorkItemHistory history, CancellationToken ct)
    {
        await _db.WorkItemHistories.AddAsync(history, ct);
    }

    public async Task AddNotificationsAsync(IEnumerable<Notification> notifications, CancellationToken ct)
    {
        var items = notifications.ToList();
        if (items.Count == 0)
            return;

        await _db.Notifications.AddRangeAsync(items, ct);
    }
}