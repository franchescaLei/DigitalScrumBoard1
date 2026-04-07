# Role-Based Access Control (RBAC) — Digital Scrum Board

## Overview

The Digital Scrum Board implements a **least-privilege, role-hierarchical RBAC system** with four distinct user tiers. Permissions are enforced at **both the backend API level and the frontend UI level**, ensuring defense-in-depth.

---

## Role Hierarchy

```
┌─────────────────────────────────────────────────┐
│  1. Administrator (global elevated role)        │
│     └─ Full system access                       │
├─────────────────────────────────────────────────┤
│  2. Scrum Master (global elevated role)         │
│     └─ Full project management access           │
├─────────────────────────────────────────────────┤
│  3. Sprint Owner (scoped elevated role)         │
│     └─ Manages ONE specific sprint              │
│     └─ Permissions limited to that sprint only  │
├─────────────────────────────────────────────────┤
│  4. Regular User (no elevated privileges)       │
│     └─ Can only act on items they are assigned  │
│     └─ Can create child tasks under assigned    │
│         Stories or child stories/tasks under    │
│         assigned Epics                          │
└─────────────────────────────────────────────────┘
```

---

## Role Definitions

### 1. Administrator
- **Role Name:** `Administrator`
- **Scope:** Global — all sprints, all work items, all settings
- **Key Capability:** Everything

### 2. Scrum Master
- **Role Name:** `Scrum Master` or `ScrumMaster` (both accepted)
- **Scope:** Global — all sprints, all work items
- **Key Capability:** Everything except system-level admin settings (reserved for Administrator role on admin pages)

### 3. Sprint Owner (Scoped Elevated User)
- **Not a role name** — determined by data: `Sprint.ManagedBy == currentUserId`
- **Scope:** Limited to the specific sprint(s) they manage
- **Key Capability:** Full sprint management + work item editing within their sprint
- **Cannot:** Change priority, create/delete sprints, access system settings, modify other sprints

### 4. Regular User (Assigned User)
- **Not a role name** — determined by data: `WorkItem.AssignedUserID == currentUserId`
- **Scope:** Limited to specific work items they are assigned to
- **Key Capability:** Update status, edit title/description, add comments, create child tasks
- **Cannot:** Change priority, assign/unassign users, remove items from sprint, manage sprints

---

## Permission Matrix

### Work Item Operations

| Action | Admin | Scrum Master | Sprint Owner | Assignee | Regular User |
|--------|:-----:|:------------:|:------------:|:--------:|:------------:|
| **Create Epic** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Create Story** (with Epic parent) | ✅ | ✅ | ❌ | Epic assignee | ❌ |
| **Create Task** (with Story parent) | ✅ | ✅ | ❌ | Story assignee | ❌ |
| **Create Task** (with Epic parent) | ✅ | ✅ | ❌ | Epic assignee | ❌ |
| **Create orphan Story/Task** (no parent) | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Edit Title** | ✅ | ✅ | ✅ (own sprint) | ✅ | ❌ |
| **Edit Description** | ✅ | ✅ | ✅ (own sprint) | ✅ | ❌ |
| **Edit Priority** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Edit Due Date** | ✅ | ✅ | ✅ (own sprint) | ✅ | ❌ |
| **Edit Status** | ✅ | ✅ | ✅ (own sprint) | ✅ | ❌ |
| **Change Assignee** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Clear Assignee** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Change Team** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Delete Work Item** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Add Comment** | ✅ | ✅ | ✅ (own sprint) | ✅ | ❌ |
| **Edit Own Comment** | ❌ (author only) | ❌ (author only) | ❌ (author only) | ❌ (author only) | ❌ (author only) |
| **Delete Any Comment** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Delete Own Comment** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **View Any Work Item** | ✅ | ✅ | ✅ | ✅ | ✅ |

### Sprint Operations

| Action | Admin | Scrum Master | Sprint Owner | Assignee | Regular User |
|--------|:-----:|:------------:|:------------:|:--------:|:------------:|
| **Create Sprint** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Edit Sprint** (name, goal, dates) | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Change Sprint Manager** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Start Sprint** | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Stop Sprint** | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Complete Sprint** | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Delete Sprint** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Assign WI to Sprint** (drag-drop) | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Remove WI from Sprint** | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **Batch assign Story+Tasks to Sprint** | ✅ | ✅ | ✅ (own sprint) | ❌ | ❌ |
| **View Sprint** | ✅ | ✅ | ✅ | ✅ | ✅ |

### System Operations

| Action | Admin | Scrum Master | Sprint Owner | Assignee | Regular User |
|--------|:-----:|:------------:|:------------:|:--------:|:------------:|
| **View Audit Logs** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Manage Users** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Manage Teams** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Manage Roles** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **View Notifications** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **View Boards** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **View Backlogs** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Special Rules

### Child Work Item Creation (Least Privilege)

A regular user assigned to a **Story** can:
- Create **Tasks** that are children of that Story (`ParentWorkItemID = Story.WorkItemID`)
- Only if `Story.AssignedUserID == currentUserId`

A regular user assigned to an **Epic** can:
- Create **Stories** that are children of that Epic (`ParentWorkItemID = Epic.WorkItemID`)
- Create **Tasks** that are children of that Epic (`ParentWorkItemID = Epic.WorkItemID`)
- Only if `Epic.AssignedUserID == currentUserId`

This allows assigned users to decompose their own work without needing elevated privileges.

### Sprint Owner Limitations

Sprint Owners are explicitly **blocked** from:
- ❌ Changing work item priority (reserved for Admin/Scrum Master)
- ❌ Deleting their own sprint (reserved for Admin/Scrum Master)
- ❌ Creating new sprints
- ❌ Changing assignee/team on work items
- ❌ Accessing any sprint other than the ones they manage

### Batch Operations

When a **Story** is assigned to or removed from a sprint:
- All child **Tasks** are automatically batch-assigned/batch-removed
- Notifications are sent to all affected task assignees
- The operation requires `CanManageSprint` permission (Admin/SM/Sprint Owner)

### Comment Ownership

- Only the **comment author** can edit their own comment (no elevated role bypass for edits)
- **Admin/Scrum Master** can delete any comment, but cannot edit others' comments
- This asymmetry is intentional: delete is a moderation action, edit is content authorship

---

## Backend Enforcement

### Key Methods

| Method | File | Purpose |
|--------|------|---------|
| `IsElevatedSprintRole()` | `SprintsController.cs`, `WorkItemsController.cs` | Checks `User.IsInRole("Administrator") \|\| User.IsInRole("Scrum Master") \|\| User.IsInRole("ScrumMaster")` |
| `IsElevatedWorkItemRole()` | `WorkItemsController.cs` | Same as above |
| `CanManageSprint(userId, sprintManagedBy)` | Both controllers | Returns `true` if elevated role OR `userId == sprintManagedBy` |
| `CanManageWorkItem(userId, assignedUserId)` | `WorkItemsController.cs` | Returns `true` if elevated role OR `userId == assignedUserId` |

### Endpoints with Role Checks

| Endpoint | Method | Auth Gate |
|----------|--------|-----------|
| `POST /api/workitems` | Create | `IsElevatedWorkItemRole()` OR parent ownership (Story/Epic assignee) |
| `PATCH /api/workitems/{id}` | Update | `isElevated \|\| isOwner \|\| isSprintOwner`; priority/assignee changes require `isElevated` |
| `PUT /api/workitems/{id}/status` | Update Status | `CanManageWorkItem()` OR `CanManageSprint()` (if in sprint) |
| `PUT /api/workitems/{id}/assign-sprint` | Assign to Sprint | `CanManageSprint()` — includes batch child assignment |
| `PUT /api/workitems/{id}/remove-sprint` | Remove from Sprint | `CanManageSprint()` — includes batch child removal |
| `DELETE /api/workitems/{id}` | Soft Delete | `[Authorize(Roles="Administrator,Scrum Master,ScrumMaster")]` |
| `POST /api/sprints` | Create Sprint | `IsElevatedSprintRole()` |
| `PATCH /api/sprints/{id}` | Update Sprint | `CanManageSprint()`; changing `ManagedBy` requires `IsElevatedSprintRole()` |
| `DELETE /api/sprints/{id}` | Delete Sprint | `IsElevatedSprintRole()` **only** (Sprint Owners cannot delete) |

---

## Frontend Enforcement

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `isElevatedWorkspaceRole(user)` | `userProfile.ts` | Checks `roleName` against Administrator/Scrum Master/ScrumMaster |
| `canManageSprint(me, sprint)` | `planningUtils.ts` | Returns `true` if elevated role OR `me.userID === sprint.managedBy` |

### UI Gates

| UI Element | Gate | Effect |
|-----------|------|--------|
| Add Item → "Create Epic" | `canCreateEpic = isAdminOrSM` | Hidden for non-Admin/SM |
| Add Item → "Create Work Item" | `canCreateWorkItem = isAdminOrSM` | Hidden for non-Admin/SM |
| Add Item → "Create Sprint" | `canCreateSprint = isAdminOrSM` | Hidden for non-Admin/SM |
| Sprint drop zone (drag-and-drop) | `canManageSprint(me, sprint)` | Disabled for non-managers |
| Sprint lifecycle buttons | `canManageSprint(me, sprint)` | Hidden/disabled for non-managers |
| "Remove from Sprint" button | `canManageSprint(me, sprint)` | Hidden for non-managers |
| "+ Assign" link (unassigned items) | `canManageSprint(me, sprint)` | Hidden for non-managers |
| WorkItemDetailModal → Edit button | `canEdit = isAdminOrSM \|\| isOwner \|\| isSprintOwner` | Hidden for unauthorized |
| WorkItemDetailModal → Priority select | `canManage = isAdminOrSM` | Read-only for non-Admin/SM |
| WorkItemDetailModal → Assignee picker | `canManage = isAdminOrSM` | Read-only for non-Admin/SM |
| WorkItemDetailModal → Team picker | `canManage = isAdminOrSM` | Read-only for non-Admin/SM |
| WorkItemDetailModal → Comment composer | `canEdit = isAdminOrSM \|\| isOwner \|\| isSprintOwner` | Hidden for unauthorized |
| Confirmation modals (drag/remove Story) | Always shown when action triggered | User confirms before backend call |

---

## Error Responses

| Scenario | HTTP Status | Message |
|----------|:-----------:|---------|
| Non-elevated user creates Epic | 400 | "Only Administrators and Scrum Masters can create Epics." |
| Non-assignee creates Task under Story | 403 | "Only the Story assignee or Administrators/Scrum Masters can create tasks under this Story." |
| Non-elevated user changes priority | 403 | "Only administrators and scrum masters can change priority." |
| Non-elevated user changes assignee | 403 | "Only administrators and scrum masters can change assignee or team." |
| Non-owner/non-Manager updates WI | 403 | `Forbid()` |
| Sprint Owner deletes sprint | 400 | "You do not have permission to delete this sprint. Only Administrators and Scrum Masters can delete sprints." |
| Non-manager assigns WI to sprint | 403 | `Forbid()` |
| Comment by non-assignee/non-manager | 403 | "Only administrators, scrum masters, or the work item's assignee can comment." |

---

## Audit Trail

All sensitive operations are logged via `AuditLog`:
- Work item create/update/delete/status change
- Sprint create/update/delete/lifecycle
- Authorization failures (unauthorized attempts)
- IP address, timestamp, user ID, target type/ID, details

---

## Real-Time Notifications

When work items are assigned/removed from sprints, affected users receive notifications:
- **Assignee notified:** "You were assigned to work item '{title}'."
- **Task assignees notified (batch):** "Task '{title}' was added to sprint '{sprint}' (parent story '{story}' was assigned)."
- **Removal notified:** "Work item '{title}' was removed from sprint '{sprint}'."
- SignalR broadcasts `WorkItemAssignedToSprint` and `WorkItemRemovedFromSprint` with `childTaskIDs` array

---

## Files Modified for RBAC

### Backend
| File | Change |
|------|--------|
| `WorkItemsController.cs` | Create: parent ownership auth; Patch: Sprint Owner + priority block; Remove: batch child removal |
| `SprintsController.cs` | Delete: elevated role only (removed Sprint Owner) |
| `WorkItemRepository.cs` | Added `GetChildTasksByParentIdAsync` |
| `IWorkItemRepository.cs` | Added `GetChildTasksByParentIdAsync` signature |
| `WorkItemDetailsResponseDto.cs` | Added `SprintID`, `SprintName` |
| `UpdateWorkItemRequestDto.cs` | Added `ClearAssignee` flag |

### Frontend
| File | Change |
|------|--------|
| `BacklogsPage.tsx` | AddItemMenu gating, Sprint Owner in modal, drag/remove confirmation |
| `WorkItemDetailModal.tsx` | Priority gated on `canManage`, `sprintName` display, `WorkItemDetails` type updated |
| `AddItemMenu.tsx` | `canCreateEpic`, `canCreateWorkItem`, `canCreateSprint` props |
| `planning.ts` | Added `sprintID`, `sprintName` to `WorkItemDetails` |
| `backlogs.css` | Confirmation modal styles, compact row styles |

---

## Design Principles

1. **Defense in Depth:** Every permission is enforced on both frontend (UI hiding) and backend (API authorization)
2. **Least Privilege:** Regular users can only act on items they own (are assigned to)
3. **Scoped Elevation:** Sprint Owners get elevated permissions only within their sprint boundary
4. **Explicit Deny:** What is not explicitly allowed is denied
5. **Audit Everything:** All mutations and authorization failures are logged
6. **No Silent Failures:** Unauthorized requests return clear error messages
