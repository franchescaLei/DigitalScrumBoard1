using System.Net.Mail;
using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Security;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/users")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator")]
    public sealed class UsersController : ControllerBase
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IEmailSender _emailSender;
        private readonly EmailOptions _emailOptions;

        public UsersController(
            DigitalScrumBoardContext db,
            IEmailSender emailSender,
            IOptions<EmailOptions> emailOptions)
        {
            _db = db;
            _emailSender = emailSender;
            _emailOptions = emailOptions.Value;
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateUserRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var email = req.EmailAddress.Trim().ToLowerInvariant();

            // Extra syntax check (still syntax-only; does not prove inbox exists)
            if (!IsEmailSyntaxValid(email))
                return BadRequest(new { message = "Invalid email address format." });

            // Prevent duplicates (case-insensitive)
            var exists = await _db.Users
                .AsNoTracking()
                .AnyAsync(u => u.EmailAddress.ToLower() == email, ct);

            if (exists)
                return Conflict(new { message = "Email address is already in use." });

            // Validate FK targets (avoid orphan RoleID/TeamID)
            var roleOk = await _db.Roles.AsNoTracking().AnyAsync(r => r.RoleID == req.RoleID, ct);
            if (!roleOk)
                return BadRequest(new { message = "Invalid RoleID." });

            var teamOk = await _db.Teams.AsNoTracking().AnyAsync(t => t.TeamID == req.TeamID, ct);
            if (!teamOk)
                return BadRequest(new { message = "Invalid TeamID." });

            var now = DateTime.UtcNow;

            // Generate a strong temporary password (DO NOT log this)
            var temporaryPassword = PasswordGenerator.Generate();

            var user = new User
            {
                FirstName = req.FirstName.Trim(),
                MiddleName = string.IsNullOrWhiteSpace(req.MiddleName) ? null : req.MiddleName.Trim(),
                NameExtension = string.IsNullOrWhiteSpace(req.NameExtension) ? null : req.NameExtension.Trim(),
                LastName = req.LastName.Trim(),
                EmailAddress = email,

                // Store hash of generated temporary password
                PasswordHash = PasswordHasher.Hash(temporaryPassword),

                RoleID = req.RoleID,
                TeamID = req.TeamID,
                Disabled = false,
                DisabledAt = null,
                LastLogin = null,
                CreatedAt = now,
                UpdatedAt = now,

                // Requires DB column/property in User model
                MustChangePassword = true,

                // Requires DB column/property in User model
                EmailVerified = false
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);

            // Email verification token + send email (after save so we have UserID)
            var rawToken = EmailVerificationTokenFactory.CreateRawToken();
            var tokenHash = EmailVerificationTokenFactory.HashToken(rawToken);

            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserID = user.UserID,
                TokenHash = tokenHash,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddHours(24),
                UsedAt = null
            });
            await _db.SaveChangesAsync(ct);

            var baseUrl = (_emailOptions.AppBaseUrl ?? "").TrimEnd('/');
            var link = $"{baseUrl}/api/auth/verify-email?token={Uri.EscapeDataString(rawToken)}";

            // Send temp password in email (not stored anywhere else)
            await _emailSender.SendAsync(
                user.EmailAddress,
                "Your account details (verify email)",
                $"""
                <p>Your account was created.</p>

                <p><b>Temporary password:</b> {System.Net.WebUtility.HtmlEncode(temporaryPassword)}</p>
                <p>You will be required to change this password after you log in the first time.</p>

                <p>Please verify your email by clicking this link (expires in 24 hours):</p>
                <p><a href="{link}">Verify Email</a></p>

                <p>If you did not expect this email, please contact your administrator.</p>
                """,
                ct
            );

            // Audit: do NOT include token or temp password
            await WriteAuditAsync(
                actorUserId: GetActorUserId() ?? 0,
                action: "CREATE_USER",
                targetId: user.UserID,
                success: true,
                details: $"Created user {user.EmailAddress}"
            );

            await WriteAuditAsync(
                actorUserId: GetActorUserId() ?? 0,
                action: "SEND_VERIFY_EMAIL",
                targetId: user.UserID,
                success: true,
                details: $"Sent verification email to {user.EmailAddress}"
            );

            return CreatedAtAction(nameof(GetById), new { id = user.UserID }, new
            {
                user.UserID,
                user.EmailAddress,
                user.FirstName,
                user.LastName,
                user.RoleID,
                user.TeamID,
                user.Disabled,
                user.CreatedAt,

                // Do NOT return temp password anymore
                mustChangePassword = true,
                emailVerified = false
            });
        }

        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken ct)
        {
            var user = await _db.Users
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

            return user is null ? NotFound(new { message = "User not found." }) : Ok(user);
        }

        private static bool IsEmailSyntaxValid(string email)
        {
            try
            {
                _ = new MailAddress(email);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private int? GetActorUserId()
        {
            var id = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            return int.TryParse(id, out var parsed) ? parsed : null;
        }

        private async Task WriteAuditAsync(int actorUserId, string action, int targetId, bool success, string details)
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
                TargetType = "User",
                TargetID = targetId
            });

            await _db.SaveChangesAsync();
        }


        [HttpPatch("{id:int}/access")]
        public async Task<IActionResult> UpdateAccess([FromRoute] int id, [FromBody] UpdateUserAccessDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            // Nothing provided
            if (req.RoleID is null && req.TeamID is null)
                return BadRequest(new { message = "Provide RoleID and/or TeamID." });

            // Load user
            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return NotFound(new { message = "User not found." });

            // Prevent admin from removing their own admin access accidentally (optional safety)
            var actorId = GetActorUserId();
            if (actorId.HasValue && actorId.Value == id && req.RoleID.HasValue)
            {
                // If you want to allow it, remove this block.
                return BadRequest(new { message = "You cannot change your own role." });
            }

            // Validate new RoleID / TeamID if provided
            if (req.RoleID.HasValue)
            {
                var roleOk = await _db.Roles.AsNoTracking().AnyAsync(r => r.RoleID == req.RoleID.Value, ct);
                if (!roleOk)
                    return BadRequest(new { message = "Invalid RoleID." });
            }

            if (req.TeamID.HasValue)
            {
                var teamOk = await _db.Teams.AsNoTracking().AnyAsync(t => t.TeamID == req.TeamID.Value, ct);
                if (!teamOk)
                    return BadRequest(new { message = "Invalid TeamID." });
            }

            // Track changes for audit detail
            var oldRoleId = user.RoleID;
            var oldTeamId = user.TeamID;

            if (req.RoleID.HasValue) user.RoleID = req.RoleID.Value;
            if (req.TeamID.HasValue) user.TeamID = req.TeamID.Value;

            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            // Audit (don’t include sensitive info)
            var changes = new List<string>();
            if (req.RoleID.HasValue) changes.Add($"RoleID {oldRoleId} -> {user.RoleID}");
            if (req.TeamID.HasValue) changes.Add($"TeamID {oldTeamId} -> {user.TeamID}");

            await WriteAuditAsync(
                actorUserId: actorId ?? 0,
                action: "UPDATE_USER_ACCESS",
                targetId: user.UserID,
                success: true,
                details: $"Updated access: {string.Join(", ", changes)}"
            );

            return Ok(new
            {
                message = "User access updated.",
                user = new
                {
                    user.UserID,
                    user.EmailAddress,
                    user.RoleID,
                    user.TeamID,
                    user.UpdatedAt
                }
            });
        }

        [HttpGet]
        public async Task<IActionResult> List(
    [FromQuery] int? teamId,
    [FromQuery] int? roleId,
    [FromQuery] bool? disabled,
    [FromQuery] string? search,
    [FromQuery] int page = 1,
    [FromQuery] int pageSize = 50,
    CancellationToken ct = default)
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

            return Ok(new
            {
                page,
                pageSize,
                total,
                items
            });
        }

        [HttpPatch("{id:int}/disable")]
        public async Task<IActionResult> Disable([FromRoute] int id, CancellationToken ct)
        {
            var actorId = GetActorUserId();

            // Safety: prevent disabling yourself
            if (actorId.HasValue && actorId.Value == id)
                return BadRequest(new { message = "You cannot disable your own account." });

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return NotFound(new { message = "User not found." });

            if (user.Disabled)
                return Ok(new { message = "User is already disabled." });

            user.Disabled = true;
            user.DisabledAt = DateTime.UtcNow;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await WriteAuditAsync(
                actorUserId: actorId ?? 0,
                action: "DISABLE_USER",
                targetId: user.UserID,
                success: true,
                details: $"Disabled user {user.EmailAddress}"
            );

            return Ok(new { message = "User disabled." });
        }

        [HttpPatch("{id:int}/enable")]
        public async Task<IActionResult> Enable([FromRoute] int id, CancellationToken ct)
        {
            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return NotFound(new { message = "User not found." });

            if (!user.Disabled)
                return Ok(new { message = "User is already enabled." });

            user.Disabled = false;
            user.DisabledAt = null;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await WriteAuditAsync(
                actorUserId: GetActorUserId() ?? 0,
                action: "ENABLE_USER",
                targetId: user.UserID,
                success: true,
                details: $"Enabled user {user.EmailAddress}"
            );

            return Ok(new { message = "User enabled." });
        }

        [HttpPost("{id:int}/reset-password")]
        public async Task<IActionResult> ResetPasswordAdmin([FromRoute] int id, CancellationToken ct)
        {
            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return NotFound(new { message = "User not found." });

            if (user.Disabled)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });

            var tempPassword = PasswordGenerator.Generate();

            user.PasswordHash = PasswordHasher.Hash(tempPassword);
            user.MustChangePassword = true;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await _emailSender.SendAsync(
                user.EmailAddress,
                "Your password was reset",
                $"""
        <p>Your password has been reset by an administrator.</p>
        <p><b>Temporary password:</b> {System.Net.WebUtility.HtmlEncode(tempPassword)}</p>
        <p>You will be required to change this password after you log in.</p>
        """,
                ct
            );

            await WriteAuditAsync(
                actorUserId: GetActorUserId() ?? 0,
                action: "RESET_USER_PASSWORD",
                targetId: user.UserID,
                success: true,
                details: $"Reset password for {user.EmailAddress}"
            );

            return Ok(new { message = "Password reset email sent." });
        }

        [HttpPatch("{id:int}/remove-team")]
        public async Task<IActionResult> RemoveFromTeam([FromRoute] int id, CancellationToken ct)
        {
            var actorId = GetActorUserId();

            // Optional safety: prevent removing yourself from a team
            if (actorId.HasValue && actorId.Value == id)
                return BadRequest(new { message = "You cannot remove your own team assignment." });

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == id, ct);
            if (user is null)
                return NotFound(new { message = "User not found." });

            // Find or create "Unassigned" team (minimal approach; no schema change)
            const string unassignedName = "Unassigned";

            var unassignedTeam = await _db.Teams
                .AsTracking()
                .SingleOrDefaultAsync(t => t.TeamName == unassignedName, ct);

            if (unassignedTeam is null)
            {
                unassignedTeam = new Team
                {
                    TeamName = unassignedName,
                    Description = "System team for users not assigned to any specific team.",
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };

                _db.Teams.Add(unassignedTeam);
                await _db.SaveChangesAsync(ct);

                await WriteAuditAsync(
                    actorUserId: actorId ?? 0,
                    action: "CREATE_TEAM",
                    targetId: unassignedTeam.TeamID,
                    success: true,
                    details: $"Auto-created team {unassignedTeam.TeamName}"
                );
            }

            if (user.TeamID == unassignedTeam.TeamID)
                return Ok(new { message = "User is already not assigned to a team." });

            var oldTeamId = user.TeamID;
            user.TeamID = unassignedTeam.TeamID;
            user.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            await WriteAuditAsync(
                actorUserId: actorId ?? 0,
                action: "REMOVE_USER_FROM_TEAM",
                targetId: user.UserID,
                success: true,
                details: $"TeamID {oldTeamId} -> {user.TeamID}"
            );

            return Ok(new
            {
                message = "User removed from team.",
                user = new { user.UserID, user.EmailAddress, user.TeamID, user.UpdatedAt }
            });
        }
    }
}