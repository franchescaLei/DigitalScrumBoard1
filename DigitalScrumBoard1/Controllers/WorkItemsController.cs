using DigitalScrumBoard1.DTOs.WorkItems;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class WorkItemsController : ControllerBase
{
    private readonly IWorkItemRepository _repo;
    private readonly IAuditService _audit;

    public WorkItemsController(IWorkItemRepository repo, IAuditService audit)
    {
        _repo = repo;
        _audit = audit;
    }

    [HttpPost]
    [Authorize]
    public async Task<ActionResult<WorkItemCreatedResponseDto>> Create(
        [FromBody] CreateWorkItemRequestDto req,
        CancellationToken ct)
    {
        if (!ModelState.IsValid)
            return ValidationProblem(ModelState);

        var type = NormalizeType(req.Type);
        if (type is null)
            return BadRequest(new { message = "Invalid Type. Allowed: Epic, Story, Task." });

        var title = (req.Title ?? "").Trim();
        var desc = (req.Description ?? "").Trim();
        var priority = (req.Priority ?? "").Trim();

        if (title.Length == 0) return BadRequest(new { message = "Title is required." });
        if (desc.Length == 0) return BadRequest(new { message = "Description is required." });
        if (priority.Length == 0) return BadRequest(new { message = "Priority is required." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var epicTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Epic", ct);
        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        var taskTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Task", ct);

        if (epicTypeId is null || storyTypeId is null || taskTypeId is null)
            return Problem("WorkItemTypes table is missing Epic/Story/Task entries.");

        int workItemTypeId = type switch
        {
            "Epic" => epicTypeId.Value,
            "Story" => storyTypeId.Value,
            "Task" => taskTypeId.Value,
            _ => throw new InvalidOperationException()
        };

        switch (type)
        {
            case "Epic":
                if (req.ParentWorkItemID is not null)
                    return BadRequest(new { message = "Epic cannot have a parent." });
                break;

            case "Story":
                if (req.ParentWorkItemID is null)
                    return BadRequest(new { message = "Story requires ParentWorkItemID (Epic)." });

                var storyParent = await _repo.GetWorkItemTypeInfoByIdAsync(req.ParentWorkItemID.Value, ct);
                if (storyParent is null)
                    return BadRequest(new { message = "Parent work item not found." });

                if (storyParent.Value.IsDeleted)
                    return BadRequest(new { message = "Cannot create under a deleted parent work item." });

                if (storyParent.Value.WorkItemTypeID != epicTypeId.Value)
                    return BadRequest(new { message = "Story parent must be an Epic." });

                break;

            case "Task":
                if (req.ParentWorkItemID is null)
                    return BadRequest(new { message = "Task requires ParentWorkItemID (Epic or Story)." });

                var taskParent = await _repo.GetWorkItemTypeInfoByIdAsync(req.ParentWorkItemID.Value, ct);
                if (taskParent is null)
                    return BadRequest(new { message = "Parent work item not found." });

                if (taskParent.Value.IsDeleted)
                    return BadRequest(new { message = "Cannot create under a deleted parent work item." });

                var parentType = taskParent.Value.WorkItemTypeID;
                if (parentType != epicTypeId.Value && parentType != storyTypeId.Value)
                    return BadRequest(new { message = "Task parent must be an Epic or Story." });

                break;
        }

        var now = DateTime.UtcNow;

        var item = new WorkItem
        {
            Title = title,
            Description = desc,
            Priority = priority,
            Status = "To-do",
            WorkItemTypeID = workItemTypeId,
            ParentWorkItemID = type == "Epic" ? null : req.ParentWorkItemID,
            TeamID = type == "Epic" ? null : req.TeamID,
            AssignedUserID = req.AssignedUserID,
            SprintID = null,
            CreatedByUserID = userId.Value,
            CreatedAt = now,
            UpdatedAt = now,
            IsDeleted = false
        };

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        var audit = new AuditLog
        {
            UserID = userId.Value,
            Action = "WorkItem.Create",
            IPAddress = ip,
            Timestamp = now,
            Success = true,
            TargetType = "WorkItem",
            TargetID = null,
            Details = $"Type={type}; Title={title}; ParentWorkItemID={item.ParentWorkItemID}; TeamID={item.TeamID}; AssignedUserID={item.AssignedUserID}"
        };

        await _repo.AddWithAuditAsync(item, audit, ct);

        var resp = new WorkItemCreatedResponseDto
        {
            WorkItemID = item.WorkItemID,
            Type = type,
            Title = item.Title,
            Description = item.Description ?? "",
            Priority = item.Priority ?? "",
            Status = item.Status,
            ParentWorkItemID = item.ParentWorkItemID,
            TeamID = item.TeamID,
            AssignedUserID = item.AssignedUserID
        };

        return CreatedAtAction(nameof(GetById), new { id = item.WorkItemID }, resp);
    }

    [HttpGet("{id:int}")]
    [Authorize]
    public async Task<ActionResult<object>> GetById([FromRoute] int id, CancellationToken ct)
    {
        var wi = await _repo.GetByIdAsync(id, ct);
        return wi is null ? NotFound() : Ok(wi);
    }

    [HttpGet("{id:int}/details")]
    [Authorize]
    public async Task<ActionResult<WorkItemDetailsResponseDto>> GetDetails([FromRoute] int id, CancellationToken ct)
    {
        var details = await _repo.GetWorkItemDetailsAsync(id, ct);
        return details is null ? NotFound(new { message = "Work item not found." }) : Ok(details);
    }

    [HttpGet("parents")]
    [Authorize]
    public async Task<ActionResult<List<object>>> GetParents([FromQuery] string forType, CancellationToken ct)
    {
        var t = NormalizeType(forType);
        if (t is null) return BadRequest(new { message = "Invalid forType." });

        var epicTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Epic", ct);
        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        if (epicTypeId is null || storyTypeId is null)
            return Problem("WorkItemTypes missing Epic/Story.");

        var allowed = t == "Story"
            ? new[] { epicTypeId.Value }
            : new[] { epicTypeId.Value, storyTypeId.Value };

        var parents = await _repo.ListParentsAsync(allowed, ct);

        var resp = parents.Select(p => new { p.WorkItemID, p.Title, Type = p.TypeName }).ToList();
        return Ok(resp);
    }

    [HttpGet("epics")]
    [Authorize]
    public async Task<ActionResult<List<EpicTileDto>>> GetEpicTiles(CancellationToken ct)
    {
        var result = await _repo.GetEpicTilesAsync(ct);
        return Ok(result);
    }

    [HttpGet("agendas")]
    [Authorize]
    public async Task<ActionResult<AgendasResponseDto>> GetAgendas(CancellationToken ct)
    {
        var result = await _repo.GetAgendasAsync(ct);
        return Ok(result);
    }

    [HttpPut("{id:int}/assign-sprint")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> AssignToSprint(
        [FromRoute] int id,
        [FromBody] AssignWorkItemToSprintRequestDto req,
        CancellationToken ct)
    {
        if (req.SprintID <= 0)
            return BadRequest(new { message = "SprintID is required." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Cannot assign a deleted work item." });

        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        var taskTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Task", ct);

        if (storyTypeId is null || taskTypeId is null)
            return Problem("WorkItemTypes table is missing Story/Task entries.");

        if (itemInfo.Value.WorkItemTypeID != storyTypeId.Value &&
            itemInfo.Value.WorkItemTypeID != taskTypeId.Value)
        {
            return BadRequest(new { message = "Only Story or Task work items can be assigned to a sprint." });
        }

        var workItem = await _repo.GetByIdAsync(id, ct);
        if (workItem is null)
            return NotFound(new { message = "Work item not found." });

        if (workItem.Status == "Completed")
            return BadRequest(new { message = "Completed work items cannot be assigned to a sprint." });

        var sprint = await _repo.GetSprintByIdAsync(req.SprintID, ct);
        if (sprint is null)
            return BadRequest(new { message = "Sprint not found." });

        if (sprint.Status == "Completed")
            return BadRequest(new { message = "Cannot assign a work item to a completed sprint." });

        if (!CanManageSprint(userId.Value, sprint.ManagedBy))
            return Forbid();

        await _repo.AssignToSprintAsync(workItem, req.SprintID, ct);

        return Ok(new
        {
            message = "Work item assigned to sprint successfully.",
            workItemID = workItem.WorkItemID,
            sprintID = req.SprintID
        });
    }

    [HttpPut("{id:int}/remove-sprint")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> RemoveFromSprint([FromRoute] int id, CancellationToken ct)
    {
        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Cannot modify a deleted work item." });

        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        var taskTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Task", ct);

        if (storyTypeId is null || taskTypeId is null)
            return Problem("WorkItemTypes table is missing Story/Task entries.");

        if (itemInfo.Value.WorkItemTypeID != storyTypeId.Value &&
            itemInfo.Value.WorkItemTypeID != taskTypeId.Value)
        {
            return BadRequest(new { message = "Only Story or Task work items can be removed from a sprint." });
        }

        var workItem = await _repo.GetByIdAsync(id, ct);
        if (workItem is null)
            return NotFound(new { message = "Work item not found." });

        if (!workItem.SprintID.HasValue)
            return BadRequest(new { message = "Work item is not currently assigned to a sprint." });

        var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
        if (sprint is null)
            return BadRequest(new { message = "Sprint not found." });

        if (!CanManageSprint(userId.Value, sprint.ManagedBy))
            return Forbid();

        var oldSprintId = workItem.SprintID;

        await _repo.RemoveFromSprintAsync(workItem, ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "WorkItem.RemoveFromSprint",
            "WorkItem",
            workItem.WorkItemID,
            true,
            $"Removed WorkItemID={workItem.WorkItemID} from SprintID={oldSprintId}",
            ip,
            ct
        );

        return Ok(new
        {
            message = "Work item removed from sprint successfully.",
            workItemID = workItem.WorkItemID
        });
    }

    [HttpPut("{id:int}/status")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> UpdateStatus(
        [FromRoute] int id,
        [FromBody] UpdateWorkItemStatusRequestDto req,
        CancellationToken ct)
    {
        if (req is null || string.IsNullOrWhiteSpace(req.Status))
            return BadRequest(new { message = "Status is required." });

        var newStatus = NormalizeStatus(req.Status);
        if (newStatus is null)
            return BadRequest(new { message = "Invalid Status. Allowed: To-do, Ongoing, For Checking, Completed." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Cannot modify a deleted work item." });

        var workItem = await _repo.GetTrackedByIdAsync(id, ct);
        if (workItem is null)
            return NotFound(new { message = "Work item not found." });

        if (!CanManageWorkItem(userId.Value, workItem.AssignedUserID))
        {
            if (!workItem.SprintID.HasValue)
                return Forbid();

            var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
            if (sprint is null || !CanManageSprint(userId.Value, sprint.ManagedBy))
                return Forbid();
        }

        var oldStatus = workItem.Status;
        if (string.Equals(oldStatus, newStatus, StringComparison.OrdinalIgnoreCase))
        {
            return Ok(new
            {
                message = "Work item status is already set to that value.",
                workItemID = workItem.WorkItemID,
                status = workItem.Status
            });
        }

        workItem.Status = newStatus;
        workItem.UpdatedAt = DateTime.UtcNow;

        await _repo.SaveChangesAsync(ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "WorkItem.StatusChange",
            "WorkItem",
            workItem.WorkItemID,
            true,
            $"Changed WorkItemID={workItem.WorkItemID} status from {oldStatus} to {newStatus}",
            ip,
            ct
        );

        return Ok(new
        {
            message = "Work item status updated successfully.",
            workItemID = workItem.WorkItemID,
            oldStatus,
            status = workItem.Status
        });
    }

    private bool CanManageSprint(int userId, int? sprintManagedByUserId)
    {
        if (User.IsInRole("Administrator") || User.IsInRole("Scrum Master"))
            return true;

        return sprintManagedByUserId.HasValue && sprintManagedByUserId.Value == userId;
    }

    private bool CanManageWorkItem(int userId, int? assignedUserId)
    {
        if (User.IsInRole("Administrator") || User.IsInRole("Scrum Master"))
            return true;

        return assignedUserId.HasValue && assignedUserId.Value == userId;
    }

    private static string? NormalizeType(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var t = raw.Trim().ToLowerInvariant();
        return t switch
        {
            "epic" => "Epic",
            "story" => "Story",
            "task" => "Task",
            _ => null
        };
    }

    private static string? NormalizeStatus(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var s = raw.Trim().ToLowerInvariant();
        return s switch
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

    private static int? TryGetUserId(ClaimsPrincipal user)
    {
        var raw =
            user.FindFirstValue(ClaimTypes.NameIdentifier) ??
            user.FindFirstValue("UserID");

        return int.TryParse(raw, out var id) ? id : null;
    }
}