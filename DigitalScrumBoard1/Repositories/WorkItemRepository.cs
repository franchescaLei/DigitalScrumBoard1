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
        var rows = await (from w in _db.WorkItems.AsNoTracking()
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
            .Where(w => w.WorkItemTypeID == epicTypeId && !w.IsDeleted)
            .OrderByDescending(w => w.WorkItemID)
            .Select(epic => new EpicTileDto
            {
                EpicID = epic.WorkItemID,
                EpicTitle = epic.Title,

                TotalStories = _db.WorkItems.Count(s =>
                    s.ParentWorkItemID == epic.WorkItemID &&
                    s.WorkItemTypeID == storyTypeId &&
                    !s.IsDeleted),

                CompletedStories = _db.WorkItems.Count(s =>
                    s.ParentWorkItemID == epic.WorkItemID &&
                    s.WorkItemTypeID == storyTypeId &&
                    s.Status == "Completed" &&
                    !s.IsDeleted),

                TotalTasks =
                    _db.WorkItems.Count(t =>
                        t.WorkItemTypeID == taskTypeId &&
                        !t.IsDeleted &&
                        (
                            t.ParentWorkItemID == epic.WorkItemID ||
                            _db.WorkItems.Any(s =>
                                s.WorkItemID == t.ParentWorkItemID &&
                                s.ParentWorkItemID == epic.WorkItemID &&
                                s.WorkItemTypeID == storyTypeId
                            )
                        )),

                CompletedTasks =
                    _db.WorkItems.Count(t =>
                        t.WorkItemTypeID == taskTypeId &&
                        t.Status == "Completed" &&
                        !t.IsDeleted &&
                        (
                            t.ParentWorkItemID == epic.WorkItemID ||
                            _db.WorkItems.Any(s =>
                                s.WorkItemID == t.ParentWorkItemID &&
                                s.ParentWorkItemID == epic.WorkItemID &&
                                s.WorkItemTypeID == storyTypeId
                            )
                        ))
            })
            .ToListAsync(ct);

        return epics;
    }

    public async Task<WorkItemDetailsResponseDto?> GetWorkItemDetailsAsync(int workItemId, CancellationToken ct)
    {
        var epicTypeId = await _db.WorkItemTypes.Where(t => t.TypeName == "Epic").Select(t => t.WorkItemTypeID).FirstAsync(ct);
        var storyTypeId = await _db.WorkItemTypes.Where(t => t.TypeName == "Story").Select(t => t.WorkItemTypeID).FirstAsync(ct);
        var taskTypeId = await _db.WorkItemTypes.Where(t => t.TypeName == "Task").Select(t => t.WorkItemTypeID).FirstAsync(ct);

        var baseRow = await (from w in _db.WorkItems.AsNoTracking()
                             join wt in _db.WorkItemTypes.AsNoTracking() on w.WorkItemTypeID equals wt.WorkItemTypeID
                             join team in _db.Teams.AsNoTracking() on w.TeamID equals team.TeamID into teamJoin
                             from team in teamJoin.DefaultIfEmpty()
                             where w.WorkItemID == workItemId && !w.IsDeleted
                             select new
                             {
                                 w.WorkItemID,
                                 TypeName = wt.TypeName,
                                 w.Title,
                                 w.Description,
                                 w.Status,
                                 w.Priority,
                                 w.DueDate,
                                 w.ParentWorkItemID,
                                 w.TeamID,
                                 TeamName = team != null ? team.TeamName : null,
                                 w.AssignedUserID
                             })
            .FirstOrDefaultAsync(ct);

        if (baseRow is null)
            return null;

        string? assignedUserName = null;
        if (baseRow.AssignedUserID.HasValue)
        {
            assignedUserName = await _db.Users.AsNoTracking()
                .Where(u => u.UserID == baseRow.AssignedUserID.Value)
                .Select(u => (u.FirstName + " " + u.LastName).Trim())
                .FirstOrDefaultAsync(ct);
        }

        string? parentTitle = null;
        if (baseRow.ParentWorkItemID.HasValue)
        {
            parentTitle = await _db.WorkItems.AsNoTracking()
                .Where(p => p.WorkItemID == baseRow.ParentWorkItemID.Value)
                .Select(p => p.Title)
                .FirstOrDefaultAsync(ct);
        }

        var dto = new WorkItemDetailsResponseDto
        {
            WorkItemID = baseRow.WorkItemID,
            TypeName = baseRow.TypeName,
            Title = baseRow.Title ?? "",
            Description = baseRow.Description,
            Status = baseRow.Status ?? "",
            Priority = baseRow.Priority,
            DueDate = baseRow.DueDate,
            ParentWorkItemID = baseRow.ParentWorkItemID,
            ParentTitle = parentTitle,
            TeamID = baseRow.TeamID,
            TeamName = baseRow.TeamName,
            AssignedUserID = baseRow.AssignedUserID,
            AssignedUserName = assignedUserName
        };

        if (baseRow.TypeName == "Epic")
        {
            dto.Stories = await (from s in _db.WorkItems.AsNoTracking()
                                 join st in _db.WorkItemTypes.AsNoTracking() on s.WorkItemTypeID equals st.WorkItemTypeID
                                 where !s.IsDeleted
                                       && s.WorkItemTypeID == storyTypeId
                                       && s.ParentWorkItemID == workItemId
                                 orderby s.WorkItemID
                                 select new WorkItemChildDto
                                 {
                                     WorkItemID = s.WorkItemID,
                                     TypeName = st.TypeName,
                                     Title = s.Title,
                                     Status = s.Status,
                                     Priority = s.Priority
                                 }).ToListAsync(ct);

            var storyIds = dto.Stories.Select(x => x.WorkItemID).ToList();

            dto.Tasks = await (from t in _db.WorkItems.AsNoTracking()
                               join tt in _db.WorkItemTypes.AsNoTracking() on t.WorkItemTypeID equals tt.WorkItemTypeID
                               where !t.IsDeleted
                                     && t.WorkItemTypeID == taskTypeId
                                     && (
                                         t.ParentWorkItemID == workItemId ||
                                         (t.ParentWorkItemID.HasValue && storyIds.Contains(t.ParentWorkItemID.Value))
                                     )
                               orderby t.WorkItemID
                               select new WorkItemChildDto
                               {
                                   WorkItemID = t.WorkItemID,
                                   TypeName = tt.TypeName,
                                   Title = t.Title,
                                   Status = t.Status,
                                   Priority = t.Priority
                               }).ToListAsync(ct);
        }
        else if (baseRow.TypeName == "Story")
        {
            dto.Tasks = await (from t in _db.WorkItems.AsNoTracking()
                               join tt in _db.WorkItemTypes.AsNoTracking() on t.WorkItemTypeID equals tt.WorkItemTypeID
                               where !t.IsDeleted
                                     && t.WorkItemTypeID == taskTypeId
                                     && t.ParentWorkItemID == workItemId
                               orderby t.WorkItemID
                               select new WorkItemChildDto
                               {
                                   WorkItemID = t.WorkItemID,
                                   TypeName = tt.TypeName,
                                   Title = t.Title,
                                   Status = t.Status,
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
}