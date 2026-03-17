using DigitalScrumBoard1.DTOs.Sprints;
using DigitalScrumBoard1.Hubs;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class SprintsController : ControllerBase
{
    private readonly ISprintRepository _repo;
    private readonly IAuditService _audit;
    private readonly IHubContext<BoardHub> _hub;

    public SprintsController(
        ISprintRepository repo,
        IAuditService audit,
        IHubContext<BoardHub> hub)
    {
        _repo = repo;
        _audit = audit;
        _hub = hub;
    }

    [HttpPost]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator,Scrum Master,ScrumMaster")]
    public async Task<ActionResult<SprintCreatedResponseDto>> Create(
        [FromBody] CreateSprintRequestDto req,
        CancellationToken ct)
    {
        if (!ModelState.IsValid)
            return ValidationProblem(ModelState);

        var sprintName = (req.SprintName ?? "").Trim();
        var goal = (req.Goal ?? "").Trim();

        if (sprintName.Length == 0)
            return BadRequest(new { message = "SprintName is required." });

        if (goal.Length == 0)
            return BadRequest(new { message = "Goal is required." });

        if (!req.StartDate.HasValue)
            return BadRequest(new { message = "StartDate is required." });

        if (!req.EndDate.HasValue)
            return BadRequest(new { message = "EndDate is required." });

        if (!req.ManagedBy.HasValue)
            return BadRequest(new { message = "ManagedBy is required." });

        if (req.EndDate.Value < req.StartDate.Value)
            return BadRequest(new { message = "EndDate cannot be earlier than StartDate." });

        var managerExists = await _repo.UserExistsAsync(req.ManagedBy.Value, ct);
        if (!managerExists)
            return BadRequest(new { message = "ManagedBy user was not found or is disabled." });

        if (req.TeamID.HasValue)
        {
            var teamExists = await _repo.TeamExistsAsync(req.TeamID.Value, ct);
            if (!teamExists)
                return BadRequest(new { message = "Team not found." });
        }

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var now = DateTime.UtcNow;

        var sprint = new Sprint
        {
            SprintName = sprintName,
            Goal = goal,
            StartDate = req.StartDate.Value,
            EndDate = req.EndDate.Value,
            Status = "Planned",
            ManagedBy = req.ManagedBy.Value,
            TeamID = req.TeamID,
            CreatedAt = now,
            UpdatedAt = now
        };

        await _repo.AddAsync(sprint, ct);
        await _repo.SaveChangesAsync(ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "Sprint.Create",
            "Sprint",
            sprint.SprintID,
            true,
            $"SprintName={sprint.SprintName}; Goal={sprint.Goal}; StartDate={sprint.StartDate}; EndDate={sprint.EndDate}; ManagedBy={sprint.ManagedBy}; TeamID={sprint.TeamID}",
            ip,
            ct
        );

        var resp = new SprintCreatedResponseDto
        {
            SprintID = sprint.SprintID,
            SprintName = sprint.SprintName,
            Goal = sprint.Goal ?? "",
            StartDate = sprint.StartDate,
            EndDate = sprint.EndDate,
            Status = sprint.Status,
            ManagedBy = sprint.ManagedBy,
            TeamID = sprint.TeamID
        };

        return CreatedAtAction(nameof(GetById), new { id = sprint.SprintID }, resp);
    }

    [HttpGet]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<ActionResult<IEnumerable<object>>> GetAll(CancellationToken ct)
    {
        var sprints = await _repo.GetAllAsync(ct);

        var response = sprints.Select(s => new
        {
            sprintID = s.SprintID,
            sprintName = s.SprintName,
            goal = s.Goal,
            startDate = s.StartDate,
            endDate = s.EndDate,
            status = s.Status,
            managedBy = s.ManagedBy,
            teamID = s.TeamID,
            createdAt = s.CreatedAt,
            updatedAt = s.UpdatedAt
        });

        return Ok(response);
    }

    [HttpGet("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<ActionResult<object>> GetById([FromRoute] int id, CancellationToken ct)
    {
        if (id <= 0)
            return BadRequest(new { message = "SprintID must be greater than 0." });

        var sprint = await _repo.GetByIdAsync(id, ct);
        if (sprint is null)
            return NotFound(new { message = "Sprint not found." });

        return Ok(new
        {
            sprintID = sprint.SprintID,
            sprintName = sprint.SprintName,
            goal = sprint.Goal,
            startDate = sprint.StartDate,
            endDate = sprint.EndDate,
            status = sprint.Status,
            managedBy = sprint.ManagedBy,
            teamID = sprint.TeamID,
            createdAt = sprint.CreatedAt,
            updatedAt = sprint.UpdatedAt
        });
    }

    [HttpPut("{id:int}/start")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> Start([FromRoute] int id, CancellationToken ct)
    {
        var sprint = await _repo.GetByIdAsync(id, ct);
        if (sprint is null)
            return NotFound(new { message = "Sprint not found." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        if (!CanManageSprint(userId.Value, sprint.ManagedBy))
            return Forbid();

        if (sprint.Status == "Active")
            return BadRequest(new { message = "Sprint is already active." });

        if (sprint.Status == "Completed")
            return BadRequest(new { message = "Completed sprint cannot be started." });

        var hasWorkItems = await _repo.HasAnyWorkItemsAsync(id, ct);
        if (!hasWorkItems)
        {
            return Conflict(new
            {
                message = "Sprint cannot be started because it has no work items."
            });
        }

        var workItemsMissingAssignee = await _repo.GetSprintWorkItemsMissingAssigneeAsync(id, ct);
        if (workItemsMissingAssignee.Count > 0)
        {
            var unassignedWorkItems = workItemsMissingAssignee
                .Select(w => new
                {
                    w.WorkItemID,
                    Title = w.Title
                })
                .ToList();

            return Conflict(new
            {
                message = "Sprint cannot be started because some work items do not have an assigned user.",
                unassignedWorkItems
            });
        }

        await _repo.StartSprintAsync(id, ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "Sprint.Start",
            "Sprint",
            id,
            true,
            $"Started SprintID={id}; SprintName={sprint.SprintName}",
            ip,
            ct
        );

        var assignedUserIds = await _repo.GetSprintAssignedUserIdsAsync(id, ct);
        var notifications = assignedUserIds.Select(assignedUserId => new Notification
        {
            UserID = assignedUserId,
            RelatedSprintID = id,
            NotificationType = "SprintStarted",
            Message = $"Sprint '{sprint.SprintName}' has started.",
            CreatedAt = DateTime.UtcNow,
            IsRead = false
        });

        await _repo.AddNotificationsAsync(notifications, ct);

        await _hub.Clients.All.SendAsync("SprintStarted", new
        {
            sprintID = id,
            sprintName = sprint.SprintName,
            status = "Active"
        }, ct);

        return Ok(new
        {
            message = "Sprint started successfully.",
            sprintID = id,
            status = "Active"
        });
    }

    [HttpPut("{id:int}/stop")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> Stop(
        [FromRoute] int id,
        [FromBody] SprintLifecycleRequestDto? req,
        CancellationToken ct)
    {
        if (id <= 0)
            return BadRequest(new { message = "SprintID must be greater than 0." });

        req ??= new SprintLifecycleRequestDto();

        var sprint = await _repo.GetTrackedByIdAsync(id, ct);
        if (sprint is null)
            return NotFound(new { message = "Sprint not found." });

        if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Only active sprints can be stopped." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        if (!CanManageSprint(userId.Value, sprint.ManagedBy))
            return Forbid();

        var sprintWorkItems = await _repo.GetTrackedSprintWorkItemsAsync(id, ct);
        var unfinishedCount = sprintWorkItems.Count(w => !string.Equals(w.Status, "Completed", StringComparison.OrdinalIgnoreCase));
        var completedCount = sprintWorkItems.Count(w => string.Equals(w.Status, "Completed", StringComparison.OrdinalIgnoreCase));

        if (unfinishedCount > 0 && !req.Confirm)
        {
            return Conflict(new
            {
                message = "This sprint still has unfinished work items. Confirm to stop the sprint.",
                requiresConfirmation = true,
                unfinishedCount,
                completedCount
            });
        }

        await _repo.StopSprintAsync(sprint, ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "Sprint.Stop",
            "Sprint",
            id,
            true,
            $"Stopped SprintID={id}; SprintName={sprint.SprintName}; UnfinishedCount={unfinishedCount}; CompletedCount={completedCount}",
            ip,
            ct
        );

        var affectedUserIds = sprintWorkItems
            .Where(w => w.AssignedUserID.HasValue)
            .Select(w => w.AssignedUserID!.Value)
            .Distinct()
            .ToList();

        var notifications = affectedUserIds.Select(assignedUserId => new Notification
        {
            UserID = assignedUserId,
            RelatedSprintID = id,
            NotificationType = "SprintStopped",
            Message = $"Sprint '{sprint.SprintName}' has been stopped.",
            CreatedAt = DateTime.UtcNow,
            IsRead = false
        });

        await _repo.AddNotificationsAsync(notifications, ct);

        await _hub.Clients.All.SendAsync("SprintStopped", new
        {
            sprintID = id,
            sprintName = sprint.SprintName,
            unfinishedCount,
            completedCount,
            status = "Planned"
        }, ct);

        return Ok(new
        {
            message = "Sprint stopped successfully.",
            sprintID = id,
            status = "Planned",
            unfinishedCount,
            completedCount
        });
    }

    [HttpPut("{id:int}/complete")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> Complete(
        [FromRoute] int id,
        [FromBody] SprintLifecycleRequestDto? req,
        CancellationToken ct)
    {
        if (id <= 0)
            return BadRequest(new { message = "SprintID must be greater than 0." });

        req ??= new SprintLifecycleRequestDto();

        var sprint = await _repo.GetTrackedByIdAsync(id, ct);
        if (sprint is null)
            return NotFound(new { message = "Sprint not found." });

        if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Only active sprints can be completed." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        if (!CanManageSprint(userId.Value, sprint.ManagedBy))
            return Forbid();

        var sprintWorkItems = await _repo.GetTrackedSprintWorkItemsAsync(id, ct);
        var unfinishedCount = sprintWorkItems.Count(w => !string.Equals(w.Status, "Completed", StringComparison.OrdinalIgnoreCase));
        var completedCount = sprintWorkItems.Count(w => string.Equals(w.Status, "Completed", StringComparison.OrdinalIgnoreCase));

        if (unfinishedCount > 0 && !req.Confirm)
        {
            return Conflict(new
            {
                message = "This sprint still has unfinished work items. Confirm to complete the sprint and return unfinished items to backlog.",
                requiresConfirmation = true,
                unfinishedCount,
                completedCount
            });
        }

        var sprintName = sprint.SprintName;

        var affectedUserIds = sprintWorkItems
            .Where(w => w.AssignedUserID.HasValue)
            .Select(w => w.AssignedUserID!.Value)
            .Distinct()
            .ToList();

        await _repo.CompleteSprintAsync(sprint, sprintWorkItems, ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "Sprint.Complete",
            "Sprint",
            id,
            true,
            $"Completed SprintID={id}; SprintName={sprintName}; ReturnedToBacklogCount={unfinishedCount}; CompletedRecordCount={completedCount}",
            ip,
            ct
        );

        var notifications = affectedUserIds.Select(assignedUserId => new Notification
        {
            UserID = assignedUserId,
            RelatedSprintID = null,
            NotificationType = "SprintCompleted",
            Message = unfinishedCount > 0
                ? $"Sprint '{sprintName}' has been completed. {unfinishedCount} unfinished work item(s) were returned to backlog."
                : $"Sprint '{sprintName}' has been completed.",
            CreatedAt = DateTime.UtcNow,
            IsRead = false
        });

        await _repo.AddNotificationsAsync(notifications, ct);

        await _hub.Clients.All.SendAsync("SprintCompleted", new
        {
            sprintID = id,
            sprintName,
            returnedToBacklogCount = unfinishedCount,
            completedRecordCount = completedCount
        }, ct);

        return Ok(new
        {
            message = "Sprint completed successfully.",
            sprintID = id,
            returnedToBacklogCount = unfinishedCount,
            completedRecordCount = completedCount
        });
    }

    [HttpDelete("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator,Scrum Master,ScrumMaster")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken ct)
    {
        var sprint = await _repo.GetByIdAsync(id, ct);

        if (sprint is null)
            return NotFound(new { message = "Sprint not found." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var returnedToBacklogCount = await _repo.DeleteSprintAndUnassignWorkItemsAsync(id, ct);

        if (returnedToBacklogCount < 0)
            return NotFound(new { message = "Sprint not found." });

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "Sprint.Delete",
            "Sprint",
            id,
            true,
            $"Deleted SprintID={id}; SprintName={sprint.SprintName}; ReturnedToBacklogCount={returnedToBacklogCount}",
            ip,
            ct
        );

        return Ok(new
        {
            message = "Sprint deleted successfully.",
            sprintID = id,
            returnedToBacklogCount
        });
    }

    private bool CanManageSprint(int userId, int? sprintManagedByUserId)
    {
        if (User.IsInRole("Administrator") || User.IsInRole("Scrum Master") || User.IsInRole("ScrumMaster"))
            return true;

        return sprintManagedByUserId.HasValue && sprintManagedByUserId.Value == userId;
    }

    private static int? TryGetUserId(ClaimsPrincipal user)
    {
        var raw =
            user.FindFirstValue(ClaimTypes.NameIdentifier) ??
            user.FindFirstValue("UserID");

        return int.TryParse(raw, out var id) ? id : null;
    }
}