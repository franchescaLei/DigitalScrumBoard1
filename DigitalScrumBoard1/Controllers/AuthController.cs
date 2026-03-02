using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Security;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Microsoft.Extensions.Options;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public sealed class AuthController : ControllerBase
    {

        private readonly IEmailSender _emailSender;
        private readonly EmailOptions _emailOptions;
        private readonly DigitalScrumBoardContext _db;

        // FR-005 "defined number" (adjust anytime)
        private const int MaxConsecutiveFailedAttempts = 5;
        private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

        public AuthController(
                DigitalScrumBoardContext db,
                IEmailSender emailSender,
                IOptions<EmailOptions> emailOptions)
        {
            _db = db;
            _emailSender = emailSender;
            _emailOptions = emailOptions.Value;
        }

        [HttpPost("login")]
        [AllowAnonymous]
        [EnableRateLimiting("LoginLimiter")]
        public async Task<IActionResult> Login([FromBody] LoginRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var email = req.EmailAddress.Trim().ToLowerInvariant();
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            // Load role for claims and response
            var user = await _db.Users
                .Include(u => u.Role)
                .AsTracking()
                .SingleOrDefaultAsync(u => u.EmailAddress.ToLower() == email, ct);

            // Avoid user enumeration: same response for unknown email or bad password.
            if (user is null)
                return Unauthorized(new { message = "Invalid credentials." });

            if (user.Disabled)
            {
                await WriteAuditAsync(user.UserID, ip, action: "LOGIN", success: false, details: "Account disabled.");
                await _db.SaveChangesAsync(ct);
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });
            }

            var lockout = await GetLockoutInfoAsync(user.UserID, ct);
            if (lockout.IsLocked)
            {
                await WriteAuditAsync(user.UserID, ip, action: "LOGIN", success: false, details: "Account locked out.");
                await _db.SaveChangesAsync(ct);

                return StatusCode(StatusCodes.Status423Locked, new
                {
                    message = "Account locked due to multiple failed login attempts.",
                    retryAfterSeconds = (int)Math.Ceiling(lockout.RetryAfter.TotalSeconds)
                });
            }

            var passwordOk = PasswordHasher.Verify(req.Password, user.PasswordHash);
            if (!passwordOk)
            {
                await WriteAuditAsync(user.UserID, ip, action: "LOGIN", success: false, details: "Invalid credentials.");
                await _db.SaveChangesAsync(ct);
                return Unauthorized(new { message = "Invalid credentials." });
            }

            // Success: build claims and issue cookie
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.UserID.ToString()),
                new(ClaimTypes.Email, user.EmailAddress),
                new(ClaimTypes.Name, $"{user.FirstName} {user.LastName}"),
                new(ClaimTypes.Role, user.Role?.RoleName ?? user.RoleID.ToString())
            };

            var identity = new ClaimsIdentity(claims, "MyCookieAuth");
            var principal = new ClaimsPrincipal(identity);

            await HttpContext.SignInAsync("MyCookieAuth", principal, new AuthenticationProperties
            {
                IsPersistent = true,
                AllowRefresh = true,
                IssuedUtc = DateTimeOffset.UtcNow,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            });

            user.LastLogin = DateTime.UtcNow;
            user.UpdatedAt = DateTime.UtcNow;

            await WriteAuditAsync(user.UserID, ip, action: "LOGIN", success: true, details: "Login success.");
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                message = "Login successful.",
                mustChangePassword = user.MustChangePassword,
                emailVerified = user.EmailVerified,
                user = new AuthUserDto
                {
                    UserID = user.UserID,
                    EmailAddress = user.EmailAddress,
                    FullName = $"{user.FirstName} {user.LastName}",
                    RoleID = user.RoleID,
                    RoleName = user.Role?.RoleName ?? string.Empty,
                    TeamID = user.TeamID
                }
            });
        }

        [HttpPost("logout")]
        [Authorize(AuthenticationSchemes = "MyCookieAuth")]
        public async Task<IActionResult> Logout(CancellationToken ct)
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var userId = GetUserId();

            await HttpContext.SignOutAsync("MyCookieAuth");

            if (userId is not null)
            {
                await WriteAuditAsync(userId.Value, ip, action: "LOGOUT", success: true, details: "Logout.");
                await _db.SaveChangesAsync(ct);
            }

            return Ok(new { message = "Logged out." });
        }

        [HttpGet("me")]
        [Authorize(AuthenticationSchemes = "MyCookieAuth")]
        public async Task<IActionResult> Me(CancellationToken ct)
        {
            var userId = GetUserId();
            if (userId is null)
                return Unauthorized(new { message = "Not authenticated." });

            var user = await _db.Users
                .Include(u => u.Role)
                .AsNoTracking()
                .SingleOrDefaultAsync(u => u.UserID == userId.Value, ct);

            if (user is null)
                return Unauthorized(new { message = "Not authenticated." });

            return Ok(new AuthUserDto
            {
                UserID = user.UserID,
                EmailAddress = user.EmailAddress,
                FullName = $"{user.FirstName} {user.LastName}",
                RoleID = user.RoleID,
                RoleName = user.Role?.RoleName ?? string.Empty,
                TeamID = user.TeamID
            });
        }

        private int? GetUserId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(id, out var parsed) ? parsed : null;
        }

        private async Task<(bool IsLocked, TimeSpan RetryAfter)> GetLockoutInfoAsync(int userId, CancellationToken ct)
        {
            // Consecutive = last N LOGIN attempts are failures
            var recentAttempts = await _db.AuditLogs
                .AsNoTracking()
                .Where(a => a.UserID == userId && a.Action == "LOGIN")
                .OrderByDescending(a => a.Timestamp)
                .Select(a => new { a.Success, a.Timestamp })
                .Take(MaxConsecutiveFailedAttempts)
                .ToListAsync(ct);

            if (recentAttempts.Count < MaxConsecutiveFailedAttempts)
                return (false, TimeSpan.Zero);

            if (recentAttempts.Any(a => a.Success))
                return (false, TimeSpan.Zero);

            var latest = recentAttempts[0].Timestamp;
            var until = latest.Add(LockoutDuration);
            var now = DateTime.UtcNow;

            if (now >= until)
                return (false, TimeSpan.Zero);

            return (true, until - now);
        }

        private Task WriteAuditAsync(int userId, string ip, string action, bool success, string details)
        {
            _db.AuditLogs.Add(new AuditLog
            {
                UserID = userId,
                Action = action,
                IPAddress = ip,
                Timestamp = DateTime.UtcNow,
                Success = success,
                Details = details,
                TargetType = "User",
                TargetID = userId
            });

            // caller does SaveChanges
            return Task.CompletedTask;
        }

        [HttpPost("change-password")]
        [Authorize(AuthenticationSchemes = "MyCookieAuth")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var userId = GetUserId();
            if (userId is null)
                return Unauthorized(new { message = "Not authenticated." });

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == userId.Value, ct);
            if (user is null)
                return Unauthorized(new { message = "Not authenticated." });

            if (user.Disabled)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });

            // ✅ ADD THIS HERE (before hashing)
            if (!PasswordPolicy.IsValid(req.NewPassword))
            {
                return BadRequest(new
                {
                    message = "Password does not meet requirements.",
                    requirements = "At least 8 characters, with uppercase, lowercase, number, and symbol."
                });
            }

            user.PasswordHash = PasswordHasher.Hash(req.NewPassword);
            user.MustChangePassword = false;
            user.UpdatedAt = DateTime.UtcNow;

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await WriteAuditAsync(user.UserID, ip, action: "CHANGE_PASSWORD", success: true, details: "Password changed.");
            await _db.SaveChangesAsync(ct);

            return Ok(new { message = "Password updated." });
        }


        [HttpGet("verify-email")]
        [AllowAnonymous]
        public async Task<IActionResult> VerifyEmail([FromQuery] string token, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(token))
                return BadRequest(new { message = "Token is required." });

            var tokenHash = DigitalScrumBoard1.Security.EmailVerificationTokenFactory.HashToken(token);

            var row = await _db.EmailVerificationTokens
                .Include(t => t.User)
                .AsTracking()
                .Where(t => t.TokenHash == tokenHash)
                .OrderByDescending(t => t.CreatedAt)
                .FirstOrDefaultAsync(ct);

            if (row is null)
                return BadRequest(new { message = "Invalid token." });

            if (row.UsedAt is not null)
                return BadRequest(new { message = "Token already used." });

            if (DateTime.UtcNow > row.ExpiresAt)
                return BadRequest(new { message = "Token expired." });

            row.UsedAt = DateTime.UtcNow;
            row.User.EmailVerified = true;
            row.User.UpdatedAt = DateTime.UtcNow;

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await WriteAuditAsync(row.User.UserID, ip, action: "VERIFY_EMAIL", success: true, details: "Email verified.");
            await _db.SaveChangesAsync(ct);

            return Ok(new { message = "Email verified successfully." });
        }

        [HttpPost("resend-verification")]
        [Authorize(AuthenticationSchemes = "MyCookieAuth")]
        [EnableRateLimiting("LoginLimiter")] // reuse limiter or create a new one
        public async Task<IActionResult> ResendVerification(CancellationToken ct)
        {
            var userId = GetUserId();
            if (userId is null)
                return Unauthorized(new { message = "Not authenticated." });

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.UserID == userId.Value, ct);
            if (user is null)
                return Unauthorized(new { message = "Not authenticated." });

            if (user.EmailVerified)
                return Ok(new { message = "Email is already verified." });

            // Create new token
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

            var baseUrl = (_emailOptions.AppBaseUrl ?? "").TrimEnd('/');
            var link = $"{baseUrl}/api/auth/verify-email?token={Uri.EscapeDataString(rawToken)}";

            await _emailSender.SendAsync(
                user.EmailAddress,
                "Verify your email",
                $"<p>Please verify your email by clicking:</p><p><a href=\"{link}\">Verify Email</a></p>",
                ct
            );

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await WriteAuditAsync(user.UserID, ip, action: "SEND_VERIFY_EMAIL", success: true, details: "Resent verification email.");
            await _db.SaveChangesAsync(ct);

            return Ok(new { message = "Verification email sent." });
        }

        [HttpPost("forgot-password")]
        [AllowAnonymous]
        [EnableRateLimiting("LoginLimiter")] // minimal: reuse existing limiter
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var email = req.EmailAddress.Trim().ToLowerInvariant();

            // Always respond OK to prevent email enumeration
            var genericResponse = Ok(new { message = "If the email exists, a password reset link will be sent." });

            var user = await _db.Users
                .AsTracking()
                .SingleOrDefaultAsync(u => u.EmailAddress.ToLower() == email, ct);

            if (user is null)
                return genericResponse;

            if (user.Disabled)
                return genericResponse;

            // Create token
            var rawToken = EmailVerificationTokenFactory.CreateRawToken();
            var tokenHash = EmailVerificationTokenFactory.HashToken(rawToken);

            _db.PasswordResetTokens.Add(new PasswordResetToken
            {
                UserID = user.UserID,
                TokenHash = tokenHash,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
                UsedAt = null
            });

            // ✅ IMPORTANT: Save FIRST so emailed token always exists in DB
            await _db.SaveChangesAsync(ct);

            var resetBase = (_emailOptions.FrontendBaseUrl ?? "").TrimEnd('/');
            var resetLink = $"{resetBase}/reset-password?token={Uri.EscapeDataString(rawToken)}";

            await _emailSender.SendAsync(
                user.EmailAddress,
                "Reset your password",
                $"""
        <p>We received a request to reset your password.</p>
        <p>Click the link below to set a new password (expires in 30 minutes):</p>
        <p><a href="{resetLink}">Reset Password</a></p>
        <p>If you did not request this, you may ignore this email.</p>
        """,
                ct
            );

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await WriteAuditAsync(user.UserID, ip, action: "FORGOT_PASSWORD", success: true, details: "Password reset email sent.");

            // Save audit log entry
            await _db.SaveChangesAsync(ct);

            return genericResponse;
        }

        [HttpPost("reset-password")]
        [AllowAnonymous]
        [EnableRateLimiting("LoginLimiter")] // minimal: reuse existing limiter
        public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            if (string.IsNullOrWhiteSpace(req.Token))
                return BadRequest(new { message = "Token is required." });

            var tokenHash = EmailVerificationTokenFactory.HashToken(req.Token);

            var row = await _db.PasswordResetTokens
                .Include(t => t.User)
                .AsTracking()
                .Where(t => t.TokenHash == tokenHash)
                .OrderByDescending(t => t.CreatedAt)
                .FirstOrDefaultAsync(ct);

            if (row is null)
                return BadRequest(new { message = "Invalid token." });

            if (row.UsedAt is not null)
                return BadRequest(new { message = "Token already used." });

            if (DateTime.UtcNow > row.ExpiresAt)
                return BadRequest(new { message = "Token expired." });

            if (row.User.Disabled)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });

            // Update password
            row.User.PasswordHash = PasswordHasher.Hash(req.NewPassword);
            row.User.MustChangePassword = false;
            row.User.UpdatedAt = DateTime.UtcNow;

            // Mark token used
            row.UsedAt = DateTime.UtcNow;

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await WriteAuditAsync(row.User.UserID, ip, action: "RESET_PASSWORD", success: true, details: "Password reset successful.");

            await _db.SaveChangesAsync(ct);

            return Ok(new { message = "Password has been reset successfully." });
        }
    }
}