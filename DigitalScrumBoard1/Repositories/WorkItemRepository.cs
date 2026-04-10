using DigitalScrumBoard1.Utilities;
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

    public async Task<(int WorkItemID, int WorkItemTypeID, bool IsDeleted, DateOnly? DueDate)?> GetWorkItemTypeInfoByIdAsync(
        int id,
        CancellationToken ct)
    {
        var row = await _db.WorkItems
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(w => w.WorkItemID == id)
            .Select(w => new { w.WorkItemID, w.WorkItemTypeID, w.IsDeleted, w.DueDate })
            .FirstOrDefaultAsync(ct);

        if (row is null) return null;

        return (row.WorkItemID, row.WorkItemTypeID, row.IsDeleted, row.DueDate);
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

    public async Task<List<(int WorkItemID, string Title, string TypeName, DateOnly? DueDate)>> ListParentsAsync(int[] allowedTypeIds, CancellationToken ct)
    {
        var rows = await (
            from w in _db.WorkItems.AsNoTracking()
            join t in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals t.WorkItemTypeID
            where !w.IsDeleted && allowedTypeIds.Contains(w.WorkItemTypeID)
            orderby w.WorkItemID descending
            select new { w.WorkItemID, w.Title, t.TypeName, w.DueDate })
            .Take(200)
            .ToListAsync(ct);

        return rows.Select(r => (r.WorkItemID, r.Title ?? "", r.TypeName, r.DueDate)).ToList();
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
            join sp in _db.Sprints.AsNoTracking() on w.SprintID equals sp.SprintID into spj
            from sp in spj.DefaultIfEmpty()
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
                AssignedUserName = u != null ? (u.FirstName + " " + u.LastName).Trim() : null,
                SprintID = w.SprintID,
                SprintName = sp != null ? sp.SprintName : null
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

        dto.Comments = await GetCommentsAsync(workItemId, ct);

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
                SprintID = w.SprintID,
                TeamID = w.TeamID,
                AssignedUserID = w.AssignedUserID
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

        // Backlog: Story/Task with no sprint and not completed.
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
                SprintID = w.SprintID,
                TeamID = w.TeamID,
                AssignedUserID = w.AssignedUserID
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
        workItem.UpdatedAt = DateTimeHelper.Now;

        _db.WorkItems.Update(workItem);
        return _db.SaveChangesAsync(ct);
    }

    public Task RemoveFromSprintAsync(WorkItem workItem, CancellationToken ct)
    {
        workItem.SprintID = null;
        workItem.UpdatedAt = DateTimeHelper.Now;

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

    public async Task<List<WorkItemCommentDto>> GetCommentsAsync(int workItemId, CancellationToken ct)
    {
        return await (
            from c in _db.WorkItemComments.AsNoTracking()
            join u in _db.Users.AsNoTracking() on c.CommentedBy equals u.UserID
            where c.WorkItemID == workItemId && !c.IsDeleted
            orderby c.CreatedAt ascending, c.CommentID ascending
            select new WorkItemCommentDto
            {
                CommentID = c.CommentID,
                WorkItemID = c.WorkItemID,
                CommentedBy = c.CommentedBy,
                CommentedByName = (u.FirstName + " " + u.LastName).Trim(),
                CommentText = c.CommentText,
                CreatedAt = c.CreatedAt,
                UpdatedAt = c.UpdatedAt
            })
            .ToListAsync(ct);
    }

    public async Task<WorkItemComment?> GetCommentByIdAsync(int commentId, CancellationToken ct)
    {
        return await _db.WorkItemComments
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.CommentID == commentId, ct);
    }

    public async Task<List<int>> GetUsersByTeamIdAsync(int teamId, CancellationToken ct)
    {
        return await _db.Users
            .AsNoTracking()
            .Where(u => u.TeamID == teamId)
            .Select(u => u.UserID)
            .ToListAsync(ct);
    }

    public async Task AddCommentAsync(WorkItemComment comment, CancellationToken ct)
    {
        await _db.WorkItemComments.AddAsync(comment, ct);
    }

    public async Task<List<EpicTileDto>> GetEpicTilesFilteredAsync(
        string? search,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct)
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

        var q = _db.WorkItems
            .AsNoTracking()
            .Where(w => !w.IsDeleted && w.WorkItemTypeID == epicTypeId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLowerInvariant();
            q = q.Where(w => w.Title.ToLower().Contains(s));
        }

        var epics = await ApplyEpicSorting(q, sortBy, sortDirection, ct);

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

    private static async Task<List<(int WorkItemID, string Title)>> ApplyEpicSorting(
        IQueryable<WorkItem> q,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct)
    {
        var descending = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        IOrderedQueryable<WorkItem> orderedQuery;

        if (string.IsNullOrWhiteSpace(sortBy) || sortBy.Trim() == "WorkItemID")
        {
            orderedQuery = descending
                ? q.OrderByDescending(w => w.WorkItemID)
                : q.OrderBy(w => w.WorkItemID);
        }
        else if (sortBy.Trim() == "Title")
        {
            orderedQuery = descending
                ? q.OrderByDescending(w => w.Title)
                : q.OrderBy(w => w.Title);
        }
        else
        {
            orderedQuery = q.OrderByDescending(w => w.WorkItemID);
        }

        var results = await orderedQuery
            .Select(w => new { w.WorkItemID, w.Title })
            .ToListAsync(ct);

        return results.Select(r => (r.WorkItemID, r.Title ?? "")).ToList();
    }

    public async Task<List<WorkItemDto>> GetWorkItemsByParentIdAsync(int parentId, string typeName, CancellationToken ct)
    {
        var typeId = await _db.WorkItemTypes
            .Where(t => t.TypeName == typeName)
            .Select(t => t.WorkItemTypeID)
            .FirstOrDefaultAsync(ct);

        if (typeId == 0 || typeId == default)
            return new List<WorkItemDto>();

        var items = await _db.WorkItems
            .AsNoTracking()
            .Where(w =>
                !w.IsDeleted &&
                w.WorkItemTypeID == typeId &&
                w.ParentWorkItemID == parentId)
            .OrderBy(w => w.WorkItemID)
            .Select(w => new WorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                Description = w.Description,
                Status = w.Status ?? "",
                Priority = w.Priority,
                DueDate = w.DueDate,
                AssignedUserID = w.AssignedUserID,
                ParentWorkItemID = w.ParentWorkItemID,
                TeamID = w.TeamID,
                SprintID = w.SprintID,
                CreatedAt = w.CreatedAt,
                UpdatedAt = w.UpdatedAt
            })
            .ToListAsync(ct);

        return items;
    }

    public async Task<List<AgendaWorkItemDto>> GetBacklogItemsAsync(CancellationToken ct)
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

        var backlogItems = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking()
                on w.WorkItemTypeID equals wt.WorkItemTypeID
            where !w.IsDeleted
                  && !w.SprintID.HasValue
                  && allowedTypeIds.Contains(w.WorkItemTypeID)
                  && w.Status != "Completed"
            orderby w.WorkItemTypeID descending, w.ParentWorkItemID, w.WorkItemID
            select new AgendaWorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                TypeName = wt.TypeName,
                Status = w.Status ?? "",
                Priority = w.Priority,
                ParentWorkItemID = w.ParentWorkItemID,
                SprintID = w.SprintID,
                TeamID = w.TeamID,
                AssignedUserID = w.AssignedUserID
            })
            .ToListAsync(ct);

        return backlogItems;
    }

    public async Task<AgendasResponseDto> GetAgendasFilteredAsync(
        string? status,
        string? priority,
        string? workItemType,
        int? teamId,
        int? assigneeId,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct)
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

        var sprintWorkItemsQuery = _db.WorkItems
            .AsNoTracking()
            .Where(w => !w.IsDeleted
                  && w.SprintID.HasValue
                  && sprintIds.Contains(w.SprintID.Value)
                  && allowedTypeIds.Contains(w.WorkItemTypeID))
            .Select(w => new AgendaWorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                TypeName = w.WorkItemType.TypeName,
                Status = w.Status ?? "",
                Priority = w.Priority,
                DueDate = w.DueDate,
                ParentWorkItemID = w.ParentWorkItemID,
                SprintID = w.SprintID,
                TeamID = w.TeamID,
                AssignedUserID = w.AssignedUserID
            });

        if (!string.IsNullOrWhiteSpace(status))
            sprintWorkItemsQuery = sprintWorkItemsQuery.Where(w => w.Status == status);

        if (!string.IsNullOrWhiteSpace(priority))
            sprintWorkItemsQuery = sprintWorkItemsQuery.Where(w => w.Priority == priority);

        if (!string.IsNullOrWhiteSpace(workItemType))
            sprintWorkItemsQuery = sprintWorkItemsQuery.Where(w => w.TypeName == workItemType);

        if (teamId.HasValue)
            sprintWorkItemsQuery = sprintWorkItemsQuery.Where(w => w.TeamID == teamId.Value);

        if (assigneeId.HasValue)
            sprintWorkItemsQuery = sprintWorkItemsQuery.Where(w => w.AssignedUserID == assigneeId.Value);

        sprintWorkItemsQuery = ApplyAgendaSorting(sprintWorkItemsQuery, sortBy, sortDirection);

        var sprintWorkItems = await sprintWorkItemsQuery.ToListAsync(ct);

        var sprintWorkItemsBySprint = sprintWorkItems
            .GroupBy(w => w.SprintID!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var sprint in sprintRows)
        {
            if (sprintWorkItemsBySprint.TryGetValue(sprint.SprintID, out var items))
                sprint.WorkItems = items;
        }

        // Backlog: Story/Task with no sprint and not completed.
        var backlogWorkItemsQuery = _db.WorkItems
            .AsNoTracking()
            .Where(w => !w.IsDeleted
                  && !w.SprintID.HasValue
                  && allowedTypeIds.Contains(w.WorkItemTypeID)
                  && w.Status != "Completed")
            .Select(w => new AgendaWorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title ?? "",
                TypeName = w.WorkItemType.TypeName,
                Status = w.Status ?? "",
                Priority = w.Priority,
                DueDate = w.DueDate,
                ParentWorkItemID = w.ParentWorkItemID,
                SprintID = w.SprintID,
                TeamID = w.TeamID,
                AssignedUserID = w.AssignedUserID
            });

        if (!string.IsNullOrWhiteSpace(status))
            backlogWorkItemsQuery = backlogWorkItemsQuery.Where(w => w.Status == status);

        if (!string.IsNullOrWhiteSpace(priority))
            backlogWorkItemsQuery = backlogWorkItemsQuery.Where(w => w.Priority == priority);

        if (!string.IsNullOrWhiteSpace(workItemType))
            backlogWorkItemsQuery = backlogWorkItemsQuery.Where(w => w.TypeName == workItemType);

        if (teamId.HasValue)
            backlogWorkItemsQuery = backlogWorkItemsQuery.Where(w => w.TeamID == teamId.Value);

        if (assigneeId.HasValue)
            backlogWorkItemsQuery = backlogWorkItemsQuery.Where(w => w.AssignedUserID == assigneeId.Value);

        backlogWorkItemsQuery = ApplyAgendaSorting(backlogWorkItemsQuery, sortBy, sortDirection);

        var backlogWorkItems = await backlogWorkItemsQuery.ToListAsync(ct);

        return new AgendasResponseDto
        {
            Sprints = sprintRows,
            WorkItems = backlogWorkItems
        };
    }

    private static IQueryable<AgendaWorkItemDto> ApplyAgendaSorting(
        IQueryable<AgendaWorkItemDto> q,
        string? sortBy,
        string? sortDirection)
    {
        var descending = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        return sortBy?.Trim() switch
        {
            "Title" => descending
                ? q.OrderByDescending(w => w.Title)
                : q.OrderBy(w => w.Title),
            "Priority" => descending
                ? q.OrderByDescending(w => w.Priority)
                : q.OrderBy(w => w.Priority),
            "Status" => descending
                ? q.OrderByDescending(w => w.Status)
                : q.OrderBy(w => w.Status),
            "DueDate" => descending
                ? q.OrderByDescending(w => w.DueDate.HasValue).ThenByDescending(w => w.DueDate)
                : q.OrderBy(w => w.DueDate.HasValue ? 0 : 1).ThenBy(w => w.DueDate),
            "WorkItemID" => descending
                ? q.OrderByDescending(w => w.WorkItemID)
                : q.OrderBy(w => w.WorkItemID),
            _ => q.OrderByDescending(w => w.WorkItemID)
        };
    }

    public async Task<List<WorkItem>> GetWorkItemsBySprintIdAsync(int sprintId, CancellationToken ct)
    {
        // Simple query: all work items for sprint, excluding deleted
        return await _db.WorkItems
            .AsNoTracking()
            .Include(w => w.WorkItemType)
            .Include(w => w.AssignedUser)
            .Where(w => w.SprintID == sprintId && !w.IsDeleted)
            .OrderBy(w => w.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<List<WorkItem>> GetChildTasksByParentIdAsync(int parentId, CancellationToken ct)
    {
        return await _db.WorkItems
            .AsNoTracking()
            .Include(w => w.WorkItemType)
            .Include(w => w.AssignedUser)
            .Where(w => w.ParentWorkItemID == parentId && !w.IsDeleted)
            .ToListAsync(ct);
    }

    public async Task<WorkItemHierarchyDto?> GetEpicHierarchyAsync(int epicId, CancellationToken ct)
    {
        var epicTypeId = await _db.WorkItemTypes.AsNoTracking()
            .Where(t => t.TypeName == "Epic").Select(t => t.WorkItemTypeID).FirstOrDefaultAsync(ct);
        var storyTypeId = await _db.WorkItemTypes.AsNoTracking()
            .Where(t => t.TypeName == "Story").Select(t => t.WorkItemTypeID).FirstOrDefaultAsync(ct);
        var taskTypeId = await _db.WorkItemTypes.AsNoTracking()
            .Where(t => t.TypeName == "Task").Select(t => t.WorkItemTypeID).FirstOrDefaultAsync(ct);

        if (epicTypeId == 0 || storyTypeId == 0 || taskTypeId == 0) return null;

        // Load the epic root
        var epic = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals wt.WorkItemTypeID
            join u in _db.Users.AsNoTracking() on w.AssignedUserID equals u.UserID into uj from u in uj.DefaultIfEmpty()
            join t in _db.Teams.AsNoTracking() on w.TeamID equals t.TeamID into tj from t in tj.DefaultIfEmpty()
            where w.WorkItemID == epicId && !w.IsDeleted && w.WorkItemTypeID == epicTypeId
            select new { w, TypeName = wt.TypeName, AssignedUserName = u != null ? (u.FirstName + " " + u.LastName).Trim() : null, TeamName = t != null ? t.TeamName : null }
        ).FirstOrDefaultAsync(ct);

        if (epic is null) return null;

        // Load all descendants: stories under epic + tasks under epic (direct) + tasks under stories
        var descendants = await (
            from w in _db.WorkItems.AsNoTracking()
            join wt in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals wt.WorkItemTypeID
            join u in _db.Users.AsNoTracking() on w.AssignedUserID equals u.UserID into uj from u in uj.DefaultIfEmpty()
            join t in _db.Teams.AsNoTracking() on w.TeamID equals t.TeamID into tj from t in tj.DefaultIfEmpty()
            join sp in _db.Sprints.AsNoTracking() on w.SprintID equals sp.SprintID into spj from sp in spj.DefaultIfEmpty()
            where !w.IsDeleted && (
                (w.WorkItemTypeID == storyTypeId && w.ParentWorkItemID == epicId) ||
                (w.WorkItemTypeID == taskTypeId && w.ParentWorkItemID == epicId) ||
                (w.WorkItemTypeID == taskTypeId && w.ParentWorkItemID.HasValue &&
                    _db.WorkItems.Any(p => p.WorkItemID == w.ParentWorkItemID.Value && p.ParentWorkItemID == epicId && !p.IsDeleted))
            )
            select new
            {
                w.WorkItemID,
                TypeName = wt.TypeName,
                w.Title,
                w.Description,
                w.Status,
                w.Priority,
                w.DueDate,
                w.AssignedUserID,
                AssignedUserName = u != null ? (u.FirstName + " " + u.LastName).Trim() : null,
                w.ParentWorkItemID,
                w.TeamID,
                TeamName = t != null ? t.TeamName : null,
                w.SprintID,
                SprintName = sp != null ? sp.SprintName : null,
                w.CreatedAt,
                w.UpdatedAt
            }
        ).ToListAsync(ct);

        // Build flat map
        var map = new Dictionary<int, WorkItemHierarchyDto>();
        foreach (var d in descendants)
        {
            map[d.WorkItemID] = new WorkItemHierarchyDto
            {
                WorkItemID = d.WorkItemID,
                TypeName = d.TypeName,
                Title = d.Title ?? "",
                Description = d.Description,
                Status = d.Status,
                Priority = d.Priority,
                DueDate = d.DueDate,
                AssignedUserID = d.AssignedUserID,
                AssignedUserName = d.AssignedUserName,
                ParentWorkItemID = d.ParentWorkItemID,
                TeamID = d.TeamID,
                TeamName = d.TeamName,
                SprintID = d.SprintID,
                SprintName = d.SprintName,
                CreatedAt = d.CreatedAt,
                UpdatedAt = d.UpdatedAt,
                Children = new List<WorkItemHierarchyDto>()
            };
        }

        // Build tree: assign children to parents
        var roots = new List<WorkItemHierarchyDto>();
        foreach (var node in map.Values)
        {
            if (node.ParentWorkItemID.HasValue && map.TryGetValue(node.ParentWorkItemID.Value, out var parent))
            {
                parent.Children.Add(node);
            }
            else
            {
                roots.Add(node);
            }
        }

        // Sort children: stories first, then tasks; within each group by WorkItemID
        foreach (var node in map.Values)
        {
            node.Children = node.Children
                .OrderBy(c => c.TypeName == "Story" ? 0 : 1)
                .ThenBy(c => c.WorkItemID)
                .ToList();
        }

        // Build the root epic node
        var rootDto = new WorkItemHierarchyDto
        {
            WorkItemID = epic.w.WorkItemID,
            TypeName = epic.TypeName,
            Title = epic.w.Title ?? "",
            Description = epic.w.Description,
            Status = epic.w.Status ?? "",
            Priority = epic.w.Priority,
            DueDate = epic.w.DueDate,
            AssignedUserID = epic.w.AssignedUserID,
            AssignedUserName = epic.AssignedUserName,
            ParentWorkItemID = epic.w.ParentWorkItemID,
            TeamID = epic.w.TeamID,
            TeamName = epic.TeamName,
            SprintID = epic.w.SprintID,
            SprintName = null,
            CreatedAt = epic.w.CreatedAt,
            UpdatedAt = epic.w.UpdatedAt,
            Children = roots
                .OrderBy(c => c.TypeName == "Story" ? 0 : 1)
                .ThenBy(c => c.WorkItemID)
                .ToList()
        };

        return rootDto;
    }
}