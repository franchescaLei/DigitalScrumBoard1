using DigitalScrumBoard1.DTOs.WorkItems;
using DigitalScrumBoard1.Models;

namespace DigitalScrumBoard1.Repositories;

public interface IWorkItemRepository
{
    Task<int?> GetWorkItemTypeIdByNameAsync(string typeName, CancellationToken ct);

    Task<(int WorkItemID, int WorkItemTypeID, bool IsDeleted)?> GetWorkItemTypeInfoByIdAsync(
        int id,
        CancellationToken ct);

    Task<WorkItem?> GetByIdAsync(int id, CancellationToken ct);
    Task<WorkItem?> GetTrackedByIdAsync(int id, CancellationToken ct);

    Task AddAsync(WorkItem item, CancellationToken ct);

    Task SaveChangesAsync(CancellationToken ct);

    Task AddWithAuditAsync(WorkItem item, AuditLog audit, CancellationToken ct);

    Task<List<(int WorkItemID, string Title, string TypeName)>> ListParentsAsync(int[] allowedTypeIds, CancellationToken ct);

    Task<List<EpicTileDto>> GetEpicTilesAsync(CancellationToken ct);

    Task<WorkItemDetailsResponseDto?> GetWorkItemDetailsAsync(int workItemId, CancellationToken ct);

    Task<AgendasResponseDto> GetAgendasAsync(CancellationToken ct);

    Task<Sprint?> GetSprintByIdAsync(int sprintId, CancellationToken ct);

    Task<int?> GetSprintManagerUserIdAsync(int sprintId, CancellationToken ct);

    Task AssignToSprintAsync(WorkItem workItem, int sprintId, CancellationToken ct);

    Task RemoveFromSprintAsync(WorkItem workItem, CancellationToken ct);

    Task<bool> UserExistsAsync(int userId, CancellationToken ct);

    Task<bool> TeamExistsAsync(int teamId, CancellationToken ct);

    Task<bool> HasActiveChildrenAsync(int workItemId, CancellationToken ct);

    Task AddHistoryAsync(WorkItemHistory history, CancellationToken ct);

    Task AddNotificationsAsync(IEnumerable<Notification> notifications, CancellationToken ct);

    Task<List<WorkItemCommentDto>> GetCommentsAsync(int workItemId, CancellationToken ct);

    Task AddCommentAsync(WorkItemComment comment, CancellationToken ct);

    Task<List<EpicTileDto>> GetEpicTilesFilteredAsync(
        string? search,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct);

    Task<List<WorkItemDto>> GetWorkItemsByParentIdAsync(int parentId, string typeName, CancellationToken ct);

    Task<List<AgendaWorkItemDto>> GetBacklogItemsAsync(CancellationToken ct);

    Task<AgendasResponseDto> GetAgendasFilteredAsync(
        string? status,
        string? priority,
        string? workItemType,
        int? teamId,
        int? assigneeId,
        string? sortBy,
        string? sortDirection,
        CancellationToken ct);
    
    Task<List<WorkItem>> GetWorkItemsBySprintIdAsync(int sprintId, CancellationToken ct);
}