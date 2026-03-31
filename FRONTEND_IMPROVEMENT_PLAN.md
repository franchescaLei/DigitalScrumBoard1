# Frontend Analysis & Improvement Plan

## Current Issues Identified

### 1. **SignalR Over-Engineering** ⚠️
**Problem:** Backlogs.razor has duplicate SignalR handling:
- Direct `HubConnection.On()` subscriptions in `OnInitializedAsync()`
- Separate `SignalRService` already exists but isn't being used
- Every SignalR event triggers full `LoadSprintsAsync()` + `LoadBacklogItemsAsync()` + `LoadEpicsAsync()`
- Causes unnecessary re-fetching and UI flicker

**Current Code:**
```csharp
HubConnection.On("SprintUpdated", async () => { 
    await InvokeAsync(StateHasChanged); 
    await LoadSprintsAsync(); 
    await LoadBacklogItemsAsync(); 
});
```

**Issue:** This reloads EVERYTHING for ANY change.

---

### 2. **Drag-and-Drop UX Issues** 🎯
**Problems:**
- No visual feedback during drag (only shows on sprint hover)
- `IsDragOverSprint` is a single boolean - can't track which sprint is being hovered
- Drop handler assigns to sprint but doesn't update UI optimistically
- Full reload after drop instead of targeted list update
- No indication of which item is being dragged

---

### 3. **Missing Collapsible Sprint List** 📋
**Requirement:** Sprint rows should expand/collapse to show assigned work items:
```
▼ Sprint 1 (Active)
  ├─ WorkItem 1 - John Doe [Change Assignee]
  ├─ WorkItem 2 - Unassigned [Add Assignee]
  └─ WorkItem 3 - Jane Smith [Change Assignee]
▶ Sprint 2 (Planned)
```

---

### 4. **API Call Inefficiency** 🔄
**Current behavior:**
- `LoadSprintsAsync()` calls `GetAllSprintsAsync()` which returns paginated response
- Frontend ignores pagination and just takes `.Items`
- No caching - every SignalR event triggers fresh API call
- `StateHasChanged()` called multiple times unnecessarily

---

### 5. **Redundant StateHasChanged Calls** 🔁
**Pattern seen throughout:**
```csharp
_backlogLoading = true;
await InvokeAsync(StateHasChanged);  // ← Unnecessary

_backlogItems = await EpicService.GetBacklogItemsAsync();

_backlogLoading = false;
await InvokeAsync(StateHasChanged);  // ← Blazor auto-triggers on state change
```

---

## Proposed Improvements

### 1. **Use SignalRService Properly** ✅
Replace direct HubConnection subscriptions with SignalRService event handlers that do **targeted updates**:

```csharp
// Instead of reloading everything:
_signalR.WorkItemAssignedToSprint += (e) => {
    // Just move the item from backlog to that sprint's list
    var item = _backlogItems.FirstOrDefault(x => x.WorkItemID == e.WorkItemID);
    if (item != null) {
        _backlogItems.Remove(item);
        var sprint = _sprints.FirstOrDefault(s => s.SprintID == e.SprintID);
        if (sprint != null) {
            sprint.StoryCount++; // or TaskCount based on type
        }
        StateHasChanged();
    }
};
```

---

### 2. **Improved Drag-and-Drop** 🎨
**Track which sprint is being hovered:**
```csharp
private int? _dragOverSprintId;

private void HandleDragOverSprint(int sprintId)
{
    _dragOverSprintId = sprintId;
    StateHasChanged();
}

private void HandleDragLeaveSprint(int sprintId)
{
    if (_dragOverSprintId == sprintId)
        _dragOverSprintId = null;
    StateHasChanged();
}
```

**Visual feedback:**
```razor
<div class="sprint-item @(_dragOverSprintId == sprint.SprintID ? "drag-over" : "")"
     @ondrop="@(e => OnDropToSprintAsync(sprint.SprintID))"
     @ondragover="@(e => HandleDragOverSprint(sprint.SprintID))"
     @ondragleave="@(e => HandleDragLeaveSprint(sprint.SprintID))">
```

---

### 3. **Collapsible Sprint List** 📦
**Add to SprintDto:**
```csharp
public bool IsExpanded { get; set; }
public List<WorkItemDto> AssignedWorkItems { get; set; } = new();
```

**Toggle method:**
```csharp
private async Task ToggleSprintAsync(SprintDto sprint)
{
    sprint.IsExpanded = !sprint.IsExpanded;
    
    if (sprint.IsExpanded && sprint.AssignedWorkItems.Count == 0)
    {
        // Load work items for this sprint on first expand
        sprint.AssignedWorkItems = await _boardService.GetSprintWorkItemsAsync(sprint.SprintID);
    }
    
    StateHasChanged();
}
```

**UI structure:**
```razor
@foreach (var sprint in _sprints)
{
    <!-- Sprint Header (clickable) -->
    <div class="sprint-header" @onclick="() => ToggleSprintAsync(sprint)">
        <MudIcon Icon="@(sprint.IsExpanded ? Icons.Material.Filled.ExpandMore : Icons.Material.Filled.ChevronRight)" />
        <span>@sprint.SprintName</span>
        <span class="badge">@sprint.AssignedWorkItems.Count items</span>
    </div>
    
    <!-- Expanded Work Items -->
    @if (sprint.IsExpanded)
    {
        <div class="sprint-workitems">
            @foreach (var item in sprint.AssignedWorkItems)
            {
                <div class="workitem-row">
                    <span>@item.Title</span>
                    <span>@(item.AssignedUserName ?? "Unassigned")</span>
                    <MudButton OnClick="() => OpenAssigneeDialog(item)">
                        @(item.AssignedUserID.HasValue ? "Change" : "Add") Assignee
                    </MudButton>
                </div>
            }
        </div>
    }
}
```

---

### 4. **Optimistic Updates for Drag-Drop** ⚡
**Instead of waiting for API then reloading:**
```csharp
private async Task OnDropToSprintAsync(int sprintId)
{
    if (_draggedItem == null) return;
    
    var sprint = _sprints.FirstOrDefault(s => s.SprintID == sprintId);
    if (sprint == null) return;
    
    // OPTIMISTIC: Remove from backlog immediately
    _backlogItems.Remove(_draggedItem);
    
    // Update sprint count optimistically
    if (_draggedItem.TypeName == "Story")
        sprint.StoryCount++;
    else
        sprint.TaskCount++;
    
    StateHasChanged(); // UI updates immediately
    
    try
    {
        var result = await _workItemService.AssignWorkItemToSprintAsync(_draggedItem.WorkItemID, sprintId);
        
        if (!result.Success)
        {
            // ROLLBACK on failure
            _backlogItems.Add(_draggedItem);
            if (_draggedItem.TypeName == "Story")
                sprint.StoryCount--;
            else
                sprint.TaskCount--;
            
            Snackbar.Add(result.ErrorMessage, Severity.Error);
        }
        else
        {
            Snackbar.Add("Work item assigned to sprint", Severity.Success);
        }
    }
    catch (Exception ex)
    {
        // ROLLBACK on error
        _backlogItems.Add(_draggedItem);
        if (_draggedItem.TypeName == "Story")
            sprint.StoryCount--;
        else
            sprint.TaskCount--;
        
        Snackbar.Add($"Error: {ex.Message}", Severity.Error);
    }
    finally
    {
        _draggedItem = null;
        _dragOverSprintId = null;
        StateHasChanged();
    }
}
```

---

### 5. **Remove Redundant StateHasChanged** ✂️
**Clean pattern:**
```csharp
private async Task LoadBacklogItemsAsync()
{
    try
    {
        _backlogLoading = true;
        _backlogItems = await _epicService.GetBacklogItemsAsync();
    }
    catch (Exception ex)
    {
        Snackbar.Add($"Failed to load backlog items: {ex.Message}", Severity.Error);
    }
    finally
    {
        _backlogLoading = false;
        // Blazor auto-triggers render on state change
    }
}
```

---

## Implementation Priority

### Phase 1: Quick Wins (Minimal Changes)
1. ✅ Remove redundant `InvokeAsync(StateHasChanged)` calls
2. ✅ Fix drag-and-drop to track individual sprint hover
3. ✅ Add optimistic updates for drag-to-sprint

### Phase 2: Collapsible Sprints
1. ✅ Add `IsExpanded` and `AssignedWorkItems` to SprintDto
2. ✅ Add `ToggleSprintAsync()` method
3. ✅ Add `GetSprintWorkItemsAsync()` to BoardService
4. ✅ Update UI with expandable sprint rows

### Phase 3: SignalR Optimization
1. ✅ Replace direct HubConnection subscriptions with SignalRService
2. ✅ Implement targeted list updates instead of full reloads
3. ✅ Add proper event unsubscribe on dispose

---

## Backend API Check

Need to verify backend supports:
- ✅ `GET /api/boards/{sprintId}` - Returns board with work items by status
- Need: `GET /api/sprints/{id}/workitems` - Get work items for specific sprint

**Alternative:** Use existing board endpoint and extract work items from columns.

---

## Files to Modify

1. **Backlogs.razor** - Main changes (drag-drop, collapsible sprints, SignalR)
2. **Backlogs.razor.css** - Add styles for expanded sprints, work item rows
3. **Models/ApiDto.cs** - Add `IsExpanded` to `SprintDto`
4. **Services/BoardService.cs** - Add `GetSprintWorkItemsAsync()`
5. **Services/WorkItemService.cs** - Already has assign/remove sprint methods

---

## Expected Behavior After Changes

### Real-time Updates
- Work item assigned → Only backlog list and target sprint updates (not full page reload)
- Sprint started → Only that sprint's status badge changes
- Work item moved on board → Board page updates, backlog unaffected

### Drag-and-Drop
- Clear visual feedback showing which sprint will receive the item
- Immediate UI feedback on drop (item disappears from backlog)
- Rollback visual if API fails
- No full page reload

### Collapsible Sprints
- Click sprint → Expands to show assigned work items
- Click again → Collapses
- Work items show: Title, Assignee, [Change/Add] Assignee button
- Smooth animation on expand/collapse

---

**Next Step:** Implement Phase 1 & 2 changes with minimal code disruption.
