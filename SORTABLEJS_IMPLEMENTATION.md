# SortableJS Drag-and-Drop Implementation - IN PROGRESS

## Why We're Switching Libraries

### Problems with HTML5 Drag Events
The current implementation using native HTML5 drag events (`@ondragenter`, `@ondragover`, `@ondragleave`, `@ondrop`) has fundamental issues:

1. **`dragleave` fires on child elements** - When dragging over icons, chips, or text inside a sprint row, the event fires as if you left the parent
2. **Inconsistent browser behavior** - Different browsers handle drag events differently
3. **Complex event management** - Requires manual tracking of `_dragOverSprintId` state
4. **Flickering highlights** - Sprint highlights turn on/off rapidly when dragging over nested elements
5. **Stale highlights** - Highlight remains after drag ends without proper cleanup

### Solution: SortableJS
**SortableJS** is a mature JavaScript library (25k+ GitHub stars, 10+ years old) that:
- ✅ Uses mouse/touch events instead of HTML5 drag events (more reliable)
- ✅ Handles nested lists perfectly
- ✅ Provides smooth visual feedback out-of-the-box
- ✅ Works consistently across all browsers
- ✅ Lightweight (18KB gzipped)
- ✅ No external dependencies

---

## Implementation Status

### ✅ Completed
1. **Created JS module** (`wwwroot/js/sortable-dragdrop.js`)
   - Handles drag initialization for backlog items
   - Manages sprint drop zone highlighting
   - Provides clean Blazor callbacks via `DotNetObjectReference`

2. **Created C# service wrapper** (`Services/DragDropService.cs`)
   - `DragDropService` - Manages JSInterop lifecycle
   - `DragDropCallbacks` - Type-safe callbacks from JS to Blazor
   - `DragDropInterop` - Handles JS invocations

3. **Registered service** (`Program.cs`)
   ```csharp
   builder.Services.AddScoped<DragDropService>();
   ```

4. **Updated markup** (`Backlogs.razor`)
   - Added `data-workitem-id` and `data-workitem-type` attributes to backlog items
   - Added `data-sprint-id` to sprint drop targets
   - Removed HTML5 drag event handlers (`@ondragstart`, `@ondragover`, etc.)

### ⚠️ Needs Completion
1. **Clean up duplicate markup** - There's duplicate backlog rendering code that needs to be removed
2. **Initialize DragDropService** - Need to call `DragDropService.InitializeAsync()` in `OnInitializedAsync()`
3. **Implement callbacks** - Wire up `OnDragEnd` and `OnDropToSprint` callbacks
4. **Dispose service** - Call `DragDropService.DisposeAsync()` in component disposal
5. **Update CSS** - Ensure `.drag-over-target` styles work with new approach

---

## Next Steps to Complete

### 1. Clean Up Backlogs.razor Markup
Remove the duplicate backlog rendering section (lines ~400-418).

### 2. Initialize DragDropService in OnInitializedAsync
```csharp
protected override async Task OnInitializedAsync()
{
    // ... existing auth check ...
    
    await LoadSprintsAsync();
    await LoadEpicsAsync();
    await LoadBacklogItemsAsync();
    
    // ✅ Initialize drag-and-drop
    await DragDropService.InitializeAsync(new DragDropCallbacks
    {
        OnDragEnd = () => Task.Run(() => {
            _dragOverSprintId = null;
            _draggedItem = null;
            InvokeAsync(StateHasChanged);
        }),
        OnDropToSprint = (workItemId, sprintId) => OnDropToSprintFromJS(workItemId, sprintId)
    });
    
    // ... SignalR setup ...
}
```

### 3. Create OnDropToSprintFromJS Method
```csharp
private async Task OnDropToSprintFromJS(int workItemId, int sprintId)
{
    // This replaces the old OnDropToSprintAsync
    // Same logic, but called from JS instead of Blazor event handler
    await OnDropToSprintAsync(workItemId, sprintId);
}
```

### 4. Dispose DragDropService
```csharp
public async ValueTask DisposeAsync()
{
    if (DragDropService != null)
    {
        await DragDropService.DisposeAsync();
    }
}
```

### 5. Remove Old Drag Handler Methods
These are no longer needed:
- `OnDragStart()`
- `OnDragOverSprint()`
- `OnDragLeaveSprint()`
- `HandleDragEnd()`

The JS library handles all of this now.

---

## Expected Behavior After Completion

| Scenario | Before (HTML5) | After (SortableJS) |
|----------|----------------|-------------------|
| **Drag over sprint** | Delayed, flickers | ✅ Instant, stable |
| **Drag over child elements** | Highlight flickers | ✅ No flicker |
| **Drag away** | Highlight may stick | ✅ Clears immediately |
| **Multiple sprints** | Unstable | ✅ Only current highlights |
| **Drop** | May not register | ✅ Reliable |
| **Cancel drag** | Highlight remains | ✅ Always clears |
| **Touch devices** | Poor support | ✅ Full touch support |

---

## Files Modified

| File | Status |
|------|--------|
| `wwwroot/js/sortable-dragdrop.js` | ✅ Created |
| `Services/DragDropService.cs` | ✅ Created |
| `Program.cs` | ✅ Updated |
| `Backlogs.razor` | ⚠️ Partially updated (needs cleanup) |
| `Backlogs.razor.css` | ✅ No changes needed (styles compatible) |

---

## Build Status

⚠️ **Current Status:** Builds with warnings, needs completion of integration

**Next:** Complete the integration steps above to finish the migration.

---

**Priority:** HIGH - This fixes all the drag-and-drop reliability issues in one clean refactor.
