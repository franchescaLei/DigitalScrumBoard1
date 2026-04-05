using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Hubs;
using DigitalScrumBoard1.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Services
{
    public sealed class TeamService : ITeamService
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IAuditService _audit;
        private readonly IHubContext<NotificationHub> _hub;

        public TeamService(DigitalScrumBoardContext db, IAuditService audit, IHubContext<NotificationHub> hub)
        {
            _db = db;
            _audit = audit;
            _hub = hub;
        }

        public async Task<object> CreateTeamAsync(CreateTeamRequestDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var name = (req.TeamName ?? string.Empty).Trim();
            if (name.Length == 0)
                throw new InvalidOperationException("Team name is required.");

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

            await _audit.LogAsync(
                actorUserId,
                "CREATE_TEAM",
                "Team",
                team.TeamID,
                true,
                $"Created team {team.TeamName}",
                ipAddress,
                ct);

            await _hub.Clients.Group("admins").SendAsync("AdminDirectoryChanged", new { reason = "teams" }, ct);

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

        public async Task<object> ListTeamsAsync(
            string? search,
            bool? isActive,
            string? sortBy,
            string? sortDirection,
            int page,
            int pageSize,
            CancellationToken ct)
        {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 1;
            if (pageSize > 200) pageSize = 200;

            var q = _db.Teams.AsNoTracking().AsQueryable();

            if (isActive.HasValue)
                q = q.Where(t => t.IsActive == isActive.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLowerInvariant();
                q = q.Where(t =>
                    t.TeamName.ToLower().Contains(s) ||
                    (t.Description != null && t.Description.ToLower().Contains(s)));
            }

            q = ApplyTeamSorting(q, sortBy, sortDirection);

            var total = await q.CountAsync(ct);

            var items = await q
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(t => new
                {
                    t.TeamID,
                    t.TeamName,
                    t.Description,
                    t.IsActive,
                    t.CreatedAt
                })
                .ToListAsync(ct);

            return new
            {
                page,
                pageSize,
                total,
                items
            };
        }

        private static IQueryable<Team> ApplyTeamSorting(
            IQueryable<Team> q,
            string? sortBy,
            string? sortDirection)
        {
            var descending = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);

            return sortBy?.Trim() switch
            {
                "TeamName" => descending ? q.OrderByDescending(t => t.TeamName) : q.OrderBy(t => t.TeamName),
                "CreatedAt" => descending ? q.OrderByDescending(t => t.CreatedAt) : q.OrderBy(t => t.CreatedAt),
                "IsActive" => descending ? q.OrderByDescending(t => t.IsActive).ThenBy(t => t.TeamName) : q.OrderBy(t => t.IsActive).ThenBy(t => t.TeamName),
                _ => q.OrderBy(t => t.TeamName)
            };
        }
    }
}