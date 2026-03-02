using System.Text;
using DigitalScrumBoard1.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DigitalScrumBoard1.Controllers
{
    [ApiController]
    [Route("api/audit-logs")]
    [Authorize(AuthenticationSchemes = "MyCookieAuth", Roles = "Administrator")]
    public sealed class AuditLogsController : ControllerBase
    {
        private readonly DigitalScrumBoardContext _db;

        public AuditLogsController(DigitalScrumBoardContext db)
        {
            _db = db;
        }

        // GET /api/audit-logs/{id}
        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken ct = default)
        {
            var item = await _db.AuditLogs
                .AsNoTracking()
                .Where(x => x.LogID == id)
                .Select(x => new
                {
                    x.LogID,
                    x.UserID,
                    x.Action,
                    x.Success,
                    x.IPAddress,
                    x.Timestamp,
                    x.TargetType,
                    x.TargetID,
                    x.Details
                })
                .SingleOrDefaultAsync(ct);

            return item is null
                ? NotFound(new { message = "Audit log not found." })
                : Ok(item);
        }

        // GET /api/audit-logs?userId=1&action=LOGIN&success=true&from=2026-01-01&to=2026-01-31&targetType=User&targetId=1&ipAddress=127.0.0.1&page=1&pageSize=50
        [HttpGet]
        public async Task<IActionResult> Get(
            [FromQuery] int? userId,
            [FromQuery] string? action,
            [FromQuery] bool? success,
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,

            // ✅ new filters
            [FromQuery] string? targetType,
            [FromQuery] int? targetId,
            [FromQuery] string? ipAddress,

            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            CancellationToken ct = default)
        {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 1;
            if (pageSize > 200) pageSize = 200; // prevent abuse

            var q = BuildFilteredQuery(userId, action, success, from, to, targetType, targetId, ipAddress);

            var total = await q.CountAsync(ct);

            var items = await q
                .OrderByDescending(x => x.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(x => new
                {
                    x.LogID,
                    x.UserID,
                    x.Action,
                    x.Success,
                    x.IPAddress,
                    x.Timestamp,
                    x.TargetType,
                    x.TargetID,
                    x.Details
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

        // GET /api/audit-logs/export.csv?userId=...&action=...&success=...&from=...&to=...&targetType=...&targetId=...&ipAddress=...
        [HttpGet("export.csv")]
        public async Task<IActionResult> ExportCsv(
            [FromQuery] int? userId,
            [FromQuery] string? action,
            [FromQuery] bool? success,
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] string? targetType,
            [FromQuery] int? targetId,
            [FromQuery] string? ipAddress,
            CancellationToken ct = default)
        {
            // Safety: don't allow huge exports by default
            // You can raise this if needed, but keep a cap.
            const int maxRows = 5000;

            var q = BuildFilteredQuery(userId, action, success, from, to, targetType, targetId, ipAddress);

            var rows = await q
                .OrderByDescending(x => x.Timestamp)
                .Take(maxRows)
                .Select(x => new
                {
                    x.LogID,
                    x.UserID,
                    x.Action,
                    x.Success,
                    x.IPAddress,
                    x.Timestamp,
                    x.TargetType,
                    x.TargetID,
                    x.Details
                })
                .ToListAsync(ct);

            var csv = BuildCsv(rows);

            var fileName = $"audit-logs-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv";
            return File(Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8", fileName);
        }

        private IQueryable<Models.AuditLog> BuildFilteredQuery(
            int? userId,
            string? action,
            bool? success,
            DateTime? from,
            DateTime? to,
            string? targetType,
            int? targetId,
            string? ipAddress)
        {
            var q = _db.AuditLogs.AsNoTracking();

            if (userId.HasValue)
                q = q.Where(x => x.UserID == userId.Value);

            if (!string.IsNullOrWhiteSpace(action))
            {
                var a = action.Trim();
                q = q.Where(x => x.Action == a);
            }

            if (success.HasValue)
                q = q.Where(x => x.Success == success.Value);

            if (from.HasValue)
                q = q.Where(x => x.Timestamp >= from.Value);

            if (to.HasValue)
                q = q.Where(x => x.Timestamp <= to.Value);

            if (!string.IsNullOrWhiteSpace(targetType))
            {
                var tt = targetType.Trim();
                q = q.Where(x => x.TargetType == tt);
            }

            if (targetId.HasValue)
                q = q.Where(x => x.TargetID == targetId.Value);

            if (!string.IsNullOrWhiteSpace(ipAddress))
            {
                var ip = ipAddress.Trim();
                q = q.Where(x => x.IPAddress == ip);
            }

            return q;
        }

        private static string BuildCsv<T>(IEnumerable<T> rows)
        {
            // Minimal CSV writer (safe quoting)
            var props = typeof(T).GetProperties();

            static string Escape(string? s)
            {
                s ??= "";
                var needsQuotes = s.Contains(',') || s.Contains('"') || s.Contains('\n') || s.Contains('\r');
                s = s.Replace("\"", "\"\"");
                return needsQuotes ? $"\"{s}\"" : s;
            }

            var sb = new StringBuilder();

            // header
            sb.AppendLine(string.Join(",", props.Select(p => Escape(p.Name))));

            foreach (var row in rows)
            {
                var values = props.Select(p =>
                {
                    var v = p.GetValue(row);
                    return Escape(v?.ToString());
                });

                sb.AppendLine(string.Join(",", values));
            }

            return sb.ToString();
        }
    }
}