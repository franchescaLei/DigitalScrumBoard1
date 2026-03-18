using DigitalScrumBoard1.DTOs.Notifications;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;

namespace DigitalScrumBoard1.Services;

public sealed class NotificationService : INotificationService
{
    private readonly INotificationRepository _repo;

    public NotificationService(INotificationRepository repo)
    {
        _repo = repo;
    }

    public async Task<NotificationListResponseDto> GetMyNotificationsAsync(
        int userId,
        bool? isRead,
        string? type,
        int page,
        int pageSize,
        CancellationToken ct)
    {
        var unreadCount = await _repo.GetUnreadCountAsync(userId, ct);
        var result = await _repo.GetForUserAsync(userId, isRead, type, page, pageSize, ct);

        return new NotificationListResponseDto
        {
            Page = page < 1 ? 1 : page,
            PageSize = pageSize < 1 ? 1 : Math.Min(pageSize, 100),
            Total = result.Total,
            UnreadCount = unreadCount,
            Items = result.Items
        };
    }

    public Task<int> GetMyUnreadCountAsync(int userId, CancellationToken ct)
        => _repo.GetUnreadCountAsync(userId, ct);

    public async Task<bool> MarkAsReadAsync(int userId, int notificationId, CancellationToken ct)
    {
        var row = await _repo.GetTrackedByIdForUserAsync(notificationId, userId, ct);
        if (row is null)
            return false;

        if (!row.IsRead)
        {
            row.IsRead = true;
            row.ReadAt = DateTime.UtcNow;
            await _repo.SaveChangesAsync(ct);
        }

        return true;
    }

    public Task<int> MarkAllAsReadAsync(int userId, CancellationToken ct)
        => _repo.MarkAllAsReadAsync(userId, DateTime.UtcNow, ct);

    public List<int> BuildRecipientList(int actorUserId, params int?[] candidateUserIds)
    {
        return candidateUserIds
            .Where(x => x.HasValue)
            .Select(x => x!.Value)
            .Where(x => x > 0 && x != actorUserId)
            .Distinct()
            .ToList();
    }

    public async Task AddNotificationsAsync(IEnumerable<Notification> notifications, CancellationToken ct)
    {
        var items = notifications.ToList();
        if (items.Count == 0)
            return;

        await _repo.AddRangeAsync(items, ct);
        await _repo.SaveChangesAsync(ct);
    }
}