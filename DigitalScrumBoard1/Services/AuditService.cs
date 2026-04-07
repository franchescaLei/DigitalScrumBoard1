using DigitalScrumBoard1.Utilities;
using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Models;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Services
{
    public sealed class AuditService : IAuditService
    {
        private readonly DigitalScrumBoardContext _db;

        public AuditService(DigitalScrumBoardContext db)
        {
            _db = db;
        }

        public async Task LogAsync(
            int actorUserId,
            string action,
            string targetType,
            int targetId,
            bool success,
            string details,
            string ipAddress,
            CancellationToken ct = default)
        {
            _db.AuditLogs.Add(new AuditLog
            {
                UserID = actorUserId,
                Action = action,
                IPAddress = ipAddress,
                Timestamp = DateTimeHelper.Now,
                Success = success,
                Details = details,
                TargetType = targetType,
                TargetID = targetId
            });

            await _db.SaveChangesAsync(ct);
        }
    }
}