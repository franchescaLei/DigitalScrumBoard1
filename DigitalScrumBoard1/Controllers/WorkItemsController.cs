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

    [HttpPatch("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> Patch(
        [FromRoute] int id,
        [FromBody] UpdateWorkItemRequestDto req,
        CancellationToken ct)
    {
        if (!ModelState.IsValid)
            return ValidationProblem(ModelState);

        if (id <= 0)
            return BadRequest(new { message = "WorkItemID must be greater than 0." });

        if (req is null)
            return BadRequest(new { message = "Request body is required." });

        var hasAnyPatchField =
            req.Title is not null ||
            req.Description is not null ||
            req.Priority is not null ||
            req.ParentWorkItemID.HasValue ||
            req.TeamID.HasValue ||
            req.AssignedUserID.HasValue;

        if (!hasAnyPatchField)
            return BadRequest(new { message = "At least one field must be provided." });

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

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        var requestedRestrictedFieldChange =
            req.ParentWorkItemID.HasValue ||
            req.TeamID.HasValue ||
            req.AssignedUserID.HasValue;

        var isAssignedUser = workItem.AssignedUserID.HasValue && workItem.AssignedUserID.Value == userId.Value;
        var isElevated = IsElevatedWorkItemRole();

        int? sprintManagerId = null;
        var isSprintManager = false;

        if (workItem.SprintID.HasValue)
        {
            var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
            sprintManagerId = sprint?.ManagedBy;
            isSprintManager = sprint is not null && CanManageSprint(userId.Value, sprint.ManagedBy) && !isElevated;
        }

        var canEditSafeFields = isElevated || isAssignedUser || isSprintManager;
        var canEditRestrictedFields = isElevated || isSprintManager;

        if (!canEditSafeFields)
        {
            await _audit.LogAsync(
                userId.Value,
                "WorkItem.Update",
                "WorkItem",
                workItem.WorkItemID,
                false,
                $"Unauthorized update attempt for WorkItemID={workItem.WorkItemID}",
                ip,
                ct);

            return Forbid();
        }

        if (requestedRestrictedFieldChange && !canEditRestrictedFields)
        {
            await _audit.LogAsync(
                userId.Value,
                "WorkItem.Update",
                "WorkItem",
                workItem.WorkItemID,
                false,
                $"Unauthorized restricted-field update attempt for WorkItemID={workItem.WorkItemID}",
                ip,
                ct);

            return Forbid();
        }

        var epicTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Epic", ct);
        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        var taskTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Task", ct);

        if (epicTypeId is null || storyTypeId is null || taskTypeId is null)
            return Problem("WorkItemTypes table is missing Epic/Story/Task entries.");

        var histories = new List<WorkItemHistory>();
        var changedFields = new List<string>();
        var oldAssignedUserId = workItem.AssignedUserID;
        var now = DateTime.UtcNow;

        if (req.Title is not null)
        {
            var newTitle = req.Title.Trim();
            if (newTitle.Length == 0)
                return BadRequest(new { message = "Title cannot be empty." });

            if (!string.Equals(workItem.Title, newTitle, StringComparison.Ordinal))
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "Title", workItem.Title, newTitle, userId.Value, now));
                changedFields.Add($"Title:{workItem.Title}->{newTitle}");
                workItem.Title = newTitle;
            }
        }

        if (req.Description is not null)
        {
            var newDescription = req.Description.Trim();
            if (newDescription.Length == 0)
                return BadRequest(new { message = "Description cannot be empty." });

            if (!string.Equals(workItem.Description ?? "", newDescription, StringComparison.Ordinal))
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "Description", workItem.Description, newDescription, userId.Value, now));
                changedFields.Add("Description:updated");
                workItem.Description = newDescription;
            }
        }

        if (req.Priority is not null)
        {
            var newPriority = NormalizePriority(req.Priority);
            if (newPriority is null)
                return BadRequest(new { message = "Invalid Priority. Allowed: Low, Medium, High, Critical." });

            if (!string.Equals(workItem.Priority, newPriority, StringComparison.Ordinal))
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "Priority", workItem.Priority, newPriority, userId.Value, now));
                changedFields.Add($"Priority:{workItem.Priority}->{newPriority}");
                workItem.Priority = newPriority;
            }
        }

        if (req.TeamID.HasValue)
        {
            if (workItem.WorkItemTypeID == epicTypeId.Value)
                return BadRequest(new { message = "Epic cannot be assigned to a team." });

            var teamExists = await _repo.TeamExistsAsync(req.TeamID.Value, ct);
            if (!teamExists)
                return BadRequest(new { message = "Team not found." });

            if (workItem.TeamID != req.TeamID.Value)
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "TeamID", workItem.TeamID?.ToString(), req.TeamID.Value.ToString(), userId.Value, now));
                changedFields.Add($"TeamID:{workItem.TeamID}->{req.TeamID.Value}");
                workItem.TeamID = req.TeamID.Value;
            }
        }

        if (req.AssignedUserID.HasValue)
        {
            var userExists = await _repo.UserExistsAsync(req.AssignedUserID.Value, ct);
            if (!userExists)
                return BadRequest(new { message = "Assigned user not found." });

            if (workItem.AssignedUserID != req.AssignedUserID.Value)
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "AssignedUserID", workItem.AssignedUserID?.ToString(), req.AssignedUserID.Value.ToString(), userId.Value, now));
                changedFields.Add($"AssignedUserID:{workItem.AssignedUserID}->{req.AssignedUserID.Value}");
                workItem.AssignedUserID = req.AssignedUserID.Value;
            }
        }

        if (req.ParentWorkItemID.HasValue)
        {
            if (req.ParentWorkItemID.Value == workItem.WorkItemID)
                return BadRequest(new { message = "A work item cannot be its own parent." });

            if (workItem.WorkItemTypeID == epicTypeId.Value)
                return BadRequest(new { message = "Epic cannot have a parent." });

            var parentInfo = await _repo.GetWorkItemTypeInfoByIdAsync(req.ParentWorkItemID.Value, ct);
            if (parentInfo is null)
                return BadRequest(new { message = "Parent work item not found." });

            if (parentInfo.Value.IsDeleted)
                return BadRequest(new { message = "Cannot assign a deleted parent work item." });

            if (workItem.WorkItemTypeID == storyTypeId.Value &&
                parentInfo.Value.WorkItemTypeID != epicTypeId.Value)
            {
                return BadRequest(new { message = "Story parent must be an Epic." });
            }

            if (workItem.WorkItemTypeID == taskTypeId.Value &&
                parentInfo.Value.WorkItemTypeID != epicTypeId.Value &&
                parentInfo.Value.WorkItemTypeID != storyTypeId.Value)
            {
                return BadRequest(new { message = "Task parent must be an Epic or Story." });
            }

            if (workItem.ParentWorkItemID != req.ParentWorkItemID.Value)
            {
                histories.Add(BuildHistory(workItem.WorkItemID, "ParentWorkItemID", workItem.ParentWorkItemID?.ToString(), req.ParentWorkItemID.Value.ToString(), userId.Value, now));
                changedFields.Add($"ParentWorkItemID:{workItem.ParentWorkItemID}->{req.ParentWorkItemID.Value}");
                workItem.ParentWorkItemID = req.ParentWorkItemID.Value;
            }
        }

        if (changedFields.Count == 0)
        {
            return Ok(new
            {
                message = "No changes were applied.",
                workItemID = workItem.WorkItemID
            });
        }

        workItem.UpdatedAt = now;

        foreach (var history in histories)
            await _repo.AddHistoryAsync(history, ct);

        var relatedUserIds = BuildRelatedUserIds(
            workItem,
            sprintManagerId,
            userId.Value,
            oldAssignedUserId);

        await _repo.AddNotificationsAsync(
            relatedUserIds.Select(targetUserId => new Notification
            {
                UserID = targetUserId,
                Message = $"Work item '{workItem.Title}' was updated.",
                NotificationType = "WorkItemUpdated",
                RelatedWorkItemID = workItem.WorkItemID,
                CreatedAt = now,
                IsRead = false
            }),
            ct);

        await _repo.SaveChangesAsync(ct);

        await _audit.LogAsync(
            userId.Value,
            "WorkItem.Update",
            "WorkItem",
            workItem.WorkItemID,
            true,
            $"Updated WorkItemID={workItem.WorkItemID}; Changes={string.Join("; ", changedFields)}",
            ip,
            ct);

        return Ok(new
        {
            message = "Work item updated successfully.",
            workItemID = workItem.WorkItemID
        });
    }

    [HttpDelete("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<IActionResult> SoftDelete([FromRoute] int id, CancellationToken ct)
    {
        if (id <= 0)
            return BadRequest(new { message = "WorkItemID must be greater than 0." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Work item is already deleted." });

        var workItem = await _repo.GetTrackedByIdAsync(id, ct);
        if (workItem is null)
            return NotFound(new { message = "Work item not found." });

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        int? sprintManagerId = null;
        var canDelete = CanManageWorkItem(userId.Value, workItem.AssignedUserID);
        if (!canDelete && workItem.SprintID.HasValue)
        {
            var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
            sprintManagerId = sprint?.ManagedBy;
            canDelete = sprint is not null && CanManageSprint(userId.Value, sprint.ManagedBy);
        }
        else if (workItem.SprintID.HasValue)
        {
            sprintManagerId = await _repo.GetSprintManagerUserIdAsync(workItem.SprintID.Value, ct);
        }

        if (!canDelete)
        {
            await _audit.LogAsync(
                userId.Value,
                "WorkItem.Delete",
                "WorkItem",
                workItem.WorkItemID,
                false,
                $"Unauthorized delete attempt for WorkItemID={workItem.WorkItemID}",
                ip,
                ct);

            return Forbid();
        }

        var hasChildren = await _repo.HasActiveChildrenAsync(workItem.WorkItemID, ct);
        if (hasChildren)
            return BadRequest(new { message = "Cannot delete a work item that still has active child work items." });

        var now = DateTime.UtcNow;
        workItem.IsDeleted = true;
        workItem.UpdatedAt = now;

        await _repo.AddHistoryAsync(
            BuildHistory(workItem.WorkItemID, "IsDeleted", "false", "true", userId.Value, now),
            ct);

        var relatedUserIds = BuildRelatedUserIds(
            workItem,
            sprintManagerId,
            userId.Value,
            null);

        await _repo.AddNotificationsAsync(
            relatedUserIds.Select(targetUserId => new Notification
            {
                UserID = targetUserId,
                Message = $"Work item '{workItem.Title}' was archived.",
                NotificationType = "WorkItemArchived",
                RelatedWorkItemID = workItem.WorkItemID,
                CreatedAt = now,
                IsRead = false
            }),
            ct);

        await _repo.SaveChangesAsync(ct);

        await _audit.LogAsync(
            userId.Value,
            "WorkItem.Delete",
            "WorkItem",
            workItem.WorkItemID,
            true,
            $"Soft deleted WorkItemID={workItem.WorkItemID}; Title={workItem.Title}",
            ip,
            ct);

        return Ok(new
        {
            message = "Work item archived successfully.",
            workItemID = workItem.WorkItemID
        });
    }

    private bool CanManageSprint(int userId, int? sprintManagedByUserId)
    {
        if (User.IsInRole("Administrator") || User.IsInRole("Scrum Master") || User.IsInRole("ScrumMaster"))
            return true;

        return sprintManagedByUserId.HasValue && sprintManagedByUserId.Value == userId;
    }

    private bool CanManageWorkItem(int userId, int? assignedUserId)
    {
        if (User.IsInRole("Administrator") || User.IsInRole("Scrum Master") || User.IsInRole("ScrumMaster"))
            return true;

        return assignedUserId.HasValue && assignedUserId.Value == userId;
    }

    private bool IsElevatedWorkItemRole()
    {
        return User.IsInRole("Administrator") ||
               User.IsInRole("Scrum Master") ||
               User.IsInRole("ScrumMaster");
    }

    private static WorkItemHistory BuildHistory(
        int workItemId,
        string fieldChanged,
        string? oldValue,
        string? newValue,
        int changedBy,
        DateTime changedAt)
    {
        return new WorkItemHistory
        {
            WorkItemID = workItemId,
            FieldChanged = fieldChanged,
            OldValue = oldValue,
            NewValue = newValue,
            ChangedAt = changedAt,
            ChangedBy = changedBy
        };
    }

    private static List<int> BuildRelatedUserIds(
        WorkItem workItem,
        int? sprintManagerId,
        int actorUserId,
        int? oldAssignedUserId)
    {
        var ids = new HashSet<int>();

        if (workItem.AssignedUserID.HasValue)
            ids.Add(workItem.AssignedUserID.Value);

        if (oldAssignedUserId.HasValue)
            ids.Add(oldAssignedUserId.Value);

        if (workItem.CreatedByUserID > 0)
            ids.Add(workItem.CreatedByUserID);

        if (sprintManagerId.HasValue)
            ids.Add(sprintManagerId.Value);

        ids.Remove(actorUserId);

        return ids.ToList();
    }

    private static int? TryGetUserId(ClaimsPrincipal user)
    {
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(id, out var parsed) ? parsed : null;
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
            "forchecking" => "For Checking",
            "completed" => "Completed",
            _ => null
        };
    }

    private static string? NormalizePriority(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var p = raw.Trim().ToLowerInvariant();
        return p switch
        {
            "low" => "Low",
            "medium" => "Medium",
            "high" => "High",
            "critical" => "Critical",
            _ => null
        };
    }
}