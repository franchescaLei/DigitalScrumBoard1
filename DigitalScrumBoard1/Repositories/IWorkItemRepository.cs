using DigitalScrumBoard1.DTOs.WorkItems;
using DigitalScrumBoard1.Models;

namespace DigitalScrumBoard1.Repositories;

public interface IWorkItemRepository
{
    Task<int?> GetWorkItemTypeIdByNameAsync(string typeName, CancellationToken ct);

    Task<(int WorkItemID, int WorkItemTypeID, bool IsDeleted)?> GetWorkItemTypeInfoByIdAsync(int id, CancellationToken ct);

    Task<WorkItem?> GetByIdAsync(int id, CancellationToken ct);

    Task AddAsync(WorkItem item, CancellationToken ct);

    Task SaveChangesAsync(CancellationToken ct);

    Task AddWithAuditAsync(WorkItem item, AuditLog audit, CancellationToken ct);

    Task<List<(int WorkItemID, string Title, string TypeName)>> ListParentsAsync(int[] allowedTypeIds, CancellationToken ct);

    Task<List<EpicTileDto>> GetEpicTilesAsync(CancellationToken ct);

    Task<WorkItemDetailsResponseDto?> GetWorkItemDetailsAsync(int workItemId, CancellationToken ct);

    Task<AgendasResponseDto> GetAgendasAsync(CancellationToken ct);

    Task<Sprint?> GetSprintByIdAsync(int sprintId, CancellationToken ct);

    Task AssignToSprintAsync(WorkItem workItem, int sprintId, CancellationToken ct);

    Task RemoveFromSprintAsync(WorkItem workItem, CancellationToken ct);
}