using System.Net.Mail;
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

        public UserManagementService(DigitalScrumBoardContext db, IAuthEmailService authEmail, IAuditService audit)
        {
            _db = db;
            _authEmail = authEmail;
            _audit = audit;
        }

        public async Task<object> ListUsersAsync(int? teamId, int? roleId, bool? disabled, string? search, int page, int pageSize, CancellationToken ct)
        {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 1;
            if (pageSize > 200) pageSize = 200;

            var q = _db.Users.AsNoTracking();

            if (teamId.HasValue)
                q = q.Where(u => u.TeamID == teamId.Value);

            if (roleId.HasValue)
                q = q.Where(u => u.RoleID == roleId.Value);

            if (disabled.HasValue)
                q = q.Where(u => u.Disabled == disabled.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLowerInvariant();
                q = q.Where(u =>
                    u.EmailAddress.ToLower().Contains(s) ||
                    u.FirstName.ToLower().Contains(s) ||
                    u.LastName.ToLower().Contains(s) ||
                    (u.FirstName + " " + u.LastName).ToLower().Contains(s)
                );
            }

            var total = await q.CountAsync(ct);

            var items = await q
                .OrderByDescending(u => u.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(u => new
                {
                    u.UserID,
                    u.EmailAddress,
                    u.FirstName,
                    u.LastName,
                    u.RoleID,
                    u.TeamID,
                    u.Disabled,
                    u.CreatedAt,
                    u.UpdatedAt,
                    u.MustChangePassword,
                    u.EmailVerified
                })
                .ToListAsync(ct);

            return new { page, pageSize, total, items };
        }

        public async Task<object?> GetUserByIdAsync(int id, CancellationToken ct)
        {
            return await _db.Users
                .AsNoTracking()
                .Where(u => u.UserID == id)
                .Select(u => new
                {
                    u.UserID,
                    u.EmailAddress,
                    u.FirstName,
                    u.LastName,
                    u.RoleID,
                    u.TeamID,
                    u.Disabled,
                    u.CreatedAt,
                    u.UpdatedAt,
                    u.MustChangePassword,
                    u.EmailVerified
                })
                .SingleOrDefaultAsync(ct);
        }

        public async Task<object> CreateUserAsync(CreateUserRequestDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var email = req.EmailAddress.Trim().ToLowerInvariant();

            if (!IsEmailSyntaxValid(email))
                throw new InvalidOperationException("Invalid email address format.");

            var exists = await _db.Users
                .AsNoTracking()
                .AnyAsync(u => u.EmailAddress.ToLower() == email, ct);

            if (exists)
                throw new InvalidOperationException("Email address is already in use.");

            var roleOk = await _db.Roles.AsNoTracking().AnyAsync(r => r.RoleID == req.RoleID, ct);
            if (!roleOk)
                throw new InvalidOperationException("Invalid RoleID.");

            var teamOk = await _db.Teams.AsNoTracking().AnyAsync(t => t.TeamID == req.TeamID, ct);
            if (!teamOk)
                throw new InvalidOperationException("Invalid TeamID.");

            var now = DateTime.UtcNow;
            var temporaryPassword = PasswordGenerator.Generate();

            var user = new User
            {
                FirstName = req.FirstName.Trim(),
                MiddleName = string.IsNullOrWhiteSpace(req.MiddleName) ? null : req.MiddleName.Trim(),
                NameExtension = string.IsNullOrWhiteSpace(req.NameExtension) ? null : req.NameExtension.Trim(),
                LastName = req.LastName.Trim(),
                EmailAddress = email,
                PasswordHash = PasswordHasher.Hash(temporaryPassword),
                RoleID = req.RoleID,
                TeamID = req.TeamID,
                Disabled = false,
                DisabledAt = null,
                LastLogin = null,
                CreatedAt = now,
                UpdatedAt = now,
                MustChangePassword = true,
                EmailVerified = false
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);

            await _authEmail.SendWelcomeAndVerificationAsync(user, temporaryPassword, ct);

            await _audit.LogAsync(actorUserId, "CREATE_USER", "User", user.UserID, true, $"Created user {user.EmailAddress}", ipAddress, ct);
            await _audit.LogAsync(actorUserId, "SEND_VERIFY_EMAIL", "User", user.UserID, true, $"Sent verification email to {user.EmailAddress}", ipAddress, ct);

            return new
            {
                user.UserID,
                user.EmailAddress,
                user.FirstName,
                user.LastName,
                user.RoleID,
                user.TeamID,
                user.Disabled,
                user.CreatedAt,
                mustChangePassword = true,
                emailVerified = false
            };
        }

        public async Task<string> DisableUserAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            if (actorUserId == id)
                return "You cannot disable your own account.";

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return "User not found.";

            if (user.Disabled)
                return "User is already disabled.";

            user.Disabled = true;
            user.DisabledAt = DateTime.UtcNow;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(actorUserId, "DISABLE_USER", "User", user.UserID, true, $"Disabled user {user.EmailAddress}", ipAddress, ct);

            return "User disabled.";
        }

        public async Task<string> EnableUserAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return "User not found.";

            if (!user.Disabled)
                return "User is already enabled.";

            user.Disabled = false;
            user.DisabledAt = null;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(actorUserId, "ENABLE_USER", "User", user.UserID, true, $"Enabled user {user.EmailAddress}", ipAddress, ct);

            return "User enabled.";
        }

        public async Task<object> UpdateAccessAsync(int id, UpdateUserAccessDto req, int actorUserId, string ipAddress, CancellationToken ct)
        {
            if (req.RoleID is null && req.TeamID is null)
                throw new InvalidOperationException("Provide RoleID and/or TeamID.");

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                throw new InvalidOperationException("User not found.");

            if (actorUserId == id && req.RoleID.HasValue)
                throw new InvalidOperationException("You cannot change your own role.");

            if (req.RoleID.HasValue)
            {
                var roleOk = await _db.Roles.AsNoTracking().AnyAsync(r => r.RoleID == req.RoleID.Value, ct);
                if (!roleOk) throw new InvalidOperationException("Invalid RoleID.");
            }

            if (req.TeamID.HasValue)
            {
                var teamOk = await _db.Teams.AsNoTracking().AnyAsync(t => t.TeamID == req.TeamID.Value, ct);
                if (!teamOk) throw new InvalidOperationException("Invalid TeamID.");
            }

            var oldRoleId = user.RoleID;
            var oldTeamId = user.TeamID;

            if (req.RoleID.HasValue) user.RoleID = req.RoleID.Value;
            if (req.TeamID.HasValue) user.TeamID = req.TeamID.Value;

            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            var changes = new List<string>();
            if (req.RoleID.HasValue) changes.Add($"RoleID {oldRoleId} -> {user.RoleID}");
            if (req.TeamID.HasValue) changes.Add($"TeamID {oldTeamId} -> {user.TeamID}");

            await _audit.LogAsync(actorUserId, "UPDATE_USER_ACCESS", "User", user.UserID, true, $"Updated access: {string.Join(", ", changes)}", ipAddress, ct);

            return new
            {
                message = "User access updated.",
                user = new { user.UserID, user.EmailAddress, user.RoleID, user.TeamID, user.UpdatedAt }
            };
        }

        public async Task<string> ResetUserPasswordAsync(int id, int actorUserId, string ipAddress, CancellationToken ct)
        {
            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null) return "User not found.";
            if (user.Disabled) return "Account is disabled.";

            var tempPassword = PasswordGenerator.Generate();

            user.PasswordHash = PasswordHasher.Hash(tempPassword);
            user.MustChangePassword = true;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            // Email temp password (not returned)
            // Reuse welcome format for admin reset message
            // (keeps flow: user receives temp password and must change on login)
            // No extra tokens created here.
            // Send via IEmailSender already inside AuthEmailService? Not needed: simple inline email is fine,
            // but to keep duplication low we keep it here minimal.
            // (Alternatively create a dedicated method in AuthEmailService.)
            // We'll send directly using SMTP? No access here; keep in controller? We'll keep in controller.
            // ✅ We keep service responsible only for DB mutation + audit message.
            await _audit.LogAsync(actorUserId, "RESET_USER_PASSWORD", "User", user.UserID, true, $"Reset password for {user.EmailAddress}", ipAddress, ct);

            return tempPassword;
        }

        private static bool IsEmailSyntaxValid(string email)
        {
            try { _ = new MailAddress(email); return true; }
            catch { return false; }
        }
    }
}