using DigitalScrumBoard1.Data;
using DigitalScrumBoard1.Data.Seed;
using DigitalScrumBoard1.Services;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using System.Reflection;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

builder.Services.AddOpenApi(options =>
{
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
});

builder.Services.AddDbContext<DigitalScrumBoardContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddAuthentication("MyCookieAuth")
    .AddCookie("MyCookieAuth", options =>
    {
        options.Cookie.Name = "DigitalScrumBoardAuth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;

        options.LoginPath = "/api/auth/login";
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;

        // REST API: do not redirect; return proper HTTP codes.
        options.Events = new Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationEvents
        {
            OnRedirectToLogin = ctx =>
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            },
            OnRedirectToAccessDenied = ctx =>
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddFixedWindowLimiter("LoginLimiter", limiter =>
    {
        limiter.PermitLimit = 5;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 2;
        limiter.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
    });
});

// Email options + sender
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.AddScoped<IEmailSender, SmtpEmailSender>();

// ✅ New services (refactor)
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<IAuthEmailService, AuthEmailService>();
builder.Services.AddScoped<IUserManagementService, UserManagementService>();
builder.Services.AddScoped<ITeamService, TeamService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseRateLimiter();
app.UseHttpsRedirection();
app.UseAuthentication();

app.Use(async (context, next) =>
{
    // Not logged in? Let normal auth/authorize handle it
    if (context.User?.Identity?.IsAuthenticated != true)
    {
        await next();
        return;
    }

    var path = (context.Request.Path.Value ?? "").ToLowerInvariant();

    // Allow these even if not verified
    if (path.StartsWith("/api/auth/me") ||
        path.StartsWith("/api/auth/logout") ||
        path.StartsWith("/api/auth/verify-email") ||
        path.StartsWith("/api/auth/resend-verification") ||
        path.StartsWith("/api/auth/forgot-password") ||
        path.StartsWith("/api/auth/reset-password") ||
        path.StartsWith("/api/auth/change-password"))
    {
        await next();
        return;
    }

    using var scope = context.RequestServices.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<DigitalScrumBoardContext>();

    var idStr = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    if (!int.TryParse(idStr, out var userId))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    var state = await db.Users
        .IgnoreQueryFilters()
        .AsNoTracking()
        .Where(u => u.UserID == userId)
        .Select(u => new { u.EmailVerified, u.MustChangePassword })
        .SingleOrDefaultAsync();

    if (state is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    if (state.MustChangePassword)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            message = "Password change required.",
            code = "PASSWORD_CHANGE_REQUIRED"
        });
        return;
    }

    if (!state.EmailVerified)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            message = "Email verification required.",
            code = "EMAIL_VERIFICATION_REQUIRED"
        });
        return;
    }

    await next();
});

app.UseAuthorization();
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<DigitalScrumBoardContext>();

    await RoleSeeder.SeedRolesAsync(context);
    await AdminUserSeeder.SeedAdminAsync(context);
}

app.Run();