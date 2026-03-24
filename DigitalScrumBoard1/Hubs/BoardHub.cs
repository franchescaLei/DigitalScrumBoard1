using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace DigitalScrumBoard1.Hubs;

[Authorize(AuthenticationSchemes = "MyCookieAuth")]
public sealed class BoardHub : Hub
{
    public Task JoinSprintBoard(int sprintId)
    {
        if (sprintId <= 0)
            throw new HubException("SprintID must be greater than 0.");

        return Groups.AddToGroupAsync(Context.ConnectionId, $"sprint-{sprintId}");
    }

    public Task LeaveSprintBoard(int sprintId)
    {
        if (sprintId <= 0)
            throw new HubException("SprintID must be greater than 0.");

        return Groups.RemoveFromGroupAsync(Context.ConnectionId, $"sprint-{sprintId}");
    }
}