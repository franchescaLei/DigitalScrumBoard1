using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Models;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Services
{
    public sealed class TeamService : ITeamService
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IAuditService _audit;

        public TeamService(DigitalScrumBoardContext db, IAuditService audit)
        {
            _db = db;
            _audit = audit;
        }

        public async Task<object> CreateTeamAsync(CreateTeamRequestDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var name = req.TeamName.Trim();

            var exists = await _db.Teams
                .AsNoTracking()
                .AnyAsync(t => t.TeamName.ToLower() == name.ToLower(), ct);

            if (exists)
                throw new InvalidOperationException("Team name already exists.");

            var team = new Team
            {
                TeamName = name,
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            _db.Teams.Add(team);
            await _db.SaveChangesAsync(ct);

            await _audit.LogAsync(actorUserId, "CREATE_TEAM", "Team", team.TeamID, true, $"Created team {team.TeamName}", ipAddress, ct);

            return new
            {
                team.TeamID,
                team.TeamName,
                team.Description,
                team.IsActive,
                team.CreatedAt
            };
        }

        public async Task<object?> GetTeamByIdAsync(int id, CancellationToken ct)
        {
            return await _db.Teams
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
        }
    }
}