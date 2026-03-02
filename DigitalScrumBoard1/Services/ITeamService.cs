using DigitalScrumBoard1.Dtos;

namespace DigitalScrumBoard1.Services
{
    public interface ITeamService
    {
        Task<object> CreateTeamAsync(CreateTeamRequestDto req, int actorUserId, string ipAddress, CancellationToken ct);
        Task<object?> GetTeamByIdAsync(int id, CancellationToken ct);
    }
}