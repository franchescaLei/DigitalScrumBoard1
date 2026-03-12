using DigitalScrumBoard1.DTOs.Sprints;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Repositories;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class SprintsController : ControllerBase
{
    private readonly ISprintRepository _repo;
    private readonly IAuditService _audit;

    public SprintsController(ISprintRepository repo, IAuditService audit)
    {
        _repo = repo;
        _audit = audit;
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

    [HttpGet("{id:int}")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth")]
    public ActionResult<object> GetById([FromRoute] int id)
    {
        return Ok(new { message = "Sprint created. Detailed sprint retrieval can be added next.", id });
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

        return Ok(new
        {
            message = "Sprint started successfully.",
            sprintID = id,
            status = "Active"
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