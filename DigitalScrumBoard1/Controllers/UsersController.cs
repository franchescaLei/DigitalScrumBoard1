using DigitalScrumBoard1.Dtos;
using DigitalScrumBoard1.DTOs.Authentication;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/users")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator")]
    public sealed class UsersController : ControllerBase
    {
        private readonly IUserManagementService _users;
        private readonly IEmailSender _emailSender; // used only for admin reset email body
        private readonly IAuditService _audit;       // used to log admin reset email send

        public UsersController(IUserManagementService users, IEmailSender emailSender, IAuditService audit)
        {
            _users = users;
            _emailSender = emailSender;
            _audit = audit;
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
            var result = await _users.ListUsersAsync(teamId, roleId, disabled, search, page, pageSize, ct);
            return Ok(result);
        }

        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken ct)
        {
            var user = await _users.GetUserByIdAsync(id, ct);
            return user is null ? NotFound(new { message = "User not found." }) : Ok(user);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateUserRequestDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var actorId = GetActorUserId() ?? 0;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            try
            {
                var created = await _users.CreateUserAsync(req, actorId, ip, ct);
                return CreatedAtAction(nameof(GetById), new { id = ((dynamic)created).UserID }, created);
            }
            catch (InvalidOperationException ex)
            {
                // Map the old controller responses without changing overall behavior intent
                var msg = ex.Message;

                if (msg.Contains("Invalid email", StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { message = msg });

                if (msg.Contains("already in use", StringComparison.OrdinalIgnoreCase))
                    return Conflict(new { message = msg });

                if (msg.Contains("Invalid RoleID", StringComparison.OrdinalIgnoreCase) ||
                    msg.Contains("Invalid TeamID", StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { message = msg });

                return BadRequest(new { message = msg });
            }
        }

        [HttpPatch("{id:int}/disable")]
        public async Task<IActionResult> Disable([FromRoute] int id, CancellationToken ct)
        {
            var actorId = GetActorUserId() ?? 0;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            var msg = await _users.DisableUserAsync(id, actorId, ip, ct);

            if (msg == "User not found.")
                return NotFound(new { message = msg });

            if (msg == "You cannot disable your own account.")
                return BadRequest(new { message = msg });

            return Ok(new { message = msg });
        }

        [HttpPatch("{id:int}/enable")]
        public async Task<IActionResult> Enable([FromRoute] int id, CancellationToken ct)
        {
            var actorId = GetActorUserId() ?? 0;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            var msg = await _users.EnableUserAsync(id, actorId, ip, ct);

            if (msg == "User not found.")
                return NotFound(new { message = msg });

            return Ok(new { message = msg });
        }

        [HttpPatch("{id:int}/access")]
        public async Task<IActionResult> UpdateAccess([FromRoute] int id, [FromBody] UpdateUserAccessDto req, CancellationToken ct)
        {
            if (!ModelState.IsValid)
                return ValidationProblem(ModelState);

            var actorId = GetActorUserId() ?? 0;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            try
            {
                var result = await _users.UpdateAccessAsync(id, req, actorId, ip, ct);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                var msg = ex.Message;
                if (msg == "User not found.")
                    return NotFound(new { message = msg });

                return BadRequest(new { message = msg });
            }
        }

        [HttpPost("{id:int}/reset-password")]
        public async Task<IActionResult> ResetPasswordAdmin([FromRoute] int id, CancellationToken ct)
        {
            var actorId = GetActorUserId() ?? 0;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            var tempPassword = await _users.ResetUserPasswordAsync(id, actorId, ip, ct);

            if (tempPassword == "User not found.")
                return NotFound(new { message = "User not found." });

            if (tempPassword == "Account is disabled.")
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Account is disabled." });

            // Email temp password (same flow as before: do NOT return via API)
            // NOTE: We need the user email; simplest is: fetch user details via /api/users/{id} if needed,
            // but we keep it internal by sending directly here with minimal change: client will still see Ok message.
            // If you want 100% no extra DB calls, add a dedicated method to the service returning email too.
            // For now, keep behavior: email gets sent.
            //
            // Because the service already updated the hash and logged RESET_USER_PASSWORD, we only send the email here.
            // If email fails, your previous system would throw; we keep same behavior (fail request) to preserve flow.
            //
            // To send, we need email address; the service could return it, but to keep minimal file count:
            // do a small read using GetUserByIdAsync.
            var userObj = await _users.GetUserByIdAsync(id, ct);
            if (userObj is null)
                return NotFound(new { message = "User not found." });

            var email = (string)userObj.GetType().GetProperty("EmailAddress")!.GetValue(userObj)!;

            await _emailSender.SendAsync(
                email,
                "Your password was reset",
                $"""
                <p>Your password has been reset by an administrator.</p>
                <p><b>Temporary password:</b> {System.Net.WebUtility.HtmlEncode(tempPassword)}</p>
                <p>You will be required to change this password after you log in.</p>
                """,
                ct
            );

            await _audit.LogAsync(actorId, "SEND_RESET_PASSWORD_EMAIL", "User", id, true, "Sent admin reset password email.", ip, ct);

            return Ok(new { message = "Password reset email sent." });
        }

        private int? GetActorUserId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(id, out var parsed) ? parsed : null;
        }
    }
}