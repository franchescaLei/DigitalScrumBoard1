using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/teams")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator")]
    public sealed class TeamsController : ControllerBase
    {
        private readonly DigitalScrumBoardContext _db;

        public TeamsController(DigitalScrumBoardContext db)
        {
            _db = db;
        }

        // POST /api/teams
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateTeamRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var name = req.TeamName.Trim();

            // Prevent duplicates (case-insensitive)
            var exists = await _db.Teams
                .AsNoTracking()
                .AnyAsync(t => t.TeamName.ToLower() == name.ToLower(), ct);

            if (exists)
                return Conflict(new { message = "Team name already exists." });

            var now = DateTime.UtcNow;

            var team = new Team
            {
                TeamName = name,
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                IsActive = true,
                CreatedAt = now
            };

            _db.Teams.Add(team);
            await _db.SaveChangesAsync(ct);

            await WriteAuditAsync(
                actorUserId: GetActorUserId() ?? 0,
                action: "CREATE_TEAM",
                targetId: team.TeamID,
                success: true,
                details: $"Created team {team.TeamName}",
                ct: ct
            );

            return CreatedAtAction(nameof(GetById), new { id = team.TeamID }, new
            {
                team.TeamID,
                team.TeamName,
                team.Description,
                team.IsActive,
                team.CreatedAt
            });
        }

        // Optional but useful for testing: GET /api/teams/{id}
        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken ct)
        {
            var team = await _db.Teams
                .AsNoTracking()
                .Where(t => t.TeamID == id)
                .Select(t => new
                {
                    t.TeamID,
                    t.TeamName,
                    t.Description,
                    t.IsActive,
                    t.CreatedAt
                })
                .SingleOrDefaultAsync(ct);

            return team is null ? NotFound(new { message = "Team not found." }) : Ok(team);
        }

        private int? GetActorUserId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(id, out var parsed) ? parsed : null;
        }

        private async Task WriteAuditAsync(int actorUserId, string action, int targetId, bool success, string details, CancellationToken ct)
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            _db.AuditLogs.Add(new AuditLog
            {
                UserID = actorUserId,
                Action = action,
                IPAddress = ip,
                Timestamp = DateTime.UtcNow,
                Success = success,
                Details = details,
                TargetType = "Team",
                TargetID = targetId
            });

            await _db.SaveChangesAsync(ct);
        }
    }
}