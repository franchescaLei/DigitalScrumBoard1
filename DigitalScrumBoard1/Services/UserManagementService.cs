using System.Security.Cryptography;
using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.DTOs.Authentication;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Security;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Services
{
    public sealed class UserManagementService : IUserManagementService
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IAuthEmailService _authEmail;
        private readonly IAuditService _audit;

        private const int RateLimitStartsAtFailedAttempt = 5;
        private const int AccountLockoutFailedAttempt = 8;
        private static readonly TimeSpan FirstCooldownDuration = TimeSpan.FromMinutes(1);
        private static readonly TimeSpan CooldownStepDuration = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan LockoutDuration = TimeSpan.FromHours(24);

        public UserManagementService(
            DigitalScrumBoardContext db,
            IAuthEmailService authEmail,
            IAuditService audit)
        {
            _db = db;
            _authEmail = authEmail;
            _audit = audit;
        }

        public async Task<object> ListUsersAsync(
            int? teamId,
            int? roleId,
            bool? disabled,
            bool? locked,
            bool? emailVerified,
            string? search,
            string? sortBy,
            string? sortDirection,
            int page,
            int pageSize,
            CancellationToken ct)
        {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 1;
            if (pageSize > 200) pageSize = 200;

            var q = _db.Users
                .AsNoTracking()
                .Include(u => u.Role)
                .Include(u => u.Team)
                .AsQueryable();

            if (teamId.HasValue)
                q = q.Where(u => u.TeamID == teamId.Value);

            if (roleId.HasValue)
                q = q.Where(u => u.RoleID == roleId.Value);

            if (disabled.HasValue)
                q = q.Where(u => u.Disabled == disabled.Value);

            if (emailVerified.HasValue)
                q = q.Where(u => u.EmailVerified == emailVerified.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLowerInvariant();
                q = q.Where(u =>
                    u.EmailAddress.ToLower().Contains(s) ||
                    u.FirstName.ToLower().Contains(s) ||
                    u.LastName.ToLower().Contains(s) ||
                    ((u.FirstName + " " + u.LastName).ToLower().Contains(s)) ||
                    (u.MiddleName != null && u.MiddleName.ToLower().Contains(s)) ||
                    (u.Role.RoleName.ToLower().Contains(s)) ||
                    (u.Team != null && u.Team.TeamName.ToLower().Contains(s)));
            }

            var rows = await q
                .Select(u => new UserAdminRow
                {
                    UserID = u.UserID,
                    FirstName = u.FirstName,
                    MiddleName = u.MiddleName,
                    NameExtension = u.NameExtension,
                    LastName = u.LastName,
                    EmailAddress = u.EmailAddress,
                    RoleID = u.RoleID,
                    RoleName = u.Role.RoleName,
                    TeamID = u.TeamID,
                    TeamName = u.Team != null ? u.Team.TeamName : null,
                    Disabled = u.Disabled,
                    DisabledAt = u.DisabledAt,
                    LastLogin = u.LastLogin,
                    CreatedAt = u.CreatedAt,
                    UpdatedAt = u.UpdatedAt,
                    MustChangePassword = u.MustChangePassword,
                    EmailVerified = u.EmailVerified
                })
                .ToListAsync(ct);

            foreach (var row in rows)
            {
                var authState = await GetAuthAttemptStateAsync(row.UserID, ct);
                row.IsLocked = authState.IsLocked;
                row.LockoutUntilUtc = authState.LockoutUntilUtc;
            }

            if (locked.HasValue)
                rows = rows.Where(x => x.IsLocked == locked.Value).ToList();

            rows = ApplyUserSorting(rows, sortBy, sortDirection);

            var total = rows.Count;

            var items = rows
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(x => new
                {
                    x.UserID,
                    x.FirstName,
                    x.MiddleName,
                    x.NameExtension,
                    x.LastName,
                    x.EmailAddress,
                    x.RoleID,
                    x.RoleName,
                    x.TeamID,
                    x.TeamName,
                    x.Disabled,
                    x.DisabledAt,
                    x.IsLocked,
                    x.LockoutUntilUtc,
                    x.LastLogin,
                    x.CreatedAt,
                    x.UpdatedAt,
                    x.MustChangePassword,
                    x.EmailVerified
                })
                .ToList();

            return new
            {
                page,
                pageSize,
                total,
                items
            };
        }

        public async Task<object?> GetUserByIdAsync(int id, CancellationToken ct)
        {
            if (id <= 0)
                return null;

            var user = await _db.Users
                .AsNoTracking()
                .Include(u => u.Role)
                .Include(u => u.Team)
                .Where(u => u.UserID == id)
                .Select(u => new
                {
                    u.UserID,
                    u.FirstName,
                    u.MiddleName,
                    u.NameExtension,
                    u.LastName,
                    u.EmailAddress,
                    u.RoleID,
                    RoleName = u.Role.RoleName,
                    u.TeamID,
                    TeamName = u.Team != null ? u.Team.TeamName : null,
                    u.Disabled,
                    u.DisabledAt,
                    u.LastLogin,
                    u.CreatedAt,
                    u.UpdatedAt,
                    u.MustChangePassword,
                    u.EmailVerified
                })
                .SingleOrDefaultAsync(ct);

            if (user is null)
                return null;

            var authState = await GetAuthAttemptStateAsync(id, ct);

            return new
            {
                user.UserID,
                user.FirstName,
                user.MiddleName,
                user.NameExtension,
                user.LastName,
                user.EmailAddress,
                user.RoleID,
                user.RoleName,
                user.TeamID,
                user.TeamName,
                user.Disabled,
                user.DisabledAt,
                IsLocked = authState.IsLocked,
                LockoutUntilUtc = authState.LockoutUntilUtc,
                user.LastLogin,
                user.CreatedAt,
                user.UpdatedAt,
                user.MustChangePassword,
                user.EmailVerified
            };
        }

        public async Task<List<object>> GetRolesAsync(CancellationToken ct)
        {
            return await _db.Roles
                .AsNoTracking()
                .OrderBy(r => r.RoleName)
                .Select(r => (object)new
                {
                    r.RoleID,
                    r.RoleName,
                    r.Description
                })
                .ToListAsync(ct);
        }

        public async Task<object> CreateUserAsync(CreateUserRequestDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var firstName = (req.FirstName ?? string.Empty).Trim();
            var middleName = string.IsNullOrWhiteSpace(req.MiddleName) ? null : req.MiddleName.Trim();
            var nameExtension = string.IsNullOrWhiteSpace(req.NameExtension) ? null : req.NameExtension.Trim();
            var lastName = (req.LastName ?? string.Empty).Trim();
            var email = (req.EmailAddress ?? string.Empty).Trim().ToLowerInvariant();

            if (firstName.Length == 0)
                throw new InvalidOperationException("FirstName is required.");

            if (lastName.Length == 0)
                throw new InvalidOperationException("LastName is required.");

            if (email.Length == 0 || !IsValidEmail(email))
                throw new InvalidOperationException("Invalid email address.");

            var role = await _db.Roles
                .AsNoTracking()
                .SingleOrDefaultAsync(r => r.RoleID == req.RoleID, ct);

            if (role is null)
                throw new InvalidOperationException("Invalid RoleID.");

            var team = await _db.Teams
                .AsNoTracking()
                .SingleOrDefaultAsync(t => t.TeamID == req.TeamID && t.IsActive, ct);

            if (team is null)
                throw new InvalidOperationException("Invalid TeamID.");

            var emailExists = await _db.Users
                .AsNoTracking()
                .AnyAsync(u => u.EmailAddress.ToLower() == email, ct);

            if (emailExists)
                throw new InvalidOperationException("Email address is already in use.");

            var temporaryPassword = GenerateTemporaryPassword();
            var now = DateTime.UtcNow;

            var user = new User
            {
                FirstName = firstName,
                MiddleName = middleName,
                NameExtension = nameExtension,
                LastName = lastName,
                EmailAddress = email,
                PasswordHash = PasswordHasher.Hash(temporaryPassword),
                RoleID = req.RoleID,
                TeamID = req.TeamID,
                LastLogin = null,
                CreatedAt = now,
                UpdatedAt = now,
                Disabled = false,
                DisabledAt = null,
                MustChangePassword = true,
                EmailVerified = false
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);

            await _authEmail.SendWelcomeAndVerificationAsync(user, temporaryPassword, ct);

            await _audit.LogAsync(
                actorUserId,
                "CREATE_USER",
                "User",
                user.UserID,
                true,
                $"Created user {user.EmailAddress}; RoleID={user.RoleID}; TeamID={user.TeamID}",
                ipAddress,
                ct);

            return new
            {
                user.UserID,
                user.FirstName,
                user.MiddleName,
                user.NameExtension,
                user.LastName,
                user.EmailAddress,
                user.RoleID,
                RoleName = role.RoleName,
                user.TeamID,
                TeamName = team.TeamName,
                user.Disabled,
                user.CreatedAt,
                user.UpdatedAt,
                user.MustChangePassword,
                user.EmailVerified
            };
        }

        public async Task<string> DisableUserAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var user = await _db.Users.SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return "User not found.";

            if (user.UserID == actorUserId)
                return "You cannot disable your own account.";

            if (user.Disabled)
                return "User account is already disabled.";

            user.Disabled = true;
            user.DisabledAt = DateTime.UtcNow;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await _audit.LogAsync(
                actorUserId,
                "DISABLE_USER",
                "User",
                user.UserID,
                true,
                $"Disabled account for {user.EmailAddress}",
                ipAddress,
                ct);

            return "User account disabled successfully.";
        }

        public async Task<string> EnableUserAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var user = await _db.Users.SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return "User not found.";

            if (!user.Disabled)
                return "User account is already enabled.";

            user.Disabled = false;
            user.DisabledAt = null;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await _audit.LogAsync(
                actorUserId,
                "ENABLE_USER",
                "User",
                user.UserID,
                true,
                $"Enabled account for {user.EmailAddress}",
                ipAddress,
                ct);

            return "User account enabled successfully.";
        }

        public async Task<object> UpdateAccessAsync(int id, UpdateUserAccessDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            if (req is null)
                throw new InvalidOperationException("Request body is required.");

            var hasRole = req.RoleID.HasValue;
            var hasTeam = req.TeamID.HasValue;

            if (!hasRole && !hasTeam)
                throw new InvalidOperationException("At least one of RoleID or TeamID must be provided.");

            var user = await _db.Users
                .Include(u => u.Role)
                .Include(u => u.Team)
                .SingleOrDefaultAsync(u => u.UserID == id, ct);

            if (user is null)
                throw new InvalidOperationException("User not found.");

            if (hasRole && user.UserID == actorUserId)
                throw new InvalidOperationException("You cannot change your own role.");

            var oldRoleId = user.RoleID;
            var oldRoleName = user.Role?.RoleName;
            var oldTeamId = user.TeamID;
            var oldTeamName = user.Team?.TeamName;

            Role? newRole = null;
            Team? newTeam = null;

            if (hasRole)
            {
                newRole = await _db.Roles
                    .AsNoTracking()
                    .SingleOrDefaultAsync(r => r.RoleID == req.RoleID!.Value, ct);

                if (newRole is null)
                    throw new InvalidOperationException("Invalid RoleID.");
            }

            if (hasTeam)
            {
                newTeam = await _db.Teams
                    .AsNoTracking()
                    .SingleOrDefaultAsync(t => t.TeamID == req.TeamID!.Value && t.IsActive, ct);

                if (newTeam is null)
                    throw new InvalidOperationException("Invalid TeamID.");
            }

            var changes = new List<string>();

            if (hasRole && user.RoleID != req.RoleID!.Value)
            {
                user.RoleID = req.RoleID.Value;
                changes.Add($"RoleID:{oldRoleId}->{req.RoleID.Value}");
            }

            if (hasTeam && user.TeamID != req.TeamID!.Value)
            {
                user.TeamID = req.TeamID.Value;
                changes.Add($"TeamID:{oldTeamId}->{req.TeamID.Value}");
            }

            if (changes.Count == 0)
            {
                return new
                {
                    message = "No access changes were applied.",
                    user.UserID,
                    user.EmailAddress,
                    user.RoleID,
                    RoleName = oldRoleName,
                    user.TeamID,
                    TeamName = oldTeamName
                };
            }

            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            var effectiveRoleName = newRole?.RoleName ?? oldRoleName ?? string.Empty;
            var effectiveTeamName = newTeam?.TeamName ?? oldTeamName;

            await _audit.LogAsync(
                actorUserId,
                "UPDATE_USER_ACCESS",
                "User",
                user.UserID,
                true,
                $"Updated access for {user.EmailAddress}; {string.Join("; ", changes)}",
                ipAddress,
                ct);

            return new
            {
                message = "User access updated successfully.",
                user.UserID,
                user.EmailAddress,
                user.RoleID,
                RoleName = effectiveRoleName,
                user.TeamID,
                TeamName = effectiveTeamName
            };
        }

        public async Task<string> ResetUserPasswordAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var user = await _db.Users.SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return "User not found.";

            if (user.Disabled)
                return "Account is disabled.";

            var temporaryPassword = GenerateTemporaryPassword();

            user.PasswordHash = PasswordHasher.Hash(temporaryPassword);
            user.MustChangePassword = true;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await _audit.LogAsync(
                actorUserId,
                "RESET_USER_PASSWORD",
                "User",
                user.UserID,
                true,
                $"Admin reset password for {user.EmailAddress}",
                ipAddress,
                ct);

            return temporaryPassword;
        }

        private static List<UserAdminRow> ApplyUserSorting(
            List<UserAdminRow> rows,
            string? sortBy,
            string? sortDirection)
        {
            var normalizedSortBy = NormalizeSortBy(sortBy);
            var descending = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);

            if (normalizedSortBy is null)
            {
                return rows
                    .OrderByDescending(x => x.CreatedAt)
                    .ToList();
            }

            return normalizedSortBy switch
            {
                "FirstName" => descending
                    ? rows.OrderByDescending(x => x.FirstName).ThenByDescending(x => x.LastName).ToList()
                    : rows.OrderBy(x => x.FirstName).ThenBy(x => x.LastName).ToList(),

                "LastName" => descending
                    ? rows.OrderByDescending(x => x.LastName).ThenByDescending(x => x.FirstName).ToList()
                    : rows.OrderBy(x => x.LastName).ThenBy(x => x.FirstName).ToList(),

                "EmailAddress" => descending
                    ? rows.OrderByDescending(x => x.EmailAddress).ToList()
                    : rows.OrderBy(x => x.EmailAddress).ToList(),

                "CreatedAt" => descending
                    ? rows.OrderByDescending(x => x.CreatedAt).ToList()
                    : rows.OrderBy(x => x.CreatedAt).ToList(),

                "UpdatedAt" => descending
                    ? rows.OrderByDescending(x => x.UpdatedAt).ToList()
                    : rows.OrderBy(x => x.UpdatedAt).ToList(),

                "LastLogin" => descending
                    ? rows.OrderByDescending(x => x.LastLogin.HasValue).ThenByDescending(x => x.LastLogin).ToList()
                    : rows.OrderBy(x => x.LastLogin.HasValue ? 0 : 1).ThenBy(x => x.LastLogin).ToList(),

                "Role" => descending
                    ? rows.OrderByDescending(x => x.RoleName).ThenBy(x => x.LastName).ToList()
                    : rows.OrderBy(x => x.RoleName).ThenBy(x => x.LastName).ToList(),

                "Team" => descending
                    ? rows.OrderByDescending(x => x.TeamName ?? string.Empty).ThenBy(x => x.LastName).ToList()
                    : rows.OrderBy(x => x.TeamName ?? string.Empty).ThenBy(x => x.LastName).ToList(),

                "Disabled" => descending
                    ? rows.OrderByDescending(x => x.Disabled).ThenBy(x => x.LastName).ToList()
                    : rows.OrderBy(x => x.Disabled).ThenBy(x => x.LastName).ToList(),

                "Locked" => descending
                    ? rows.OrderByDescending(x => x.IsLocked).ThenBy(x => x.LastName).ToList()
                    : rows.OrderBy(x => x.IsLocked).ThenBy(x => x.LastName).ToList(),

                _ => rows.OrderByDescending(x => x.CreatedAt).ToList()
            };
        }

        private static string? NormalizeSortBy(string? sortBy)
        {
            if (string.IsNullOrWhiteSpace(sortBy))
                return null;

            return sortBy.Trim() switch
            {
                "FirstName" => "FirstName",
                "LastName" => "LastName",
                "EmailAddress" => "EmailAddress",
                "CreatedAt" => "CreatedAt",
                "UpdatedAt" => "UpdatedAt",
                "LastLogin" => "LastLogin",
                "Role" => "Role",
                "Team" => "Team",
                "Disabled" => "Disabled",
                "Locked" => "Locked",
                _ => null
            };
        }

        private static bool IsValidEmail(string email)
        {
            try
            {
                _ = new System.Net.Mail.MailAddress(email);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string GenerateTemporaryPassword()
        {
            const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
            const string lower = "abcdefghijkmnopqrstuvwxyz";
            const string digits = "23456789";
            const string symbols = "!@#$%^&*";
            var all = upper + lower + digits + symbols;

            var chars = new List<char>
            {
                upper[RandomNumberGenerator.GetInt32(upper.Length)],
                lower[RandomNumberGenerator.GetInt32(lower.Length)],
                digits[RandomNumberGenerator.GetInt32(digits.Length)],
                symbols[RandomNumberGenerator.GetInt32(symbols.Length)]
            };

            while (chars.Count < 12)
                chars.Add(all[RandomNumberGenerator.GetInt32(all.Length)]);

            for (var i = chars.Count - 1; i > 0; i--)
            {
                var j = RandomNumberGenerator.GetInt32(i + 1);
                (chars[i], chars[j]) = (chars[j], chars[i]);
            }

            return new string(chars.ToArray());
        }

        private static TimeSpan GetCooldownDuration(int consecutiveFailedAttempts)
        {
            if (consecutiveFailedAttempts < RateLimitStartsAtFailedAttempt)
                return TimeSpan.Zero;

            var extraSteps = consecutiveFailedAttempts - RateLimitStartsAtFailedAttempt;
            return FirstCooldownDuration + TimeSpan.FromTicks(CooldownStepDuration.Ticks * extraSteps);
        }

        private async Task<(int ConsecutiveFailures, DateTime? LatestFailureUtc)> GetConsecutiveFailedLoginInfoAsync(int userId, CancellationToken ct)
        {
            var attempts = await _db.AuditLogs
                .AsNoTracking()
                .Where(a =>
                    (a.Action == "LOGIN" && a.UserID == userId) ||
                    (a.Action == "UNLOCK_ACCOUNT" && a.TargetType == "User" && a.TargetID == userId && a.Success))
                .OrderByDescending(a => a.Timestamp)
                .Select(a => new
                {
                    a.Action,
                    a.Success,
                    a.Timestamp,
                    IsUnlockEvent = a.Action == "UNLOCK_ACCOUNT"
                })
                .ToListAsync(ct);

            var consecutiveFailures = 0;
            DateTime? latestFailureUtc = null;

            foreach (var attempt in attempts)
            {
                if (attempt.IsUnlockEvent)
                    break;

                if (attempt.Success)
                    break;

                consecutiveFailures++;

                if (latestFailureUtc is null)
                    latestFailureUtc = attempt.Timestamp;
            }

            return (consecutiveFailures, latestFailureUtc);
        }

        private async Task<(bool IsRateLimited, bool IsLocked, TimeSpan RetryAfter, DateTime? LockoutUntilUtc)> GetAuthAttemptStateAsync(int userId, CancellationToken ct)
        {
            var info = await GetConsecutiveFailedLoginInfoAsync(userId, ct);

            if (info.ConsecutiveFailures <= 0 || info.LatestFailureUtc is null)
                return (false, false, TimeSpan.Zero, null);

            var now = DateTime.UtcNow;

            if (info.ConsecutiveFailures >= AccountLockoutFailedAttempt)
            {
                var until = info.LatestFailureUtc.Value.Add(LockoutDuration);
                if (now < until)
                    return (false, true, until - now, until);

                return (false, false, TimeSpan.Zero, null);
            }

            if (info.ConsecutiveFailures >= RateLimitStartsAtFailedAttempt)
            {
                var cooldown = GetCooldownDuration(info.ConsecutiveFailures);
                var until = info.LatestFailureUtc.Value.Add(cooldown);

                if (now < until)
                    return (true, false, until - now, null);
            }

            return (false, false, TimeSpan.Zero, null);
        }

        private sealed class UserAdminRow
        {
            public int UserID { get; set; }
            public string FirstName { get; set; } = string.Empty;
            public string? MiddleName { get; set; }
            public string? NameExtension { get; set; }
            public string LastName { get; set; } = string.Empty;
            public string EmailAddress { get; set; } = string.Empty;
            public int RoleID { get; set; }
            public string RoleName { get; set; } = string.Empty;
            public int? TeamID { get; set; }
            public string? TeamName { get; set; }
            public bool Disabled { get; set; }
            public DateTime? DisabledAt { get; set; }
            public bool IsLocked { get; set; }
            public DateTime? LockoutUntilUtc { get; set; }
            public DateTime? LastLogin { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime UpdatedAt { get; set; }
            public bool MustChangePassword { get; set; }
            public bool EmailVerified { get; set; }
        }
    }
}