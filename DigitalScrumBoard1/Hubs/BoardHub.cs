using Microsoft.AspNetCore.SignalR;

namespace DigitalScrumBoard1.Hubs;

public class BoardHub : Hub
{
    public async Task JoinSprintGroup(int sprintId)
    {
        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            $"sprint-{sprintId}"
        );
    }

    public async Task LeaveSprintGroup(int sprintId)
    {
        await Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            $"sprint-{sprintId}"
        );
    }
}