# DigitalScrumBoard1 Comprehensive Codebase Review

## 1) High-level architecture

- **Platform:** ASP.NET Core Web API on **.NET 9** with Entity Framework Core + SQL Server.
- **Auth model:** Cookie authentication (`MyCookieAuth`) with role claims.
- **Design style:** Controller -> Service/Repository -> EF Core DbContext.
- **Domain coverage:** authentication lifecycle, user/team administration, sprint/work item management, audit logging, and lookup endpoints.

## 2) Existing functionality

### Authentication and account lifecycle
- Login endpoint with layered protections:
  - global endpoint limiter (`LoginLimiter`)
  - custom progressive cooldown after repeated failed attempts
  - hard lockout after enough consecutive failed attempts
- Cookie sign-in stores role/email/name/user id claims and 8-hour session expiry.
- Endpoints for logout, `me`, change-password, verify-email, resend verification, forgot-password (6-digit code), verify-reset-code, reset-password, and admin-only unlock endpoint.
- Password rules enforced for change/reset operations.

### User and team administration
- Admin-only user endpoints:
  - list users with filters + pagination
  - get by id
  - create user (temporary password + verification email)
  - disable/enable user
  - update access (role/team)
  - admin reset password (emails temporary password)
- Admin-only team creation + team fetch by id.

### Work item management
- Work item creation with type-specific hierarchy checks for Epic/Story/Task.
- Retrieval endpoints:
  - basic by id
  - detailed breakdown with children
  - possible parent candidates
  - epic dashboard tiles
  - agenda response (sprints + backlog)
- Sprint assignment/removal flows for story/task only.
- Work item status update with permission checks for assignee/sprint manager/admin/scrum master.

### Sprint management
- Sprint creation (admin/scrum master).
- Sprint start endpoint.
- Sprint deletion that unassigns linked work items back to backlog.

### Audit and observability
- Audit logging service records actor/action/target/success/details/ip.
- Admin-only audit browsing by filters, paging, and CSV export.

### Data integrity rules (EF + DB)
- Soft-delete global filter on work items and comments.
- Check constraints for sprint status and work item status/priority values.
- App-level hierarchy enforcement in `SaveChanges` for parent/child type legality.

## 3) Security assessment

## Strengths
- HttpOnly secure cookie auth with explicit unauthorized/forbidden responses.
- Rate limiting enabled and lockout logic implemented.
- Password hashing uses PBKDF2-SHA256 with 150k iterations and random salt.
- Tokens are stored hashed (verification and reset flows).
- Role-based protection is present on sensitive admin/audit endpoints.
- Most DB writes include audit trails.

## Critical/high issues to fix

1. **Credential leakage in source control (critical)**
   - `appsettings.json` includes a live-looking SMTP username/password and machine-level connection string.
   - Risk: account compromise, spam abuse, lateral movement.
   - Fix: rotate compromised secrets immediately, remove from repo history, use Secret Manager / env vars / vault.

2. **Role naming mismatch may break authorization (high)**
   - Seeder creates role `ScrumMaster` while endpoints check role `Scrum Master` (with a space).
   - Risk: valid scrum masters may be denied access or forced into admin-only workflows.
   - Fix: standardize role enum/names across seed data, claims emission, `[Authorize(Roles=...)]`, and any UI role mapping.

3. **Unlock endpoint does not really unlock account (high logic/security)**
   - `/api/auth/unlock/{userId}` logs an audit event but does not mutate lock state (because lock state is inferred from recent failed audit logs).
   - Risk: false sense of control; operations thinks account is unlocked but login remains blocked until time window expires.
   - Fix: introduce real lock state columns (`LockoutUntil`, `FailedLoginCount`) or a dedicated unlock marker logic and clear/invalidate failed-attempt sequence.

4. **Potential user enumeration during login (medium)**
   - Unknown email returns 401 immediately and does not audit; known disabled user returns explicit `ACCOUNT_DISABLED`.
   - Risk: attacker can classify account existence/state by response pattern.
   - Fix: normalize outward messages/status where possible; keep detailed reasons only in audit logs.

5. **CSRF exposure risk for cookie-authenticated API (medium/high depending deployment)**
   - Cookie auth + `SameSite=None` + credentialed CORS can permit cross-site cookie sending in browser contexts if anti-CSRF is not used.
   - Risk: authenticated cross-site action triggering.
   - Fix: add anti-forgery strategy for state-changing endpoints (double-submit token/header check), tighten `SameSite` where feasible, and narrow CORS origins per environment.

## Additional reliability/performance concerns

- `AuthController.Login` and other queries repeatedly use `ToLower()` in predicates; can reduce index effectiveness and add DB CPU overhead.
  - Fix: normalized email column with unique index or case-insensitive collation comparisons.
- Several controllers/services return anonymous/dynamic objects with reflection in places (`UsersController`, `TeamsController`).
  - Fix: adopt strongly typed response DTOs to improve maintainability and API contracts.
- Audit writes call `SaveChanges` per event; high-traffic paths may incur extra transaction overhead.
  - Fix: batch/queue audit events or support unit-of-work aggregation where consistent.
- `GetById` sprint endpoint is currently placeholder text, not a true read model.
  - Fix: implement full sprint details DTO.
- Many flows rely on string literals for statuses/actions/roles.
  - Fix: centralize constants/enums.

## 4) Suggested remediation roadmap

### Immediate (today)
1. Remove/rotate secrets from `appsettings.json`, replace with environment-backed configuration.
2. Resolve role-name inconsistency (`ScrumMaster` vs `Scrum Master`) globally.
3. Patch unlock behavior to actually clear lock condition.

### Short-term (this sprint)
1. Add CSRF protections for cookie-authenticated mutating endpoints.
2. Normalize auth failure responses to reduce account-state leakage.
3. Replace dynamic/anonymous API payloads with DTOs and explicit contracts.

### Medium-term
1. Introduce explicit account lock model in DB instead of deriving lock from audit log history.
2. Improve query performance by avoiding runtime `ToLower()` filtering against indexed fields.
3. Add integration tests for auth lockout/unlock, role authorization, and permission checks on work item/sprint actions.

## 5) Overall verdict

The codebase is functionally rich and already includes thoughtful security primitives (hashing, rate limiting, audit logging, role checks, and hierarchy constraints). However, it currently has a few **high-impact correctness/security defects** (notably embedded secrets, role mismatch, and ineffective unlock semantics) that should be prioritized before production hardening.
