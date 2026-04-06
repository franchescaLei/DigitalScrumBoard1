using DigitalScrumBoard1.DTOs.WorkItems;
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
public sealed class WorkItemsController : ControllerBase
{
    private readonly IWorkItemRepository _repo;
    private readonly IAuditService _audit;
    private readonly IHubContext<BoardHub> _hub;
    private readonly INotificationService _notifications;

    public WorkItemsController(
        IWorkItemRepository repo,
        IAuditService audit,
        IHubContext<BoardHub> hub,
        INotificationService notifications)
    {
        _repo = repo;
        _audit = audit;
        _hub = hub;
        _notifications = notifications;
    }

    [HttpPost]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator,Scrum Master,ScrumMaster")]
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
        var priority = NormalizePriority(req.Priority);
        if (title.Length == 0) return BadRequest(new { message = "Title is required." });
        if (desc.Length == 0) return BadRequest(new { message = "Description is required." });
        if (priority is null) return BadRequest(new { message = "Invalid Priority. Allowed: Low, Medium, High, Critical." });

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

                if (req.DueDate.HasValue && taskParent.Value.WorkItemTypeID == storyTypeId.Value)
                {
                    var storyDueDate = taskParent.Value.DueDate;
                    if (storyDueDate.HasValue && req.DueDate.Value > storyDueDate.Value)
                        return BadRequest(new { message = $"Task due date cannot be later than its parent story's due date ({storyDueDate.Value})." });
                }

                break;
        }

        if (req.TeamID.HasValue)
        {
            var teamExists = await _repo.TeamExistsAsync(req.TeamID.Value, ct);
            if (!teamExists)
                return BadRequest(new { message = "Team not found." });
        }

        if (req.AssignedUserID.HasValue)
        {
            var assigneeExists = await _repo.UserExistsAsync(req.AssignedUserID.Value, ct);
            if (!assigneeExists)
                return BadRequest(new { message = "Assigned user not found." });
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
            DueDate = req.DueDate,
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

        if (item.AssignedUserID.HasValue && item.AssignedUserID.Value != userId.Value)
        {
            await _notifications.AddNotificationsAsync(new[]
            {
                new Notification
                {
                    UserID = item.AssignedUserID.Value,
                    NotificationType = "WorkItemAssigned",
                    Message = $"You were assigned to work item '{item.Title}'.",
                    RelatedWorkItemID = item.WorkItemID,
                    CreatedAt = now,
                    IsRead = false
                }
            }, ct);
        }

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

        // Broadcast work item creation to all clients (for backlog/epic views)
        await _hub.Clients.All.SendAsync("WorkItemCreated", new
        {
            workItem = resp,
            createdAt = item.CreatedAt
        }, ct);

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

    [HttpGet("{id:int}/comments")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<ActionResult<List<WorkItemCommentDto>>> GetComments([FromRoute] int id, CancellationToken ct)
    {
        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Cannot access comments of a deleted work item." });

        var comments = await _repo.GetCommentsAsync(id, ct);
        return Ok(comments);
    }

    [HttpPost("{id:int}/comments")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public async Task<ActionResult<WorkItemCommentDto>> AddComment(
        [FromRoute] int id,
        [FromBody] CreateWorkItemCommentRequestDto req,
        CancellationToken ct)
    {
        if (!ModelState.IsValid)
            return ValidationProblem(ModelState);

        if (req is null || string.IsNullOrWhiteSpace(req.CommentText))
            return BadRequest(new { message = "CommentText is required." });

        var userId = TryGetUserId(User);
        if (userId is null)
            return Unauthorized(new { message = "Missing/invalid user identity." });

        var itemInfo = await _repo.GetWorkItemTypeInfoByIdAsync(id, ct);
        if (itemInfo is null)
            return NotFound(new { message = "Work item not found." });

        if (itemInfo.Value.IsDeleted)
            return BadRequest(new { message = "Cannot comment on a deleted work item." });

        var workItem = await _repo.GetTrackedByIdAsync(id, ct);
        if (workItem is null)
            return NotFound(new { message = "Work item not found." });

        int? sprintManagerId = null;
        var canComment = CanManageWorkItem(userId.Value, workItem.AssignedUserID);

        if (!canComment && workItem.SprintID.HasValue)
        {
            var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
            sprintManagerId = sprint?.ManagedBy;
            canComment = sprint is not null && CanManageSprint(userId.Value, sprint.ManagedBy);
        }
        else if (workItem.SprintID.HasValue)
        {
            sprintManagerId = await _repo.GetSprintManagerUserIdAsync(workItem.SprintID.Value, ct);
        }

        if (!canComment)
            return Forbid();

        var text = req.CommentText.Trim();
        if (text.Length == 0)
            return BadRequest(new { message = "CommentText cannot be empty." });

        var now = DateTime.UtcNow;

        var comment = new WorkItemComment
        {
            WorkItemID = workItem.WorkItemID,
            CommentedBy = userId.Value,
            CommentText = text,
            CreatedAt = now,
            UpdatedAt = now,
            IsDeleted = false
        };

        await _repo.AddCommentAsync(comment, ct);

        var relatedUserIds = BuildRelatedUserIds(
            workItem,
            sprintManagerId,
            userId.Value,
            null);

        var commentNotifications = relatedUserIds
            .Select(targetUserId => new Notification
            {
                UserID = targetUserId,
                Message = $"A new comment was added to work item '{workItem.Title}'.",
                NotificationType = "WorkItemCommentAdded",
                RelatedWorkItemID = workItem.WorkItemID,
                RelatedSprintID = workItem.SprintID,
                CreatedAt = now,
                IsRead = false
            })
            .ToList();

        if (commentNotifications.Count > 0)
            await _notifications.AddNotificationsAsync(commentNotifications, ct);
        else
            await _repo.SaveChangesAsync(ct);

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _audit.LogAsync(
            userId.Value,
            "WorkItem.Comment",
            "WorkItem",
            workItem.WorkItemID,
            true,
            $"Added comment to WorkItemID={workItem.WorkItemID}; CommentID={comment.CommentID}",
            ip,
            ct
        );

        var comments = await _repo.GetCommentsAsync(workItem.WorkItemID, ct);
        var created = comments.FirstOrDefault(c => c.CommentID == comment.CommentID);

        if (created is null)
        {
            created = new WorkItemCommentDto
            {
                CommentID = comment.CommentID,
                WorkItemID = comment.WorkItemID,
                CommentedBy = comment.CommentedBy,
                CommentedByName = string.Empty,
                CommentText = comment.CommentText,
                CreatedAt = comment.CreatedAt,
                UpdatedAt = comment.UpdatedAt
            };
        }

        if (workItem.SprintID.HasValue)
        {
            await _hub.Clients
                .Group($"sprint-{workItem.SprintID.Value}")
                .SendAsync("WorkItemCommentAdded", new
                {
                    sprintID = workItem.SprintID.Value,
                    workItemID = workItem.WorkItemID,
                    comment = created
                }, ct);
        }
        else
        {
            await _hub.Clients.All.SendAsync("WorkItemCommentAdded", new
            {
                sprintID = (int?)null,
                workItemID = workItem.WorkItemID,
                comment = created
            }, ct);
        }

        return Ok(created);
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
        var resp = parents.Select(p => new { p.WorkItemID, p.Title, Type = p.TypeName, p.DueDate }).ToList();
        return Ok(resp);
    }

    [HttpGet("epics")]
    [Authorize]
    public async Task<ActionResult<List<EpicTileDto>>> GetEpicTiles(
        [FromQuery] string? search,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection,
        CancellationToken ct = default)
    {
        var result = await _repo.GetEpicTilesFilteredAsync(search, sortBy, sortDirection, ct);
        return Ok(result);
    }

    [HttpGet("stories/by-epic")]
    [Authorize]
    public async Task<ActionResult<List<WorkItemDto>>> GetStoriesByEpicId(
        [FromQuery] int epicId,
        CancellationToken ct = default)
    {
        if (epicId <= 0)
            return BadRequest(new { message = "EpicID is required." });

        var result = await _repo.GetWorkItemsByParentIdAsync(epicId, "Story", ct);
        return Ok(result);
    }

    [HttpGet("tasks/by-parent")]
    [Authorize]
    public async Task<ActionResult<List<WorkItemDto>>> GetTasksByParentId(
        [FromQuery] int parentId,
        CancellationToken ct = default)
    {
        if (parentId <= 0)
            return BadRequest(new { message = "ParentID is required." });

        var result = await _repo.GetWorkItemsByParentIdAsync(parentId, "Task", ct);
        return Ok(result);
    }

    [HttpGet("backlog")]
    [Authorize]
    public async Task<ActionResult<List<AgendaWorkItemDto>>> GetBacklogItems(
        CancellationToken ct = default)
    {
        var result = await _repo.GetBacklogItemsAsync(ct);
        return Ok(result);
    }

    [HttpGet("agendas")]
    [Authorize]
    public async Task<ActionResult<AgendasResponseDto>> GetAgendas(
        [FromQuery] string? status,
        [FromQuery] string? priority,
        [FromQuery] string? workItemType,
        [FromQuery] int? teamId,
        [FromQuery] int? assigneeId,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection,
        CancellationToken ct = default)
    {
        var result = await _repo.GetAgendasFilteredAsync(
            status,
            priority,
            workItemType,
            teamId,
            assigneeId,
            sortBy,
            sortDirection,
            ct);
        return Ok(result);
    }

    /// <summary>
    /// Gets all work items assigned to a specific sprint (excluding Completed items).
    /// For sprint planning in Backlogs page.
    /// </summary>
    [HttpGet("sprint/{sprintId:int}")]
    [Authorize]
    public async Task<ActionResult<List<WorkItemDto>>> GetSprintWorkItems(
        [FromRoute] int sprintId,
        CancellationToken ct)
    {
        if (sprintId <= 0)
            return BadRequest(new { message = "SprintID must be greater than 0." });

        var workItems = await _repo.GetWorkItemsBySprintIdAsync(sprintId, ct);
        
        // Exclude Completed items for planning view
        var filtered = workItems
            .Where(w => !string.Equals(w.Status, "Completed", StringComparison.OrdinalIgnoreCase))
            .Select(w => new WorkItemDto
            {
                WorkItemID = w.WorkItemID,
                Title = w.Title,
                Description = w.Description,
                Status = w.Status,
                Priority = w.Priority,
                DueDate = w.DueDate,
                AssignedUserID = w.AssignedUserID,
                ParentWorkItemID = w.ParentWorkItemID,
                TeamID = w.TeamID,
                SprintID = w.SprintID,
                CreatedAt = w.CreatedAt,
                UpdatedAt = w.UpdatedAt
            })
            .ToList();

        return Ok(filtered);
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

        var workItem = await _repo.GetTrackedByIdAsync(id, ct);
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

        if (workItem.AssignedUserID.HasValue && workItem.AssignedUserID.Value != userId.Value)
        {
            await _notifications.AddNotificationsAsync(new[]
            {
                new Notification
                {
                    UserID = workItem.AssignedUserID.Value,
                    RelatedWorkItemID = workItem.WorkItemID,
                    RelatedSprintID = req.SprintID,
                    NotificationType = "WorkItemAssignedToSprint",
                    Message = $"Work item '{workItem.Title}' was added to sprint '{sprint.SprintName}'.",
                    CreatedAt = DateTime.UtcNow,
                    IsRead = false
                }
            }, ct);
        }

        // Broadcast sprint assignment to ALL clients for real-time backlog/sprint list updates
        await _hub.Clients.All.SendAsync("WorkItemAssignedToSprint", new
        {
            workItemID = workItem.WorkItemID,
            title = workItem.Title,
            status = workItem.Status,
            assignedUserID = workItem.AssignedUserID,
            sprintID = req.SprintID,
            sprintName = sprint.SprintName,
            changedAt = DateTime.UtcNow
        }, ct);

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

        var workItem = await _repo.GetTrackedByIdAsync(id, ct);
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

        if (workItem.AssignedUserID.HasValue && workItem.AssignedUserID.Value != userId.Value)
        {
            await _notifications.AddNotificationsAsync(new[]
            {
                new Notification
                {
                    UserID = workItem.AssignedUserID.Value,
                    RelatedWorkItemID = workItem.WorkItemID,
                    NotificationType = "WorkItemRemovedFromSprint",
                    Message = $"Work item '{workItem.Title}' was removed from sprint '{sprint.SprintName}'.",
                    CreatedAt = DateTime.UtcNow,
                    IsRead = false
                }
            }, ct);
        }

        // Broadcast sprint removal to ALL clients for real-time backlog/sprint list updates
        if (oldSprintId.HasValue)
        {
            await _hub.Clients.All.SendAsync("WorkItemRemovedFromSprint", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                oldSprintID = oldSprintId.Value,
                oldSprintName = sprint.SprintName,
                changedAt = DateTime.UtcNow
            }, ct);
        }

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

        // Broadcast status change to sprint group for real-time board update
        if (workItem.SprintID.HasValue)
        {
            await _hub.Clients.Group($"sprint-{workItem.SprintID.Value}").SendAsync("WorkItemStatusChanged", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                oldStatus,
                newStatus = workItem.Status,
                sprintID = workItem.SprintID.Value,
                changedAt = workItem.UpdatedAt
            }, ct);
        }

        return Ok(new
        {
            message = "Work item status updated successfully.",
            workItemID = workItem.WorkItemID,
            oldStatus,
            status = workItem.Status
        });
    }

    [HttpPatch("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator,Scrum Master,ScrumMaster")]
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

        var isElevated = IsElevatedWorkItemRole();

        int? sprintManagerId = null;
        var isSprintManager = false;

        if (workItem.SprintID.HasValue)
        {
            var sprint = await _repo.GetSprintByIdAsync(workItem.SprintID.Value, ct);
            sprintManagerId = sprint?.ManagedBy;
            isSprintManager = sprint is not null && CanManageSprint(userId.Value, sprint.ManagedBy);
        }

        if (!isElevated && !isSprintManager)
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

        var notifications = new List<Notification>();

        if (oldAssignedUserId != workItem.AssignedUserID && workItem.AssignedUserID.HasValue && workItem.AssignedUserID.Value != userId.Value)
        {
            notifications.Add(new Notification
            {
                UserID = workItem.AssignedUserID.Value,
                Message = $"You were assigned to work item '{workItem.Title}'.",
                NotificationType = "WorkItemAssigned",
                RelatedWorkItemID = workItem.WorkItemID,
                RelatedSprintID = workItem.SprintID,
                CreatedAt = now,
                IsRead = false
            });
        }

        foreach (var targetUserId in relatedUserIds)
        {
            notifications.Add(new Notification
            {
                UserID = targetUserId,
                Message = $"Work item '{workItem.Title}' was updated.",
                NotificationType = "WorkItemUpdated",
                RelatedWorkItemID = workItem.WorkItemID,
                RelatedSprintID = workItem.SprintID,
                CreatedAt = now,
                IsRead = false
            });
        }

        var patchNotifications = notifications
            .GroupBy(x => new { x.UserID, x.NotificationType, x.Message, x.RelatedWorkItemID, x.RelatedSprintID })
            .Select(g => g.First())
            .ToList();

        if (patchNotifications.Count > 0)
            await _notifications.AddNotificationsAsync(patchNotifications, ct);
        else
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

        // Broadcast update to sprint group for real-time board update
        if (workItem.SprintID.HasValue)
        {
            await _hub.Clients.Group($"sprint-{workItem.SprintID.Value}").SendAsync("WorkItemUpdated", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                status = workItem.Status,
                assignedUserID = workItem.AssignedUserID,
                priority = workItem.Priority,
                sprintID = workItem.SprintID.Value,
                changedFields,
                changedAt = workItem.UpdatedAt
            }, ct);
        }
        else
        {
            // For backlog items, broadcast to all (for backlog view updates)
            await _hub.Clients.All.SendAsync("WorkItemUpdated", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                status = workItem.Status,
                assignedUserID = workItem.AssignedUserID,
                priority = workItem.Priority,
                sprintID = (int?)null,
                changedFields,
                changedAt = workItem.UpdatedAt
            }, ct);
        }

        return Ok(new
        {
            message = "Work item updated successfully.",
            workItemID = workItem.WorkItemID
        });
    }

    [HttpDelete("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator,Scrum Master,ScrumMaster")]
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
        workItem.DeletedAt = now;
        workItem.UpdatedAt = now;

        await _repo.AddHistoryAsync(
            BuildHistory(workItem.WorkItemID, "IsDeleted", "false", "true", userId.Value, now),
            ct);

        var relatedUserIds = BuildRelatedUserIds(
            workItem,
            sprintManagerId,
            userId.Value,
            null);

        var archiveNotifications = relatedUserIds
            .Select(targetUserId => new Notification
            {
                UserID = targetUserId,
                Message = $"Work item '{workItem.Title}' was archived.",
                NotificationType = "WorkItemArchived",
                RelatedWorkItemID = workItem.WorkItemID,
                RelatedSprintID = workItem.SprintID,
                CreatedAt = now,
                IsRead = false
            })
            .ToList();

        if (archiveNotifications.Count > 0)
            await _notifications.AddNotificationsAsync(archiveNotifications, ct);
        else
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

        // Broadcast delete to sprint group or all clients for real-time UI update
        if (workItem.SprintID.HasValue)
        {
            await _hub.Clients.Group($"sprint-{workItem.SprintID.Value}").SendAsync("WorkItemDeleted", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                sprintID = workItem.SprintID.Value,
                deletedAt = now
            }, ct);
        }
        else
        {
            await _hub.Clients.All.SendAsync("WorkItemDeleted", new
            {
                workItemID = workItem.WorkItemID,
                title = workItem.Title,
                sprintID = (int?)null,
                deletedAt = now
            }, ct);
        }

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