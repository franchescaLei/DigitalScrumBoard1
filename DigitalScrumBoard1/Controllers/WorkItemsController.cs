using DigitalScrumBoard1.DTOs.WorkItems;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class WorkItemsController : ControllerBase
{
    private readonly IWorkItemRepository _repo;

    public WorkItemsController(IWorkItemRepository repo)
    {
        _repo = repo;
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

        // Resolve needed type IDs from WorkItemTypes table
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

        // Validate hierarchy rules
        switch (type)
        {
            case "Epic":
                // Epic cannot be a child
                if (req.ParentWorkItemID is not null)
                    return BadRequest(new { message = "Epic cannot have a parent." });
                break;

            case "Story":
                // Story must have an Epic parent
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
                // Task must have an Epic or Story parent
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

            // Always default at creation (as requested)
            Status = "To-do",

            WorkItemTypeID = workItemTypeId,

            ParentWorkItemID = type == "Epic" ? null : req.ParentWorkItemID,

            // Epic TeamID must start null; others may be null or set
            TeamID = type == "Epic" ? null : req.TeamID,

            AssignedUserID = req.AssignedUserID,

            // Backlog default
            SprintID = null,

            CreatedByUserID = userId.Value,
            CreatedAt = now,
            UpdatedAt = now,
            IsDeleted = false
        };

        await _repo.AddAsync(item, ct);
        await _repo.SaveChangesAsync(ct);

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

    // ✅ NEW: details endpoint for epics (and reusable for any work item)
    // Frontend should call: GET /api/workitems/{id}/details
    [HttpGet("{id:int}/details")]
    [Authorize]
    public async Task<ActionResult<WorkItemDetailsResponseDto>> GetDetails([FromRoute] int id, CancellationToken ct)
    {
        var details = await _repo.GetWorkItemDetailsAsync(id, ct);
        return details is null ? NotFound(new { message = "Work item not found." }) : Ok(details);
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

    private static int? TryGetUserId(ClaimsPrincipal user)
    {
        var raw =
            user.FindFirstValue(ClaimTypes.NameIdentifier) ??
            user.FindFirstValue("UserID");

        return int.TryParse(raw, out var id) ? id : null;
    }

    [HttpGet("parents")]
    [Authorize]
    public async Task<ActionResult<List<object>>> GetParents([FromQuery] string forType, CancellationToken ct)
    {
        var t = NormalizeType(forType);
        if (t is null) return BadRequest(new { message = "Invalid forType." });

        // Need type ids
        var epicTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Epic", ct);
        var storyTypeId = await _repo.GetWorkItemTypeIdByNameAsync("Story", ct);
        if (epicTypeId is null || storyTypeId is null)
            return Problem("WorkItemTypes missing Epic/Story.");

        // Story: parent must be Epic
        // Task: parent can be Epic or Story
        var allowed = t == "Story"
            ? new[] { epicTypeId.Value }
            : new[] { epicTypeId.Value, storyTypeId.Value };

        var parents = await _repo.ListParentsAsync(allowed, ct);

        // return a slim response
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
}