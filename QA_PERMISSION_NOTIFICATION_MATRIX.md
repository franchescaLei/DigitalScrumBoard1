# QA Permission & Notification Matrix — DigitalScrumBoard1

---

## 1. ROLE DEFINITIONS

| Role | ID | Description |
|------|----|-------------|
| **Administrator** | 1 | Full system access — users, teams, sprints, work items, audit logs |
| **Scrum Master** | 2 | Elevated access — sprints, work items, boards. No user/team/audit management |
| **Employee** | 3 | Baseline user — view boards/work items, edit own assigned items, comment |

> **Note:** "Sprint Manager" is **not a role** — it is a per-sprint assignment (`Sprint.ManagedByUserId`). Any user regardless of role can be assigned as a Sprint Manager for a specific sprint and gains elevated permissions only for that sprint.

---

## 2. PERMISSION MATRIX BY MODULE

### 2.1 AUTH MODULE (`/api/auth`)

| Action | Admin | Scrum Master | Employee | Notes |
|--------|:-----:|:------------:|:--------:|-------|
| Login | ✅ | ✅ | ✅ | Rate-limited: 5+ attempts → cooldown, 8+ → 24hr lockout |
| Logout | ✅ | ✅ | ✅ | Any authenticated user |
| View own profile (`/me`) | ✅ | ✅ | ✅ | |
| Update own profile name | ✅ | ✅ | ✅ | |
| Change own password | ✅ | ✅ | ✅ | Requires current password |
| Verify email | ✅ | ✅ | ✅ | Token-based, 24hr expiry |
| Request password reset | ✅ | ✅ | ✅ | 6-digit code, 5min TTL |
| Reset password with code | ✅ | ✅ | ✅ | |
| Resend verification email | ✅ | ✅ | ✅ | Must not be verified yet |
| Unlock user account | ✅ | ❌ | ❌ | Admin only |

**Middleware Gates (applies to ALL users):**
- If `EmailVerified == false` → **403** (`EMAIL_VERIFICATION_REQUIRED`) — blocked from all endpoints except auth flows
- If `MustChangePassword == true` → **403** (`PASSWORD_CHANGE_REQUIRED`) — blocked from all endpoints except auth flows

---

### 2.2 USER MANAGEMENT MODULE (`/api/users`)

| Action | Admin | Scrum Master | Employee | Notes |
|--------|:-----:|:------------:|:--------:|-------|
| List users | ✅ | ❌ | ❌ | Paged, filtered |
| Get user by ID | ✅ | ❌ | ❌ | |
| Get available roles | ✅ | ❌ | ❌ | |
| Create user | ✅ | ❌ | ❌ | Sets `MustChangePassword=true`, `EmailVerified=false` |
| Disable user | ✅ | ❌ | ❌ | Cannot disable self |
| Enable user | ✅ | ❌ | ❌ | |
| Update user role/team | ✅ | ❌ | ❌ | Cannot change own role |
| Reset user password | ✅ | ❌ | ❌ | |
| Force account lockout | ✅ | ❌ | ❌ | Cannot lock self |

---

### 2.3 TEAM MODULE (`/api/teams`)

| Action | Admin | Scrum Master | Employee | Notes |
|--------|:-----:|:------------:|:--------:|-------|
| List teams | ✅ | ❌ | ❌ | Paged, filtered |
| Get team by ID | ✅ | ❌ | ❌ | |
| Create team | ✅ | ❌ | ❌ | |
| Team lookup (dropdown) | ✅ | ✅ | ✅ | `/api/lookups/teams` |

> **Note:** Team membership is set via `TeamID` on the User entity. Only Administrators can change it when creating/updating users.

---

### 2.4 SPRINT MODULE (`/api/sprints`)

| Action | Admin | SM* | SprM* | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|-------|
| Create sprint | ✅ | ✅ | ❌ | ❌ | SM = Scrum Master |
| List sprints | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get sprint by ID | ✅ | ✅ | ✅ | ✅ | |
| Update sprint details | ✅ | ✅ | ❌ | ❌ | Sprint Manager blocked |
| Start sprint | ✅ | ✅ | ✅ | ❌ | SprM = Sprint Manager |
| Stop sprint | ✅ | ✅ | ✅ | ❌ | Requires confirmation if unfinished items |
| Complete sprint | ✅ | ✅ | ✅ | ❌ | Requires confirmation if unfinished items |
| Delete sprint | ✅ | ✅ | ❌ | ❌ | NOT Sprint Manager |

**Sprint Start Prerequisites:**
- Sprint must NOT already be Active or Completed
- Sprint must have at least one work item
- ALL work items must have an assignee

**Sprint Stop/Complete:**
- Sprint must be in Active status
- If unfinished work items exist → requires `force=true` confirmation
- On Complete → unfinished items returned to backlog

---

### 2.5 WORK ITEM MODULE (`/api/workitems`)

| Action | Admin | SM* | SprM* | Assignee | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|:--------:|-------|
| Create work item | ✅ | ✅ | ❌ | — | ❌ | |
| View work item | ✅ | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| View work item details | ✅ | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Full update (all fields) | ✅ | ✅ | ❌ | ❌ | ❌ | Title, description, priority, team, parent, due date, assignee |
| Update assignee only | ✅ | ✅ | ✅ | ❌ | ❌ | SprM: only for their sprint |
| Partial update (assignee) | ✅ | ✅ | ❌ | ❌ | ❌ | Title, description, due date, parent |
| Change status | ✅ | ✅ | ✅ | ✅ | ❌ | Assignee or SprM or Admin/SM |
| Assign to sprint | ✅ | ✅ | ✅ | ❌ | ❌ | |
| Remove from sprint | ✅ | ✅ | ✅ | ❌ | ❌ | |
| Soft-delete (archive) | ✅ | ✅ | ✅ | ❌ | ❌ | Blocked if has active children |
| Get comments | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Add comment | ✅ | ✅ | ✅ | ✅ | ❌ | Must be Admin/SM/SprM/Assignee |
| Edit own comment | ✅ | ✅ | ✅ | ❌ | ❌ | Comment creator only |
| Delete comment | ✅ | ✅ | ❌ | ❌ | ❌ | Comment creator or Admin/SM |

**Full Update (`PATCH /{id}`) Field-Level Breakdown:**

| Fields Changed | Allowed By |
|----------------|------------|
| Priority, Team | Admin, Scrum Master only |
| Assignee | Admin, Scrum Master, Sprint Manager |
| Title, Description, Due Date, Parent | Admin, Scrum Master, **Assignee** |
| Any combination | Union of above permissions |

---

### 2.6 BOARD MODULE (`/api/boards`)

| Action | Admin | SM* | SprM* | Assignee | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|:--------:|-------|
| View active boards | ✅ | ✅ | ✅ | ✅ | ✅ | Only Active sprints |
| View specific board | ✅ | ✅ | ✅ | ✅ | ✅ | Only if sprint is Active |
| Move work item (drag-drop) | ✅ | ✅ | ✅ | ✅ | ❌ | Must follow workflow rules |
| Reorder work item | ✅ | ✅ | ✅ | ✅ | ❌ | Same authorization as move |

**Board Workflow Rules (Allowed Transitions):**

| From | → To |
|------|------|
| To-do | Ongoing |
| Ongoing | To-do, For Checking |
| For Checking | Ongoing, Completed |
| Completed | For Checking |

> Attempting an invalid transition → **400 Bad Request**

---

### 2.7 BACKLOG MODULE (`/api/workitems/backlog`, `/api/workitems/agendas`)

| Action | Admin | SM* | SprM* | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|-------|
| View backlog | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| View agenda items | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get epic hierarchy | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get parent options | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get epic tiles | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get stories by epic | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get tasks by parent | ✅ | ✅ | ✅ | ✅ | Any authenticated user |

---

### 2.8 NOTIFICATION MODULE (`/api/notifications`)

| Action | Admin | SM* | SprM* | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|-------|
| View own notifications | ✅ | ✅ | ✅ | ✅ | Any authenticated user |
| Get unread count | ✅ | ✅ | ✅ | ✅ | |
| Mark as read | ✅ | ✅ | ✅ | ✅ | Own notifications only |
| Mark all as read | ✅ | ✅ | ✅ | ✅ | Own notifications only |

---

### 2.9 AUDIT LOG MODULE (`/api/audit-logs`)

| Action | Admin | Scrum Master | Employee | Notes |
|--------|:-----:|:------------:|:--------:|-------|
| View audit log by ID | ✅ | ❌ | ❌ | |
| List audit logs | ✅ | ❌ | ❌ | Paged, with filters |
| Export as CSV | ✅ | ❌ | ❌ | Max 5000 rows |

**Available Filters:** userId, action, success, dateFrom, dateTo, targetType, targetId, ipAddress

---

### 2.10 LOOKUP MODULE (`/api/lookups`)

| Action | Admin | SM* | SprM* | Employee | Notes |
|--------|:-----:|:---:|:-----:|:--------:|-------|
| Search teams (dropdown) | ✅ | ✅ | ✅ | ✅ | |
| Search users (dropdown) | ✅ | ✅ | ✅ | ✅ | |

---

## 3. NOTIFICATION MATRIX

### 3.1 NOTIFICATION TYPES — TRIGGER & RECIPIENTS

| Notification Type | Triggered By | Recipients | Sent When |
|-------------------|--------------|------------|-----------|
| **WorkItemAssigned** | Work item created or updated with assignee | New assignee | On assign or creation |
| **WorkItemUnassigned** | Work item updated, assignee removed | Old assignee | When assignee cleared |
| **WorkItemUpdated** | Work item fields changed (PATCH) | Assignee, team members | On any field update |
| **WorkItemCommentAdded** | Comment added to work item | Assignee, sprint manager, other commenters | On new comment |
| **WorkItemArchived** | Work item soft-deleted | Assignee, old assignee, creator, sprint manager | On DELETE |
| **WorkItemAssignedToSprint** | Work item added to sprint | Assignee | On assign-sprint |
| **WorkItemRemovedFromSprint** | Work item removed from sprint | Assignee | On remove-sprint |
| **StatusChanged** | Work item moved on board | Assignee (if not actor), Sprint Manager (if not actor) | On board move |
| **WorkItemReordered** | Work item reordered on board | Assignee (if not actor) | On board reorder |
| **SprintManagerAssigned** | Sprint created/updated with manager | New sprint manager | On sprint create/patch |
| **SprintManagerRemoved** | Sprint manager changed | Old sprint manager | On sprint patch |
| **SprintCreatedForTeam** | Sprint created for a team | All team members (except creator and manager) | On sprint create |
| **SprintUpdated** | Sprint details changed | All users assigned work items in sprint | On sprint patch |
| **SprintStarted** | Sprint started | All users with work items in sprint | On sprint start |
| **SprintStopped** | Sprint stopped | All users with work items in sprint | On sprint stop |
| **SprintCompleted** | Sprint completed | All users with work items in sprint | On sprint complete |
| **SprintDeleted** | Sprint deleted | All users who had work items in sprint | On sprint delete |
| **UserAccessUpdated** | Admin changes user role/team | The affected user | On user access update |

---

### 3.2 SIGNALR REAL-TIME BROADCAST EVENTS

These are real-time WebSocket events (separate from DB-persisted notifications):

| Event | Broadcast To | Triggered By |
|-------|-------------|--------------|
| `WorkItemMoved` | `sprint-{sprintId}` group | Board drag-drop |
| `WorkItemReordered` | `sprint-{sprintId}` group | Board reorder |
| `WorkItemStatusChanged` | `sprint-{sprintId}` group | Status change via board |
| `WorkItemUpdated` | `sprint-{sprintId}` group or `All` | PATCH work item |
| `WorkItemDeleted` | `sprint-{sprintId}` group or `All` | DELETE work item |
| `WorkItemCommentAdded` | `sprint-{sprintId}` group or `All` | New comment |
| `SprintCreated` | `All` | Create sprint |
| `SprintUpdated` | `sprint-{sprintId}` group | Update sprint |
| `SprintStarted` | `sprint-{sprintId}` group | Start sprint |
| `SprintStopped` | `sprint-{sprintId}` group | Stop sprint |
| `SprintCompleted` | `sprint-{sprintId}` group | Complete sprint |
| `SprintDeleted` | `All` | Delete sprint |
| `WorkItemAssignedToSprint` | `All` | Assign work item to sprint |
| `AdminDirectoryChanged` | `All` | User CRUD operations |
| `UserProfileChanged` | `user-{userId}` group | Profile name update |
| `NotificationReceived` | `user-{userId}` group | Any new notification |
| `NotificationRead` | `user-{userId}` group | Mark notification read |

---

## 4. AUTHENTICATION FLOW DETAILS

### 4.1 LOGIN FLOW (`POST /api/auth/login`)

```
1. Client sends: { email, password }
2. Server validates credentials against Users table
3. If account disabled → 403 { code: "ACCOUNT_DISABLED" }
4. If credentials valid → create cookie session
5. Response: { user, mustChangePassword, emailVerified }
```

**Rate Limiting:**
| Failed Attempts | Consequence | Duration |
|-----------------|-------------|----------|
| 1–4 | Normal — allowed | — |
| 5–7 | Cooldown | Starts 1 min, +30s per attempt |
| 8+ | Account locked | 24 hours |

**Response Codes:**
| Code | HTTP Status | Meaning |
|------|------------|---------|
| (none) | 200 | Success |
| ACCOUNT_DISABLED | 403 | Account is disabled |
| ACCOUNT_LOCKED | 423 | Locked due to too many failures |
| AUTH_RATE_LIMITED | 429 | Too many login requests |

---

### 4.2 NEW USER FLOW (Admin creates user)

```
1. Admin: POST /api/users with { email, role, team, ... }
2. Server: Creates user with EmailVerified=false, MustChangePassword=true
3. Server: Sends verification email to user
4. User: Receives email, clicks verification link
5. Server: Marks EmailVerified=true
6. User: Logs in for first time
7. Server: Returns mustChangePassword=true
8. User: Must change password via POST /api/auth/change-password
9. Server: Clears MustChangePassword flag
10. User: Now has full access to all endpoints
```

**Important:** Between steps 4–9, the user can ONLY access auth-related endpoints (`/me`, `/change-password`, `/verify-email`, `/forgot-password`, `/reset-password`, `/logout`). All other endpoints return **403**.

---

### 4.3 PASSWORD RESET FLOW (User forgot password)

```
1. User: POST /api/auth/forgot-password { email }
2. Server: Generates 6-digit code, emails it, returns generic success (always 200)
3. User: POST /api/auth/verify-reset-code { email, code }
4. Server: Validates code, returns { valid, remainingSeconds }
5. User: POST /api/auth/reset-password { email, code, newPassword }
6. Server: Validates code, updates password, clears MustChangePassword
```

**Rate Limits:** All reset endpoints are individually rate-limited.

---

## 5. HTTP RESPONSE CODE REFERENCE

| HTTP Code | When It Occurs |
|-----------|---------------|
| **200** | Successful operation |
| **204** | Successful deletion (no content) |
| **400** | Bad request — invalid input, invalid workflow transition |
| **401** | Not authenticated (no valid cookie) |
| **403** | Authenticated but forbidden — wrong role, middleware gate (email not verified, password not changed), self-protection |
| **404** | Resource not found |
| **409** | Conflict — duplicate sprint name, duplicate team name, duplicate work item title |
| **423** | Account locked |
| **429** | Rate limited |
| **500** | Server error |

---

## 6. KEY SECURITY OBSERVATIONS (For QA Testing)

1. **SignalR Hub Access Control:** Any authenticated user can join ANY sprint board group via `JoinSprintBoard()`. There is no membership verification. This is intentional — the data returned is still filtered by the server.

2. **Admin Unlock Endpoint:** `POST /api/auth/unlock/{userId}` only logs an audit entry. The actual lockout is computed from audit log entries (consecutive failures within 24h). The admin cannot forcibly reset the lockout counter — the user must wait 24 hours.

3. **`ScrumMaster` vs `Scrum Master`:** The code checks for BOTH `"Scrum Master"` (with space, seeded) and `"ScrumMaster"` (no space, not seeded). If a user was manually given the no-space variant in the DB, they would still work correctly.

4. **Sprint Manager Is Per-Sprint:** A Sprint Manager only has elevated permissions for the specific sprint they are assigned to. They cannot manage other sprints.

5. **Cookie Settings:** `HttpOnly=true`, `SecurePolicy=SameAsRequest`, `SameSite=Lax`, `ExpireTimeSpan=8h`, `SlidingExpiration=true`.

6. **All Audit Actions Logged:** Every significant action (create, update, delete, login, logout, status change, board move, comment, user management) generates an audit log entry with action, target, IP address, timestamp, and success/failure status.

7. **Rate Limiting:** Login endpoint: 20 requests/minute fixed window. Password reset, email verification resend: individual rate limits with per-IP and per-email tracking.

---

## 7. TEST SCENARIOS CHECKLIST

### Authentication
- [ ] Login with valid credentials → 200
- [ ] Login with wrong password → 401
- [ ] Login to disabled account → 403
- [ ] 5 consecutive failed logins → cooldown
- [ ] 8 consecutive failed logins → 24hr lockout
- [ ] New user with MustChangePassword cannot access boards → 403
- [ ] New user with EmailVerified=false cannot access boards → 403
- [ ] New user can access /me, /change-password, /verify-email → 200
- [ ] Logout → clears session
- [ ] Change password → clears MustChangePassword flag

### User Management (Admin Only)
- [ ] Admin can list users
- [ ] Admin can create user → sends verification email
- [ ] Admin can disable user → user cannot login
- [ ] Admin can enable user → user can login again
- [ ] Admin can change user role/team
- [ ] Admin can force lockout user
- [ ] Admin CANNOT disable self
- [ ] Admin CANNOT change own role

### Team Management (Admin Only)
- [ ] Admin can create team
- [ ] Admin can list teams
- [ ] Admin can get team by ID
- [ ] Non-admin cannot access /api/teams → 403

### Sprint Management
- [ ] Admin/SM can create sprint
- [ ] Employee cannot create sprint → 403
- [ ] Admin/SM/SprM can start sprint (if prerequisites met)
- [ ] Start sprint without work items → 400
- [ ] Start sprint with unassigned work items → 400
- [ ] Admin/SM/SprM can stop active sprint
- [ ] Admin/SM/SprM can complete active sprint
- [ ] Stop/complete with unfinished items + force=true → 200
- [ ] Stop/complete with unfinished items + force=false → 400
- [ ] Admin/SM can update sprint details
- [ ] Sprint Manager CANNOT update sprint details → 403
- [ ] Admin/SM can delete sprint
- [ ] Sprint Manager CANNOT delete sprint → 403

### Work Item Management
- [ ] Admin/SM can create work item
- [ ] Employee cannot create work item → 403
- [ ] Any user can view work item
- [ ] Admin/SM can update all fields
- [ ] Sprint Manager can only update assignee in their sprint
- [ ] Assignee can update title, description, due date, parent
- [ ] Assignee CANNOT update priority, team, assignee → 403
- [ ] Admin/SM/SprM can change status
- [ ] Assignee can change status
- [ ] Employee (not assignee) cannot change status → 403
- [ ] Admin/SM/SprM can delete work item
- [ ] Delete work item with active children → 400
- [ ] Assignee can add comment
- [ ] Employee (not assignee) cannot add comment → 403
- [ ] Comment creator can edit own comment
- [ ] Admin/SM can delete any comment
- [ ] Employee cannot delete others' comments → 403

### Board Operations
- [ ] Any user can view active boards
- [ ] Any user can view active sprint board
- [ ] Admin/SM/SprM/Assignee can move work item on board
- [ ] Employee (not assignee) cannot move work item → 403
- [ ] To-do → Ongoing → valid
- [ ] To-do → For Checking → 400 (invalid transition)
- [ ] Ongoing → To-do → valid
- [ ] Ongoing → For Checking → valid
- [ ] For Checking → Completed → valid
- [ ] Completed → For Checking → valid
- [ ] Completed → Ongoing → 400 (invalid transition)

### Notifications
- [ ] User receives notification when assigned work item
- [ ] User receives notification when work item updated
- [ ] User receives notification when comment added
- [ ] User receives notification when sprint started/stopped/completed
- [ ] Sprint manager receives notification when assigned
- [ ] Team members receive notification when sprint created
- [ ] Real-time SignalR broadcast received by connected clients
- [ ] User can mark notification as read
- [ ] User can mark all notifications as read
- [ ] Unread count updates correctly

### Audit Logs (Admin Only)
- [ ] Admin can view audit logs
- [ ] Admin can filter by user, action, date range, target
- [ ] Admin can export audit logs as CSV
- [ ] Non-admin cannot access audit logs → 403

---

*Document generated from codebase analysis. Last updated: 2026-04-13*
