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

    public async Task AddAsync(WorkItem item, CancellationToken ct)
    {
        await _db.WorkItems.AddAsync(item, ct);
    }

    public Task SaveChangesAsync(CancellationToken ct) => _db.SaveChangesAsync(ct);

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
                    s.Status == "Done" &&
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
                        t.Status == "Done" &&
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
        // Type IDs
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
                                 w.TeamID,                 // int?
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

        // Children rules (reusable):
        // - Epic -> Stories under epic, Tasks under epic OR under those stories
        // - Story -> Tasks under story
        // - Task -> none
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
}