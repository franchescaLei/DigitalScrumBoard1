using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.DTOs;
using DigitalScrumBoard1.Hubs;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;
using Microsoft.AspNetCore.SignalR;

namespace DigitalScrumBoard1.Services;

public class BoardService : IBoardService
{
    private readonly IBoardRepository _repo;
    private readonly IHubContext<BoardHub> _hub;
    private readonly DigitalScrumBoardContext _db;
    private readonly IAuditService _audit;

    public BoardService(
        IBoardRepository repo,
        IHubContext<BoardHub> hub,
        DigitalScrumBoardContext db,
        IAuditService audit)
    {
        _repo = repo;
        _hub = hub;
        _db = db;
        _audit = audit;
    }

    public Task<List<ActiveBoardDto>> GetActiveBoardsAsync(CancellationToken ct)
    {
        return _repo.GetActiveBoardsAsync(ct);
    }

    public async Task<BoardResponseDto> GetBoardAsync(
        int sprintId,
        int? assigneeId,
        string? priority,
        string? status,
        string? workItemType,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct)
    {
        if (sprintId <= 0)
            throw new ArgumentException("SprintID must be greater than 0.");

        var normalizedPriority = NormalizePriority(priority);
        if (priority is not null && normalizedPriority is null)
            throw new ArgumentException("Invalid priority. Allowed values: Low, Medium, High, Critical.");

        var normalizedStatus = NormalizeStatus(status);
        if (status is not null && normalizedStatus is null)
            throw new ArgumentException("Invalid status. Allowed values: To-do, Ongoing, For Checking, Completed.");

        var normalizedWorkItemType = NormalizeWorkItemType(workItemType);
        if (workItemType is not null && normalizedWorkItemType is null)
            throw new ArgumentException("Invalid workItemType. Allowed values: Epic, Story, Task.");

        var normalizedSortBy = NormalizeSortBy(sortBy);
        if (sortBy is not null && normalizedSortBy is null)
            throw new ArgumentException("Invalid sortBy. Allowed values: Priority, DueDate, CreatedDate.");

        var normalizedSortDirection = NormalizeSortDirection(sortDirection);
        if (sortDirection is not null && normalizedSortDirection is null)
            throw new ArgumentException("Invalid sortDirection. Allowed values: asc, desc.");

        var sprint = await _repo.GetSprintAsync(sprintId, ct);
        if (sprint is null)
            throw new KeyNotFoundException("Sprint not found.");

        if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Only active sprint boards can be viewed.");

        var items = await _repo.GetSprintWorkItemsAsync(sprintId, ct);

        IEnumerable<WorkItem> filtered = items;

        if (assigneeId.HasValue)
            filtered = filtered.Where(w => w.AssignedUserID == assigneeId.Value);

        if (normalizedPriority is not null)
            filtered = filtered.Where(w => string.Equals(w.Priority, normalizedPriority, StringComparison.OrdinalIgnoreCase));

        if (normalizedStatus is not null)
            filtered = filtered.Where(w => string.Equals(w.Status, normalizedStatus, StringComparison.OrdinalIgnoreCase));

        if (normalizedWorkItemType is not null)
            filtered = filtered.Where(w =>
                w.WorkItemType != null &&
                string.Equals(w.WorkItemType.TypeName, normalizedWorkItemType, StringComparison.OrdinalIgnoreCase));

        var filteredList = filtered.ToList();

        return new BoardResponseDto
        {
            SprintID = sprint.SprintID,
            SprintName = sprint.SprintName,
            Todo = BuildColumn(filteredList, "To-do", normalizedSortBy, normalizedSortDirection),
            Ongoing = BuildColumn(filteredList, "Ongoing", normalizedSortBy, normalizedSortDirection),
            ForChecking = BuildColumn(filteredList, "For Checking", normalizedSortBy, normalizedSortDirection),
            Completed = BuildColumn(filteredList, "Completed", normalizedSortBy, normalizedSortDirection)
        };
    }

    public async Task MoveWorkItemAsync(
        int workItemId,
        string newStatus,
        int userId,
        string role,
        string ipAddress,
        CancellationToken ct)
    {
        var item = await _repo.GetWorkItemAsync(workItemId, ct)
            ?? throw new KeyNotFoundException("Work item not found.");

        if (!item.SprintID.HasValue)
            throw new InvalidOperationException("Work item is not assigned to a sprint.");

        var normalizedStatus = NormalizeStatus(newStatus);
        if (normalizedStatus is null)
            throw new ArgumentException("Invalid status. Allowed values: To-do, Ongoing, For Checking, Completed.");

        if (!BoardWorkflowRules.IsValidTransition(item.Status, normalizedStatus))
            throw new ArgumentException($"Invalid status transition from '{item.Status}' to '{normalizedStatus}'.");

        bool allowed =
            string.Equals(role, "Administrator", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "ScrumMaster", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "Scrum Master", StringComparison.OrdinalIgnoreCase) ||
            item.AssignedUserID == userId;

        if (!allowed)
            throw new UnauthorizedAccessException("You are not allowed to move this work item.");

        var sprint = await _repo.GetSprintAsync(item.SprintID.Value, ct);
        if (sprint is null)
            throw new InvalidOperationException("Sprint not found.");

        if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Sprint not active.");

        using var tx = await _db.Database.BeginTransactionAsync(ct);

        var oldStatus = item.Status;

        item.Status = normalizedStatus;
        item.UpdatedAt = DateTime.UtcNow;

        await _repo.AddHistoryAsync(new WorkItemHistory
        {
            WorkItemID = item.WorkItemID,
            FieldChanged = "Status",
            OldValue = oldStatus,
            NewValue = normalizedStatus,
            ChangedAt = DateTime.UtcNow,
            ChangedBy = userId
        }, ct);

        if (item.AssignedUserID != null)
        {
            await _repo.AddNotificationAsync(new Notification
            {
                UserID = item.AssignedUserID.Value,
                Message = $"Work item '{item.Title}' moved to {normalizedStatus}",
                NotificationType = "StatusChanged",
                RelatedWorkItemID = item.WorkItemID,
                CreatedAt = DateTime.UtcNow
            }, ct);
        }

        await _repo.SaveAsync(ct);
        await tx.CommitAsync(ct);

        await _audit.LogAsync(
            userId,
            "WorkItem.MoveBoardStatus",
            "WorkItem",
            item.WorkItemID,
            true,
            $"Moved WorkItemID={item.WorkItemID} from {oldStatus} to {normalizedStatus}; SprintID={item.SprintID}",
            string.IsNullOrWhiteSpace(ipAddress) ? "unknown" : ipAddress,
            ct
        );

        await _hub.Clients
            .Group($"sprint-{item.SprintID}")
            .SendAsync("WorkItemMoved", new
            {
                item.WorkItemID,
                newStatus = normalizedStatus
            }, ct);
    }

    public async Task ReorderWorkItemAsync(
        int workItemId,
        int newPosition,
        int userId,
        string role,
        string ipAddress,
        CancellationToken ct)
    {
        if (workItemId <= 0)
            throw new ArgumentException("WorkItemID must be greater than 0.");

        if (newPosition < 0)
            throw new ArgumentException("NewPosition must be 0 or greater.");

        var item = await _repo.GetWorkItemAsync(workItemId, ct)
            ?? throw new KeyNotFoundException("Work item not found.");

        if (!item.SprintID.HasValue)
            throw new InvalidOperationException("Work item is not assigned to a sprint.");

        bool allowed =
            string.Equals(role, "Administrator", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "ScrumMaster", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "Scrum Master", StringComparison.OrdinalIgnoreCase) ||
            item.AssignedUserID == userId;

        if (!allowed)
            throw new UnauthorizedAccessException("You are not allowed to reorder this work item.");

        var sprint = await _repo.GetSprintAsync(item.SprintID.Value, ct);
        if (sprint is null)
            throw new InvalidOperationException("Sprint not found.");

        if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Sprint not active.");

        var oldPosition = item.BoardOrder;

        item.BoardOrder = newPosition;
        item.UpdatedAt = DateTime.UtcNow;

        await _repo.SaveAsync(ct);

        await _audit.LogAsync(
            userId,
            "WorkItem.ReorderBoardPosition",
            "WorkItem",
            item.WorkItemID,
            true,
            $"Reordered WorkItemID={item.WorkItemID} from BoardOrder={oldPosition} to BoardOrder={newPosition}; SprintID={item.SprintID}",
            string.IsNullOrWhiteSpace(ipAddress) ? "unknown" : ipAddress,
            ct
        );

        await _hub.Clients
            .Group($"sprint-{item.SprintID.Value}")
            .SendAsync("WorkItemReordered", new
            {
                item.WorkItemID,
                newPosition
            }, ct);
    }

    public async Task<SprintMetricsDto> GetSprintMetricsAsync(
        int sprintId,
        CancellationToken ct)
    {
        var items = await _repo.GetSprintWorkItemsAsync(sprintId, ct);

        var total = items.Count;
        var completed = items.Count(i => i.Status == "Completed");
        var remaining = total - completed;

        return new SprintMetricsDto
        {
            TotalItems = total,
            CompletedItems = completed,
            RemainingItems = remaining,
            CompletionRate = total == 0 ? 0 : (double)completed / total * 100,
            TotalStoryPoints = 0,
            CompletedStoryPoints = 0
        };
    }

    private static List<WorkItemBoardDto> BuildColumn(
        List<WorkItem> items,
        string status,
        string? sortBy,
        string? sortDirection)
    {
        var columnItems = items
            .Where(w => string.Equals(w.Status, status, StringComparison.OrdinalIgnoreCase));

        var ordered = ApplyColumnSorting(columnItems, sortBy, sortDirection);

        return ordered
            .Select(MapBoardItem)
            .ToList();
    }

    private static IEnumerable<WorkItem> ApplyColumnSorting(
        IEnumerable<WorkItem> items,
        string? sortBy,
        string? sortDirection)
    {
        var descending = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        if (string.IsNullOrWhiteSpace(sortBy))
        {
            return items
                .OrderBy(w => w.BoardOrder)
                .ThenBy(w => w.CreatedAt);
        }

        return sortBy switch
        {
            "Priority" => descending
                ? items.OrderByDescending(w => GetPriorityRank(w.Priority)).ThenBy(w => w.BoardOrder).ThenBy(w => w.CreatedAt)
                : items.OrderBy(w => GetPriorityRank(w.Priority)).ThenBy(w => w.BoardOrder).ThenBy(w => w.CreatedAt),

            "DueDate" => descending
                ? items.OrderByDescending(w => w.DueDate.HasValue).ThenByDescending(w => w.DueDate).ThenBy(w => w.BoardOrder).ThenBy(w => w.CreatedAt)
                : items.OrderBy(w => w.DueDate.HasValue ? 0 : 1).ThenBy(w => w.DueDate).ThenBy(w => w.BoardOrder).ThenBy(w => w.CreatedAt),

            "CreatedDate" => descending
                ? items.OrderByDescending(w => w.CreatedAt).ThenBy(w => w.BoardOrder)
                : items.OrderBy(w => w.CreatedAt).ThenBy(w => w.BoardOrder),

            _ => items.OrderBy(w => w.BoardOrder).ThenBy(w => w.CreatedAt)
        };
    }

    private static int GetPriorityRank(string? priority)
    {
        return priority?.Trim().ToLowerInvariant() switch
        {
            "low" => 1,
            "medium" => 2,
            "high" => 3,
            "critical" => 4,
            _ => 0
        };
    }

    private static WorkItemBoardDto MapBoardItem(WorkItem item)
    {
        return new WorkItemBoardDto
        {
            WorkItemID = item.WorkItemID,
            Title = item.Title ?? string.Empty,
            Status = item.Status ?? string.Empty,
            AssignedUserID = item.AssignedUserID
        };
    }

    private static string? NormalizePriority(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        return raw.Trim().ToLowerInvariant() switch
        {
            "low" => "Low",
            "medium" => "Medium",
            "high" => "High",
            "critical" => "Critical",
            _ => null
        };
    }

    private static string? NormalizeStatus(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        return raw.Trim().ToLowerInvariant() switch
        {
            "to-do" => "To-do",
            "todo" => "To-do",
            "ongoing" => "Ongoing",
            "for checking" => "For Checking",
            "for-checking" => "For Checking",
            "completed" => "Completed",
            _ => null
        };
    }

    private static string? NormalizeWorkItemType(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        return raw.Trim().ToLowerInvariant() switch
        {
            "epic" => "Epic",
            "story" => "Story",
            "task" => "Task",
            _ => null
        };
    }

    private static string? NormalizeSortBy(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        return raw.Trim().ToLowerInvariant() switch
        {
            "priority" => "Priority",
            "duedate" => "DueDate",
            "due-date" => "DueDate",
            "createddate" => "CreatedDate",
            "created-date" => "CreatedDate",
            _ => null
        };
    }

    private static string? NormalizeSortDirection(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        return raw.Trim().ToLowerInvariant() switch
        {
            "asc" => "asc",
            "desc" => "desc",
            _ => null
        };
    }
}