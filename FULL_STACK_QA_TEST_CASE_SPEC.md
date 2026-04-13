# DigitalScrumBoard1 — Full-Stack QA Test Case Specification

## 1. Test Scope & Strategy

### What is being tested
- **Authentication + account-gating**: login, logout, profile update, forced password change, email verification, forgot/reset password, lockout recovery.
- **RBAC and resource-level permissions**: Administrator vs Scrum Master vs Employee, plus Sprint Manager and Work Item Assignee scoped permissions.
- **Core planning modules**: Epics/Stories/Tasks, sprint planning, sprint lifecycle, board movement/reorder, comments, archival.
- **Admin modules**: user management, team management, roles lookup, audit logs + CSV export.
- **Notifications**: in-app notifications API + real-time toast/unread-count sync via SignalR.
- **Real-time collaboration**: BoardHub and NotificationHub event propagation, multi-session consistency.
- **Security controls**: rate limiting, lockouts, middleware gates, authorization checks, invalid transitions.

### Testing approach
- **UI-first manual/E2E flows** (no API-call-centric test design).
- **Multi-user concurrent testing** with at least 3 sessions:
  - Session A: Administrator
  - Session B: Scrum Master / Sprint Manager
  - Session C: Employee assignee
- **Dual-tab same-user tests** for notification unread count sync and stale-state behavior.
- **Stateful lifecycle testing** validating transitions, rollback/confirmation prompts, and real-time broadcast effects.

### Key risk areas
1. Role string mismatch (`"Scrum Master"` vs `"ScrumMaster"`) across backend checks.
2. Hub group authorization gap (authenticated users can join arbitrary sprint SignalR groups).
3. UI permission affordance vs backend permission enforcement mismatch.
4. Sprint/Work Item state transition race conditions (multi-user simultaneous edits).
5. Partial-auth gating edge conditions (must change password/email verify) in route guards.

---

## 2. Test Environment Setup

### Required user roles
Create at minimum:
- **U1 Admin** (Role: Administrator, verified email, not forced password change).
- **U2 Scrum Master** (Role: Scrum Master, verified, active).
- **U3 Employee A** (Role: Employee, verified).
- **U4 Employee B** (Role: Employee, verified).
- **U5 Unverified Employee** (EmailVerified = false).
- **U6 Forced Password Change User** (MustChangePassword = true).
- **U7 Disabled User** (Disabled = true).
- **U8 Locked User** (failed login attempts >= lock threshold / forced lockout from admin).

### Required data setup
- Teams: Team Alpha, Team Beta.
- Work item hierarchy:
  - Epic E1
  - Story S1 under E1
  - Task T1 under S1
  - Task T2 under E1
- Sprint set:
  - Sprint P1 (Planned, manager U2, Team Alpha)
  - Sprint A1 (Active, manager U2, Team Alpha) with assigned items
  - Sprint C1 (Completed)
- Work item variants:
  - Backlog Story assigned to U3
  - Backlog Task unassigned
  - Completed Story
  - Story with child tasks (for delete-guard testing)

### Multi-session/browser requirements
- Browser 1 (Admin) + Browser 2 (Scrum Master) + Browser 3 (Employee).
- Additional tab in Browser 3 for same-user notification sync.
- Optional throttled network profile to validate polling/reconnect behavior.

---

## 3. Role & Permission Matrix (Derived from Code)

| Capability | Administrator | Scrum Master | Employee | Sprint Manager (resource) | Assignee (resource) |
|---|---:|---:|---:|---:|---:|
| Access app routes (/backlogs,/boards,/profile) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Access Admin page + user/team/audit actions | ✅ | ❌ UI + backend denied | ❌ | ❌ | ❌ |
| Create Sprint | ✅ | ✅ | ❌ | N/A | N/A |
| Edit Sprint metadata (name/goal/dates/team/manager) | ✅ | ✅ | ❌ | ❌ (if not elevated) | ❌ |
| Start/Stop/Complete Sprint | ✅ | ✅ | ❌ | ✅ | ❌ |
| Delete Sprint | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create Work Item | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign/Remove Work Item to/from sprint | ✅ | ✅ | ❌ | ✅ | ❌ |
| Change Work Item assignee | ✅ | ✅ | ❌ | ✅ | ✅ (limited self/assignee context) |
| Change Work Item team/priority/general fields | ✅ | ✅ | ❌ | ❌ (assignee-only restriction in patch path) | ❌ |
| Move board status | ✅ | ✅ | ❌ (unless assignee) | ✅ | ✅ |
| Reorder within board column | ✅ | ✅ | ❌ (unless assignee) | ✅ | ✅ |
| Comment on work item | ✅ | ✅ | ❌ (unless assignee) | ✅ | ✅ |
| Edit own comment | ✅ (if author) | ✅ (if author) | ✅ (if author) | ✅ (if author) | ✅ (if author) |
| Delete comment | ✅ (any comment) | author only | author only | author only | author only |

**Important derived constraints**
- Elevated role checks accept `Administrator`, `Scrum Master`, and legacy `ScrumMaster` in many backend paths.
- Sprint Manager is not globally privileged: can manage lifecycle + sprint scoped actions but cannot edit sprint metadata unless elevated.
- Middleware globally blocks most authenticated API routes when `MustChangePassword=true` or `EmailVerified=false` (except allowlisted auth endpoints).

---

## 4. Functional Test Suites (UI-Based)

## Authentication

### TC-AUTH-001 — Successful login redirects to protected app
**Preconditions:** Active verified user U3 exists.
**Test Steps:**
1. Open `/login`.
2. Enter valid email/password.
3. Click **Sign in**.
**Expected Result:**
- User lands on app (`/backlogs` default).
- Sidebar/profile display authenticated identity.
- Session cookie-based auth persists across page refresh.

### TC-AUTH-002 — Login fails with invalid password
**Preconditions:** U3 exists.
**Test Steps:**
1. Open login page.
2. Enter valid email + wrong password.
3. Submit.
**Expected Result:**
- Error shown: incorrect credentials.
- Stay on login page.
- No protected route access.

### TC-AUTH-003 — Login blocked for disabled account
**Preconditions:** U7 disabled.
**Test Steps:** Login as U7.
**Expected Result:** Generic invalid credentials behavior; no login.

### TC-AUTH-004 — Stepped cooldown after repeated failed logins
**Preconditions:** U3 exists.
**Test Steps:**
1. Attempt wrong password repeatedly until cooldown threshold.
2. Observe banner/countdown.
**Expected Result:**
- UI shows rate-limited countdown.
- Submit is blocked during countdown.

### TC-AUTH-005 — Account lockout after excessive failed attempts
**Preconditions:** U3 exists.
**Test Steps:** Continue failed attempts until lockout threshold.
**Expected Result:**
- Account locked message and countdown displayed.
- Login remains blocked until retry window or admin unlock.

### TC-AUTH-006 — Forced password change gate
**Preconditions:** U6 (`MustChangePassword=true`).
**Test Steps:**
1. Login as U6.
2. Observe redirect.
3. Complete change-password form with policy-compliant password.
**Expected Result:**
- Redirect to `/change-password` immediately.
- After success, user can enter protected app.

### TC-AUTH-007 — Email verification gate
**Preconditions:** U5 (`EmailVerified=false`).
**Test Steps:** Login as U5.
**Expected Result:**
- Redirect to `/verify-email`.
- Protected routes remain blocked until verified.

### TC-AUTH-008 — Verify-email token happy path
**Preconditions:** Valid verification token URL.
**Test Steps:**
1. Open `/verify-email?token=...`.
2. Wait for processing.
**Expected Result:**
- Shows verified state.
- Redirect to `/email-verified` then app route.

### TC-AUTH-009 — Verify-email invalid/expired token
**Preconditions:** Invalid token URL.
**Test Steps:** open token link.
**Expected Result:**
- Verification failed state shown.
- User remains outside app until valid verification.

### TC-AUTH-010 — Forgot-password 3-step flow
**Preconditions:** U3 valid email.
**Test Steps:**
1. Open forgot password.
2. Request code.
3. Enter 6-digit code.
4. Set new valid password.
5. Login with new password.
**Expected Result:** Reset flow succeeds end-to-end.

### TC-AUTH-011 — Forgot-password invalid OTP
**Preconditions:** Step 2 reached.
**Test Steps:** Enter malformed/wrong code and submit.
**Expected Result:**
- Error shown.
- Remain on verification step.

### TC-AUTH-012 — Logout invalidates access
**Preconditions:** Logged in user.
**Test Steps:** click Sign out.
**Expected Result:**
- Redirect to `/login`.
- Attempting protected route redirects to login.

## User Management (Admin)

### TC-USER-001 — Admin-only access guard for user management page
**Preconditions:** U2 and U3 sessions.
**Test Steps:** navigate to `/admin/users` as non-admin.
**Expected Result:** Access denied UI; backend endpoints blocked.

### TC-USER-002 — Admin creates user with valid role/team
**Preconditions:** Admin session.
**Test Steps:**
1. Open Admin > User Management.
2. Create user form with valid required fields.
3. Submit.
**Expected Result:**
- User appears in directory.
- Temporary onboarding actions (email/reset workflow) occur per UI behavior.

### TC-USER-003 — Duplicate email rejected
**Preconditions:** Existing email in system.
**Test Steps:** Create new user with same email.
**Expected Result:** Conflict error shown; record not created.

### TC-USER-004 — Disable and re-enable user
**Preconditions:** Active target user != acting admin.
**Test Steps:** Disable target then enable.
**Expected Result:** Status badges change accordingly; target login blocked while disabled.

### TC-USER-005 — Prevent self-disable
**Preconditions:** Admin viewing own account in list.
**Test Steps:** attempt disable self.
**Expected Result:** UI error stating self-disable not allowed.

### TC-USER-006 — Force lockout and admin unlock
**Preconditions:** Active target user.
**Test Steps:**
1. Click Force Lockout.
2. Validate target login blocked.
3. Use Unlock action.
4. Validate target can login.
**Expected Result:** lock/unlock lifecycle works.

### TC-USER-007 — Admin reset password sends temp credentials
**Preconditions:** target user active.
**Test Steps:** trigger reset password action.
**Expected Result:** success message; target forced password change next login.

## Teams

### TC-TEAM-001 — Admin creates team successfully
**Preconditions:** Admin session.
**Test Steps:** open Teams tab; create unique name.
**Expected Result:** team visible in team list + pickers.

### TC-TEAM-002 — Duplicate team name blocked (case-insensitive)
**Preconditions:** Existing team name.
**Test Steps:** create same team with case variation.
**Expected Result:** duplicate validation error.

### TC-TEAM-003 — Non-admin cannot access team APIs through UI
**Preconditions:** non-admin session.
**Test Steps:** attempt team-management UI path (if accessible) and observe.
**Expected Result:** no management access; actions denied.

## Sprints

### TC-SPRINT-001 — Elevated role can create planned sprint
**Preconditions:** Admin/Scrum Master logged in.
**Test Steps:** Create sprint with required fields.
**Expected Result:** sprint appears in list with `Planned` status.

### TC-SPRINT-002 — Employee cannot create sprint
**Preconditions:** Employee session.
**Test Steps:** attempt create sprint via UI controls.
**Expected Result:** control hidden or backend rejection surfaced.

### TC-SPRINT-003 — Sprint create validation (missing fields/date order)
**Preconditions:** Elevated role session.
**Test Steps:**
1. Empty name/goal/start/end/manager variations.
2. End date earlier than start.
**Expected Result:** validation messages shown, no sprint created.

### TC-SPRINT-004 — Start sprint blocked when no work items
**Preconditions:** Planned sprint with zero items.
**Test Steps:** click Start Sprint.
**Expected Result:** conflict message: cannot start without work items.

### TC-SPRINT-005 — Start sprint blocked when any item unassigned
**Preconditions:** Planned sprint has at least one unassigned item.
**Test Steps:** start sprint.
**Expected Result:** conflict message listing unassigned items.

### TC-SPRINT-006 — Start sprint success
**Preconditions:** Planned sprint with all items assigned.
**Test Steps:** start sprint.
**Expected Result:** status changes to Active; board becomes available.

### TC-SPRINT-007 — Stop active sprint requires confirmation when unfinished
**Preconditions:** Active sprint with incomplete items.
**Test Steps:** click Stop; first attempt without confirm; then confirm.
**Expected Result:** confirmation modal first; then status returns to Planned.

### TC-SPRINT-008 — Complete active sprint with unfinished items
**Preconditions:** Active sprint with unfinished items.
**Test Steps:** complete sprint; confirm when prompted.
**Expected Result:** sprint -> Completed; unfinished items returned to backlog.

### TC-SPRINT-009 — Sprint manager permission scope
**Preconditions:** U2 is sprint manager but non-elevated (if role employee for this test variant).
**Test Steps:** try lifecycle + metadata edit.
**Expected Result:** lifecycle allowed; metadata edit denied unless elevated role.

### TC-SPRINT-010 — Delete sprint restricted to elevated roles
**Preconditions:** Planned sprint with assigned items.
**Test Steps:** delete as Admin/Scrum Master and as Employee.
**Expected Result:** elevated succeeds (items returned to backlog), employee denied.

## Work Items

### TC-WI-001 — Create Epic/Story/Task hierarchy validation
**Preconditions:** Elevated user.
**Test Steps:**
1. Create Story without parent.
2. Create Story under non-Epic.
3. Create Task under invalid parent.
4. Create valid Epic > Story > Task.
**Expected Result:** invalid combinations blocked; valid hierarchy succeeds.

### TC-WI-002 — Create work item due-date vs parent story constraint
**Preconditions:** Story with due date exists.
**Test Steps:** create Task under story with later due date.
**Expected Result:** rejected with due-date constraint message.

### TC-WI-003 — Employee cannot create work items
**Preconditions:** Employee session.
**Test Steps:** attempt create via add-item UI.
**Expected Result:** action unavailable or denied.

### TC-WI-004 — Assign Story/Task to planned sprint (authorized)
**Preconditions:** Planned sprint and backlog Story/Task.
**Test Steps:** drag/drop or assign action into sprint.
**Expected Result:** success + appears under sprint list.

### TC-WI-005 — Assign Epic to sprint blocked
**Preconditions:** Epic in backlog.
**Test Steps:** attempt assign epic to sprint.
**Expected Result:** blocked with type constraint error.

### TC-WI-006 — Assign completed item to sprint blocked
**Preconditions:** completed Story/Task.
**Test Steps:** assign to sprint.
**Expected Result:** rejected.

### TC-WI-007 — Assign/remove while sprint Active blocked
**Preconditions:** Active sprint.
**Test Steps:** attempt add/remove item.
**Expected Result:** blocked; prompt to stop sprint first.

### TC-WI-008 — Remove item from sprint (authorized)
**Preconditions:** Planned sprint with item assigned.
**Test Steps:** remove from sprint.
**Expected Result:** item returns to backlog.

### TC-WI-009 — Work item patch permission granularity
**Preconditions:** same item viewed by Admin, Sprint Manager, Employee non-assignee, Assignee.
**Test Steps:** each role attempts title/priority/team/assignee edits.
**Expected Result:**
- Admin/Scrum Master: full.
- Sprint Manager: assignee change only.
- Assignee/non-assignee employees: restricted appropriately.

### TC-WI-010 — Archive blocked when active children exist
**Preconditions:** parent item with non-deleted child items.
**Test Steps:** attempt delete/archive parent.
**Expected Result:** blocked until child items inactive/deleted.

### TC-WI-011 — Comment add permission matrix
**Preconditions:** item in sprint with assigned user and sprint manager.
**Test Steps:** comment as Admin, Scrum Master, Sprint Manager, assignee, non-assignee employee.
**Expected Result:** first four allowed, unauthorized employee blocked.

### TC-WI-012 — Comment edit/delete ownership rules
**Preconditions:** comment exists by User A.
**Test Steps:**
1. User B attempts edit/delete.
2. Admin attempts delete.
3. Author edits/deletes own comment.
**Expected Result:** edit author-only; delete author-or-admin only.

## Board (Kanban)

### TC-BOARD-001 — Active board list visibility
**Preconditions:** at least one active sprint.
**Test Steps:** open Boards page and board dropdown.
**Expected Result:** only active sprints appear as selectable boards.

### TC-BOARD-002 — Board unavailable for non-active sprint
**Preconditions:** planned/completed sprint exists.
**Test Steps:** attempt direct navigation/state selection to non-active board.
**Expected Result:** conflict/error shown; board data not loaded.

### TC-BOARD-003 — Valid status transitions only
**Preconditions:** active sprint item in each status.
**Test Steps:** attempt drag transitions:
- To-do -> Ongoing (valid)
- Ongoing -> For Checking (valid)
- For Checking -> Completed (valid)
- Invalid jumps (e.g., To-do -> Completed)
**Expected Result:** valid moves succeed; invalid moves rejected and UI reverts.

### TC-BOARD-004 — Move permission matrix
**Preconditions:** same board item visible to multiple users.
**Test Steps:** attempt drag as admin/scrum/sprint manager/assignee/non-assignee employee.
**Expected Result:** only authorized roles can move.

### TC-BOARD-005 — Reorder within column
**Preconditions:** multiple items in same status column.
**Test Steps:** reorder cards rapidly.
**Expected Result:** stable final order, persisted after refresh.

### TC-BOARD-006 — Board move on inactive sprint prevented
**Preconditions:** sprint stopped/completed while board open.
**Test Steps:** attempt additional move.
**Expected Result:** backend conflict; UI shows failure and keeps consistent state.

## Backlog

### TC-BACKLOG-001 — Backlog filters/sorts apply correctly
**Preconditions:** diverse backlog dataset.
**Test Steps:** apply combinations of type/priority/assignee/search/sort.
**Expected Result:** list updates correctly and remains stable across refresh.

### TC-BACKLOG-002 — Sprint panel expand + load sprint work items
**Preconditions:** sprint with items.
**Test Steps:** expand sprint row/card.
**Expected Result:** associated items load and render correctly.

### TC-BACKLOG-003 — Drag item to sprint shows confirm and executes
**Preconditions:** assignable backlog Story/Task.
**Test Steps:** drag into sprint area and confirm.
**Expected Result:** item removed from backlog and attached to sprint.

### TC-BACKLOG-004 — Remove from sprint confirm flow
**Preconditions:** sprint item exists.
**Test Steps:** remove action requiring confirmation.
**Expected Result:** item returns to backlog with correct status and notifications.

## Notifications

### TC-NOTIF-001 — Unread badge loads on header
**Preconditions:** user has unread notifications.
**Test Steps:** login and observe bell badge.
**Expected Result:** unread count matches server count.

### TC-NOTIF-002 — Notification panel paged list + mark one read
**Preconditions:** panel has unread item.
**Test Steps:** open panel, mark single item read.
**Expected Result:** item state updates; unread count decrements.

### TC-NOTIF-003 — Mark all read
**Preconditions:** multiple unread notifications.
**Test Steps:** click mark all read.
**Expected Result:** all marked read, unread count becomes zero.

### TC-NOTIF-004 — Real-time toast + count update
**Preconditions:** User session open; another session triggers event (e.g., assignment).
**Test Steps:** perform trigger action in other user session.
**Expected Result:** recipient sees toast/chime and unread badge increments without refresh.

## Audit Logs

### TC-AUDIT-001 — Admin can view paged logs
**Preconditions:** Admin with existing log volume.
**Test Steps:** open `/admin/audit`; paginate.
**Expected Result:** rows render with stable paging and metadata.

### TC-AUDIT-002 — Filter combinations
**Preconditions:** mixed audit entries.
**Test Steps:** apply user/action/success/date/target/ip filters.
**Expected Result:** result set matches filters.

### TC-AUDIT-003 — Export CSV honors filters
**Preconditions:** filtered view active.
**Test Steps:** click Export CSV.
**Expected Result:** downloaded CSV reflects filter scope.

### TC-AUDIT-004 — Non-admin blocked from audit logs
**Preconditions:** non-admin session.
**Test Steps:** attempt access via URL.
**Expected Result:** denied at UI and backend endpoint.

---

## 5. Real-Time (SignalR/WebSocket) Test Cases

### TC-RT-001 — Sprint group join/leave board updates
**Preconditions:** two users in same sprint board.
**Test Steps:**
1. Both open board.
2. User A moves work item.
3. User B observes update.
4. User B leaves board/changes sprint.
5. User A moves again.
**Expected Result:** B gets updates only while in group.

### TC-RT-002 — Cross-page backlog/sprint sync events
**Preconditions:** Backlog pages open in 2 sessions.
**Test Steps:**
1. Session A assigns/removes item to sprint.
2. Session B observes sprint/backlog list updates.
**Expected Result:** event-driven UI sync (`WorkItemAssignedToSprint`, `WorkItemRemovedFromSprint`).

### TC-RT-003 — Sprint lifecycle broadcast
**Preconditions:** sprint observers in multiple sessions.
**Test Steps:** start/stop/complete sprint in one session.
**Expected Result:** other sessions receive lifecycle update events and refresh state.

### TC-RT-004 — Notification hub same-user multi-tab sync
**Preconditions:** same user logged in two tabs.
**Test Steps:** mark item read in tab A.
**Expected Result:** tab B unread count updates via `NotificationRead` broadcast.

### TC-RT-005 — Unauthorized hub connection attempt
**Preconditions:** no auth cookie.
**Test Steps:** open app and observe hub startup behavior.
**Expected Result:** hub connection fails gracefully; app remains functional with degraded real-time.

### TC-RT-006 — Race: two users move same card simultaneously
**Preconditions:** two authorized users on same board and item.
**Test Steps:** drag same item to different columns nearly simultaneously.
**Expected Result:** one final consistent server state; clients converge after broadcasts.

### TC-RT-007 — Race: reorder collisions in same column
**Preconditions:** dense column, two users.
**Test Steps:** both reorder rapidly.
**Expected Result:** no duplicated boardOrder or lost cards after refresh.

### TC-RT-008 — Sprint group overreach probe (security)
**Preconditions:** authenticated user not associated with sprint team.
**Test Steps:** from UI context capable of joining sprint, open/manage another sprint id if possible.
**Expected Result:** **Current code likely allows join**; record as security finding if cross-sprint data received.

---

## 6. Security & Edge Case Test Cases

### TC-SEC-001 — Vertical privilege escalation (employee -> admin pages)
- Attempt to navigate directly to `/admin/users` and `/admin/audit` as employee.
- Expected: access denied UI + API 403.

### TC-SEC-002 — Horizontal privilege escalation (notification ownership)
- As User A, attempt UI action against notification created for User B (via manipulated IDs in UI devtools if feasible).
- Expected: not found/forbidden behavior.

### TC-SEC-003 — Middleware gate bypass attempt
- Login with unverified/forced-password user; navigate protected pages and trigger app actions.
- Expected: enforced redirects + API 403 with gate codes.

### TC-SEC-004 — Lockout bypass attempt
- Locked account tries valid credentials before retry-after expiry.
- Expected: remains locked (423) until expiry/admin unlock.

### TC-SEC-005 — Excessive auth endpoint requests
- Spam login/forgot/reset verify flows quickly.
- Expected: 429 throttling with retry-after countdown reflected in UI where handled.

### TC-SEC-006 — Invalid work item transitions and impossible states
- Force attempts via UI sequence to jump status or assign Epic to sprint.
- Expected: hard reject and no partial updates.

### TC-SEC-007 — Disabled user session behavior
- Disable user while they are logged in (admin action).
- Expected: subsequent guarded actions fail and user eventually forced out upon auth checks.

### TC-SEC-008 — Soft-deleted item access paths
- Open details/comments on archived/deleted work item from stale UI link.
- Expected: blocked with proper messaging; no mutating actions allowed.

### TC-SEC-009 — Self-harm admin restrictions
- Admin attempts self-disable and self-lock.
- Expected: prevented with explicit message.

---

## 7. Workflow & State Transition Testing

### Sprint lifecycle rules
1. **Create -> Planned** only.
2. **Planned -> Active** requires at least one work item and all assigned.
3. **Active -> Planned** (Stop) allowed, confirmation required if unfinished items.
4. **Active -> Completed** allowed, confirmation required if unfinished; unfinished items returned to backlog.
5. **Completed** cannot be restarted.

### Work item lifecycle
- Valid board transitions only:
  - To-do -> Ongoing
  - Ongoing -> To-do / For Checking
  - For Checking -> Ongoing / Completed
  - Completed -> For Checking
- Invalid transitions rejected and must not persist in UI.

### Board status/position rules
- Moves only in active sprint.
- Reorder position must be non-negative.
- Column normalization should keep contiguous order after move/reorder/delete.

### Invalid transitions to explicitly test
- To-do -> Completed direct.
- Completed -> Ongoing direct.
- Start Completed sprint.
- Assign/remove item while sprint Active.
- Delete parent item with active children.

---

## 8. End-to-End (E2E) Scenarios

### E2E-001 — New user onboarding (admin-created account)
1. Admin creates user.
2. User receives credentials, logs in.
3. Forced change password flow completes.
4. Email verification gate completes.
5. User enters Backlogs and updates profile.
**Expected:** onboarding complete, full access according to role.

### E2E-002 — Sprint lifecycle full journey
1. Scrum Master creates sprint.
2. Creates Story/Task items and assigns assignees.
3. Adds items to sprint.
4. Starts sprint.
5. Assignees move items across board.
6. Complete sprint with unfinished confirmation.
7. Validate unfinished items back to backlog.

### E2E-003 — Multi-user collaboration with real-time updates
1. Session A (SM) and Session B (Employee assignee) open same sprint.
2. A changes assignee / updates sprint metadata.
3. B sees updates live.
4. B moves assigned item; A sees board update and notification.
5. Both validate notification panel unread sync.

### E2E-004 — Assignment -> work -> completion
1. Backlog item assigned to sprint and assignee.
2. Sprint started.
3. Assignee progresses card through valid statuses.
4. Reviewer/sprint manager sends item back from For Checking to Ongoing.
5. Item completed and sprint completed.
**Expected:** accurate history, notifications, and final statuses.

---

## 9. High-Risk Areas & Likely Failure Points

1. **Hub authorization gap**: BoardHub/NotificationHub sprint join methods currently permit any authenticated user to join any sprint group; potential cross-sprint event visibility risk.
2. **Role naming inconsistency risk**: coexistence of `Scrum Master` and `ScrumMaster` may cause inconsistent authorization if new role data is introduced.
3. **UI-vs-backend permission drift**: frontend helper checks may allow/disallow controls differently from backend enforcement (especially sprint manager and assignee edits).
4. **Concurrency/race conditions**:
   - simultaneous move/reorder on same item,
   - sprint lifecycle action while board operations are in-flight.
5. **Partial-auth gate transitions**: protected-route probe (`/api/boards/active`) used as auth gate can create edge-case UX when server returns non-auth failures.
6. **Soft delete + hierarchy integrity**: deleting parents with children and stale UI references may expose inconsistent states if not carefully synchronized.
7. **Rate limit UX coverage**: login page has countdown handling; other pages may surface generic errors if rate-limited, causing poor but acceptable UX.

---

## Ambiguities / Clarifications for QA Execution
- Team management UI is nested inside Admin Directory tabs; verify exact tab routing based on current build behavior.
- Notification sound playback depends on browser autoplay policies; test with interaction established.
- Some backend authorization denials return `BadRequest` (400) instead of `403`; QA should validate **functional denial**, not only status semantics from network pane.

