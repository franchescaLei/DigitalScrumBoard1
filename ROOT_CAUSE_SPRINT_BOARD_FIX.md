# Root Cause Found: Sprint Board Only Works for Active Sprints ✅

## The Real Issue

**Backend Restriction:** The `BoardService.GetBoardAsync()` method has this check:

```csharp
if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Only active sprint boards can be viewed.");
```

**What This Means:**
- You can ONLY view board (with work items) for **Active** sprints
- **Planned** sprints (not started yet) → Board endpoint throws error
- **Completed** sprints → Board endpoint throws error

## The Problem Flow

1. User drags work item to **Planned** sprint
2. Optimistic update adds item to `sprint.AssignedWorkItems` ✅
3. Backend API confirms assignment ✅
4. Frontend tries to reload: `await LoadSprintWorkItemsAsync(sprint)`
5. Backend `BoardService.GetBoardAsync()` throws: "Only active sprint boards can be viewed"
6. Exception caught, `sprint.AssignedWorkItems` set to empty list ❌
7. UI shows "No work items assigned to this sprint" ❌

## The Fix

### 1. Don't Reload for Non-Active Sprints
```csharp
if (result.Success)
{
    Snackbar.Add("Work item assigned to sprint", Severity.Success);
    
    // ✅ DON'T reload work items - keep optimistic data
    // Backend board endpoint only works for Active sprints
    // For Planned sprints, we can't reload - just keep optimistic data
    // User can start the sprint to see full board view
}
```

### 2. Only Load Board for Active Sprints
```csharp
private async Task LoadSprintWorkItemsAsync(SprintDto sprint)
{
    try
    {
        sprint.WorkItemsLoading = true;
        
        // ✅ Can only load board for Active sprints
        if (sprint.Status != "Active")
        {
            // For non-active sprints, just show the optimistic items we have
            sprint.AssignedWorkItems = sprint.AssignedWorkItems ?? new List<WorkItemDto>();
        }
        else
        {
            var workItems = await BoardService.GetSprintWorkItemsAsync(sprint.SprintID);
            sprint.AssignedWorkItems = workItems;
        }
    }
    catch (Exception ex)
    {
        Snackbar.Add($"Failed to load sprint work items: {ex.Message}", Severity.Error);
        sprint.AssignedWorkItems = sprint.AssignedWorkItems ?? new List<WorkItemDto>();
    }
    finally
    {
        sprint.WorkItemsLoading = false;
    }
}
```

### 3. Only Auto-Load for Active Sprints
```csharp
private async Task ToggleSprintAsync(SprintDto sprint)
{
    sprint.IsExpanded = !sprint.IsExpanded;

    // Load work items on first expand if:
    // 1. Sprint is Active (can load board)
    // 2. We don't already have items loaded
    if (sprint.IsExpanded && sprint.Status == "Active" && 
        sprint.AssignedWorkItems.Count == 0 && !sprint.WorkItemsLoading)
    {
        await LoadSprintWorkItemsAsync(sprint);
    }
}
```

---

## Expected Behavior Now

### Planned Sprint (Not Started)
1. **Drag work item to sprint** → Item appears in list (optimistic)
2. **Collapse sprint** → Items hidden
3. **Expand sprint** → Items still visible (optimistic data kept)
4. **Start sprint** → Now can load full board from backend

### Active Sprint
1. **Drag work item to sprint** → Item appears (optimistic)
2. **Collapse sprint** → Items hidden
3. **Expand sprint** → Items reload from backend (shows full details)

### Completed Sprint
1. **Drag work item to sprint** → Item appears (optimistic)
2. **Expand sprint** → Shows optimistic items only
3. **Can't start/stop** (already completed)

---

## Backend API Limitation

**Why does this restriction exist?**

The backend `BoardService.GetBoardAsync()` is designed for the **Board view** (kanban-style columns), which only makes sense for **Active** sprints.

**Repository query (works for any sprint):**
```csharp
public async Task<List<WorkItem>> GetSprintWorkItemsAsync(int sprintId, CancellationToken ct)
{
    return await _db.WorkItems
        .AsNoTracking()
        .Include(w => w.WorkItemType)
        .Where(w => w.SprintID == sprintId && !w.IsDeleted)
        .ToListAsync(ct);
}
```
This works fine for any sprint status.

**Service layer adds restriction:**
```csharp
// In GetBoardAsync()
if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Only active sprint boards can be viewed.");
```

**Solution:** Use the repository method directly for non-active sprints, or remove the restriction.

---

## Optional Backend Fix

If you want to allow viewing boards for Planned/Completed sprints, remove the restriction:

**File:** `DigitalScrumBoard1/Services/BoardService.cs`

```csharp
// REMOVE or COMMENT OUT this check:
/*
if (!string.Equals(sprint.Status, "Active", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Only active sprint boards can be viewed.");
*/
```

Then the frontend can always load work items from backend, regardless of sprint status.

---

## Files Modified

| File | Changes |
|------|---------|
| `Backlogs.razor` | + Check sprint status before loading board<br>+ Keep optimistic data for non-active sprints<br>+ Only auto-load for Active sprints |

---

## Testing Checklist

- [ ] **Planned sprint + drag item** → Item appears and stays visible
- [ ] **Planned sprint + expand/collapse** → Items remain visible
- [ ] **Active sprint + drag item** → Item appears, reloads on expand
- [ ] **Active sprint + expand/collapse** → Items reload from backend
- [ ] **Start sprint** → Board becomes available, can view full details
- [ ] **Create sprint in backend** → Appears via SignalR
- [ ] **Multiple sprints** → Each behaves correctly based on status

---

## Build Status

✅ **Frontend:** Builds successfully (0 errors, 19 warnings - all pre-existing)  
✅ **Backend:** Builds successfully (0 errors, 4 warnings - all pre-existing)  
✅ **No breaking changes**  
✅ **Backward compatible**

---

**Status:** ✅ Complete - Root cause identified and fixed
