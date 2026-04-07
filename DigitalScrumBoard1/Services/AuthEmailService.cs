using DigitalScrumBoard1.Utilities;
using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Models;
using DigitalScrumBoard1.Security;
using Microsoft.Extensions.Options;

namespace DigitalScrumBoard1.Services
{
    public sealed class AuthEmailService : IAuthEmailService
    {
        private readonly DigitalScrumBoardContext _db;
        private readonly IEmailSender _emailSender;
        private readonly EmailOptions _emailOptions;

        public AuthEmailService(
            DigitalScrumBoardContext db,
            IEmailSender emailSender,
            IOptions<EmailOptions> emailOptions)
        {
            _db = db;
            _emailSender = emailSender;
            _emailOptions = emailOptions.Value;
        }

        public async Task SendWelcomeAndVerificationAsync(User user, string temporaryPassword, CancellationToken ct)
        {
            var rawToken = EmailVerificationTokenFactory.CreateRawToken();
            var tokenHash = EmailVerificationTokenFactory.HashToken(rawToken);

            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserID = user.UserID,
                TokenHash = tokenHash,
                CreatedAt = DateTimeHelper.Now,
                ExpiresAt = DateTimeHelper.Now.AddHours(24),
                UsedAt = null
            });

            await _db.SaveChangesAsync(ct);

            var baseUrl = (_emailOptions.AppBaseUrl ?? "").TrimEnd('/');
            var link = $"{baseUrl}/api/auth/verify-email?token={Uri.EscapeDataString(rawToken)}";

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
        }

        public async Task SendVerificationAsync(User user, CancellationToken ct)
        {
            var rawToken = EmailVerificationTokenFactory.CreateRawToken();
            var tokenHash = EmailVerificationTokenFactory.HashToken(rawToken);

            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserID = user.UserID,
                TokenHash = tokenHash,
                CreatedAt = DateTimeHelper.Now,
                ExpiresAt = DateTimeHelper.Now.AddHours(24),
                UsedAt = null
            });

            await _db.SaveChangesAsync(ct);

            var baseUrl = (_emailOptions.AppBaseUrl ?? "").TrimEnd('/');
            var link = $"{baseUrl}/api/auth/verify-email?token={Uri.EscapeDataString(rawToken)}";

            await _emailSender.SendAsync(
                user.EmailAddress,
                "Verify your email",
                $"<p>Please verify your email by clicking:</p><p><a href=\"{link}\">Verify Email</a></p>",
                ct
            );
        }

        public async Task SendPasswordResetCodeAsync(User user, string code, int expiresInSeconds, CancellationToken ct)
        {
            await _emailSender.SendAsync(
                user.EmailAddress,
                "Your password reset code",
                $"""
                <p>We received a request to reset your password.</p>
                <p>Your 6-digit password reset code is:</p>
                <h2 style="letter-spacing: 4px;">{System.Net.WebUtility.HtmlEncode(code)}</h2>
                <p>This code expires in {expiresInSeconds} seconds.</p>
                <p>If you did not request this, you may ignore this email.</p>
                """,
                ct
            );
        }
    }
}