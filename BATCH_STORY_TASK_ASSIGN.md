# Batch Assign/Remove Stories with Child Tasks - Complete Implementation

## Summary
Updated the sprint assign/remove endpoints to automatically batch-process child tasks when a Story is assigned to or removed from a sprint. Notifications are sent to all affected assignees.

---

## Changes Made

### 1. Repository Layer

**File:** `Repositories/IWorkItemRepository.cs`
- ✅ Added `GetChildTasksByParentIdAsync(int parentId, CancellationToken ct)` method signature

**File:** `Repositories/WorkItemRepository.cs`
- ✅ Implemented `GetChildTasksByParentIdAsync` — returns all non-deleted child Tasks for a given parent Story, including `WorkItemType` and `AssignedUser` navigation properties

```csharp
public async Task<List<WorkItem>> GetChildTasksByParentIdAsync(int parentId, CancellationToken ct)
{
    return await _db.WorkItems
        .AsNoTracking()
        .Include(w => w.WorkItemType)
        .Include(w => w.AssignedUser)
        .Where(w => w.ParentWorkItemID == parentId && !w.IsDeleted)
        .ToListAsync(ct);
}
```

### 2. AssignToSprint Endpoint (Batch Assign)

**File:** `Controllers/WorkItemsController.cs`

**Behavior:**
1. Assigns the primary work item (Story or Task) to the sprint
2. **If the item is a Story:**
   - Fetches all child Tasks via `GetChildTasksByParentIdAsync`
   - Skips Tasks with `Status == "Completed"`
   - Assigns each remaining Task to the same sprint
   - Notifies each Task's assignee (if different from the acting user)
3. Sends all notifications in a single batch
4. Broadcasts `WorkItemAssignedToSprint` via SignalR with `childTaskIDs` array
5. Returns `childTasksAssigned` count in the response

**Notification Messages:**
- **Story assignee:** `"Work item '{StoryTitle}' was added to sprint '{SprintName}'."`
- **Task assignees:** `"Task '{TaskTitle}' was added to sprint '{SprintName}' (parent story '{StoryTitle}' was assigned)."`

**Response:**
```json
{
    "message": "Work item assigned to sprint successfully.",
    "workItemID": 123,
    "sprintID": 5,
    "childTasksAssigned": 3
}
```

### 3. RemoveFromSprint Endpoint (Batch Remove)

**File:** `Controllers/WorkItemsController.cs`

**Behavior:**
1. Removes the primary work item (Story or Task) from the sprint
2. **If the item is a Story:**
   - Fetches all child Tasks via `GetChildTasksByParentIdAsync`
   - Skips Tasks not in the same sprint (`task.SprintID != oldSprintId`)
   - Removes each matching Task from the sprint
   - Notifies each Task's assignee (if different from the acting user)
3. Logs audit entry with child task count
4. Sends all notifications in a single batch
5. Broadcasts `WorkItemRemovedFromSprint` via SignalR with `childTaskIDs` array
6. Returns `childTasksRemoved` count in the response

**Notification Messages:**
- **Story assignee:** `"Work item '{StoryTitle}' was removed from sprint '{SprintName}'."`
- **Task assignees:** `"Task '{TaskTitle}' was removed from sprint '{SprintName}' (parent story '{StoryTitle}' was removed)."`

**Response:**
```json
{
    "message": "Work item removed from sprint successfully.",
    "workItemID": 123,
    "childTasksRemoved": 3
}
```

### 4. SignalR Broadcast Payloads

**WorkItemAssignedToSprint:**
```json
{
    "workItemID": 123,
    "title": "Story Title",
    "status": "Todo",
    "assignedUserID": 5,
    "sprintID": 5,
    "sprintName": "Sprint 1",
    "childTaskIDs": [124, 125, 126],
    "changedAt": "2026-04-07T10:30:00"
}
```

**WorkItemRemovedFromSprint:**
```json
{
    "workItemID": 123,
    "title": "Story Title",
    "oldSprintID": 5,
    "oldSprintName": "Sprint 1",
    "childTaskIDs": [124, 125, 126],
    "changedAt": "2026-04-07T10:30:00"
}
```

---

## Authorization

Both endpoints enforce `CanManageSprint(userId, sprint.ManagedBy)` which checks:
- **Elevated roles:** `Administrator`, `Scrum Master`
- **Resource owner:** User whose `UserID` matches `sprint.ManagedBy`

All unauthorized users receive `403 Forbidden`.

---

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Story assigned, child task already in sprint | Task is not re-assigned (idempotent via `AssignToSprintAsync`) |
| Story assigned, child task is Completed | Task is skipped (not assigned to sprint) |
| Story removed, child task in different sprint | Task is skipped (only removes tasks from the same sprint) |
| Story removed, child task has no assignee | No notification sent for that task |
| Acting user is the assignee | No self-notification sent |
| Work item is a Task (not a Story) | Only that single Task is assigned/removed — no batch processing |

---

## Database Operations

All operations use Entity Framework Core tracking:
- `GetTrackedByIdAsync` — retrieves tracked entity for modification
- `AssignToSprintAsync` — sets `SprintID` and saves
- `RemoveFromSprintAsync` — sets `SprintID = null` and saves
- `SaveChangesAsync` — committed after each operation

Notifications and audit logs are batch-inserted where possible.

---

## Frontend Impact

The existing frontend calls these endpoints without modification needed. The `childTaskIDs` array in the SignalR payload can be used by the frontend to:
1. Optimistically update child task sprint assignments
2. Show a toast like `"Story + 3 tasks added to sprint"`
3. Refresh the expanded sprint list to reflect all changes

No frontend changes are required for the core functionality to work — the batch operations happen entirely on the backend.

---

## Files Modified

| File | Change |
|------|--------|
| `IWorkItemRepository.cs` | Added `GetChildTasksByParentIdAsync` signature |
| `WorkItemRepository.cs` | Implemented `GetChildTasksByParentIdAsync` |
| `WorkItemsController.cs` | Rewrote `AssignToSprint` and `RemoveFromSprint` with batch logic |

---

## Testing Checklist

- [x] Backend builds successfully
- [x] Story assignment cascades to child tasks
- [x] Completed tasks are skipped during batch assign
- [x] Task assignment only affects that single task
- [x] Story removal cascades to child tasks in same sprint
- [x] Tasks in different sprints are not affected
- [x] Notifications sent to all affected assignees
- [x] No self-notifications (acting user not notified)
- [x] Audit log includes child task count
- [x] SignalR broadcast includes childTaskIDs array
- [x] Authorization enforced (Sprint Manager / Admin / Scrum Master only)
- [x] Response includes child task count

---

## Goal Achieved ✅

When a Story is assigned to a sprint, **all child Tasks follow automatically**. When a Story is removed, **all child Tasks in that sprint are removed too**. Every affected assignee receives a notification. The frontend receives real-time updates via SignalR with full context of what changed.
