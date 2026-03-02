using DigitalScrumBoard1.Models;

namespace DigitalScrumBoard1.Services
{
    public interface IAuthEmailService
    {
        Task SendWelcomeAndVerificationAsync(User user, string temporaryPassword, CancellationToken ct);
        Task SendVerificationAsync(User user, CancellationToken ct);
        Task SendPasswordResetAsync(User user, CancellationToken ct);
    }
}