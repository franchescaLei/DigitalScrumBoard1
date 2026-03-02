using System.Security.Claims;
using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.Security;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public sealed class AuthController : ControllerBase
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IAuditService _audit;
        private readonly IAuthEmailService _authEmail;

        private const int MaxConsecutiveFailedAttempts = 5;
        private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

        public AuthController(DigitalScrumBoardContext db, IAuditService audit, IAuthEmailService authEmail)
        {
            _db = db;
            _audit = audit;
            _authEmail = authEmail;
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

            var user = await _db.Users
                .Include(u => u.Role)
                .AsTracking()
                .SingleOrDefaultAsync(u => u.EmailAddress.ToLower() == email, ct);

            if (user is null)
                return Unauthorized(new { message = "Invalid credentials." });

            if (user.Disabled)
            {
                await _audit.LogAsync(user.UserID, "LOGIN", "User", user.UserID, false, "Account disabled.", ip, ct);
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });
            }

            var lockout = await GetLockoutInfoAsync(user.UserID, ct);
            if (lockout.IsLocked)
            {
                await _audit.LogAsync(user.UserID, "LOGIN", "User", user.UserID, false, "Account locked out.", ip, ct);

                return StatusCode(StatusCodes.Status423Locked, new
                {
                    message = "Account locked due to multiple failed login attempts.",
                    retryAfterSeconds = (int)Math.Ceiling(lockout.RetryAfter.TotalSeconds)
                });
            }

            var passwordOk = PasswordHasher.Verify(req.Password, user.PasswordHash);
            if (!passwordOk)
            {
                await _audit.LogAsync(user.UserID, "LOGIN", "User", user.UserID, false, "Invalid credentials.", ip, ct);
                return Unauthorized(new { message = "Invalid credentials." });
            }

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
            await _db.SaveChangesAsync(ct);

            await _audit.LogAsync(user.UserID, "LOGIN", "User", user.UserID, true, "Login success.", ip, ct);

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
                await _audit.LogAsync(userId.Value, "LOGOUT", "User", userId.Value, true, "Logout.", ip, ct);

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

            await _db.SaveChangesAsync(ct);

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await _audit.LogAsync(user.UserID, "CHANGE_PASSWORD", "User", user.UserID, true, "Password changed.", ip, ct);

            return Ok(new { message = "Password updated." });
        }

        [HttpGet("verify-email")]
        [AllowAnonymous]
        public async Task<IActionResult> VerifyEmail([FromQuery] string token, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(token))
                return BadRequest(new { message = "Token is required." });

            var tokenHash = EmailVerificationTokenFactory.HashToken(token);

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

            await _db.SaveChangesAsync(ct);

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await _audit.LogAsync(row.User.UserID, "VERIFY_EMAIL", "User", row.User.UserID, true, "Email verified.", ip, ct);

            return Ok(new { message = "Email verified successfully." });
        }

        [HttpPost("resend-verification")]
        [Authorize(AuthenticationSchemes = "MyCookieAuth")]
        [EnableRateLimiting("LoginLimiter")]
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

            await _authEmail.SendVerificationAsync(user, ct);

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await _audit.LogAsync(user.UserID, "SEND_VERIFY_EMAIL", "User", user.UserID, true, "Resent verification email.", ip, ct);

            return Ok(new { message = "Verification email sent." });
        }

        [HttpPost("forgot-password")]
        [AllowAnonymous]
        [EnableRateLimiting("LoginLimiter")]
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var email = req.EmailAddress.Trim().ToLowerInvariant();
            var genericResponse = Ok(new { message = "If the email exists, a password reset link will be sent." });

            var user = await _db.Users.AsTracking().SingleOrDefaultAsync(u => u.EmailAddress.ToLower() == email, ct);
            if (user is null || user.Disabled)
                return genericResponse;

            await _authEmail.SendPasswordResetAsync(user, ct);

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await _audit.LogAsync(user.UserID, "FORGOT_PASSWORD", "User", user.UserID, true, "Password reset email sent.", ip, ct);

            return genericResponse;
        }

        [HttpPost("reset-password")]
        [AllowAnonymous]
        [EnableRateLimiting("LoginLimiter")]
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

            // (kept same flow; if you also want policy here, add PasswordPolicy check)
            row.User.PasswordHash = PasswordHasher.Hash(req.NewPassword);
            row.User.MustChangePassword = false;
            row.User.UpdatedAt = DateTime.UtcNow;
            row.UsedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);

            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await _audit.LogAsync(row.User.UserID, "RESET_PASSWORD", "User", row.User.UserID, true, "Password reset successful.", ip, ct);

            return Ok(new { message = "Password has been reset successfully." });
        }

        private int? GetUserId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(id, out var parsed) ? parsed : null;
        }

        private async Task<(bool IsLocked, TimeSpan RetryAfter)> GetLockoutInfoAsync(int userId, CancellationToken ct)
        {
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
    }
}