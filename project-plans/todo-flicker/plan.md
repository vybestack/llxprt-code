# Todo Panel Flicker Remediation Plan

## Problem Summary

The TodoPanel experiences flickering and size changes when tool calls are being tracked, particularly when consecutive tool calls are made. The panel briefly collapses after the first tool call completes and before the second one is displayed.

## Root Cause Analysis

### The Race Condition

1. **Dual State Problem**: Tool calls exist in two states:
   - **Executing** (in-memory): Tracked in `executingToolCalls` Map
   - **Completed** (persisted): Written to disk via TodoStore

2. **The Flicker Sequence**:
   - Tool call starts → Added to `executingToolCalls` → Panel renders correctly
   - Tool call completes → `completeToolCallTracking` is called
   - Tool call is removed from `executingToolCalls` 
   - `recordToolCall` writes to disk (async)
   - **RACE WINDOW**: Panel re-renders with NO tool calls (memory cleared, disk not updated yet)
   - Todo update event propagates from disk write
   - Panel re-renders again with tool call from disk
   - Visual result: Panel shrinks then expands = flicker

### Architectural Issues Discovered

1. **Unnecessary Persistence**: Tool calls are ephemeral - they only matter during the current session/task
2. **File I/O Overhead**: Every tool completion triggers:
   - Read current todos from disk
   - Update with new tool call
   - Write back to disk
   - Emit update event
   - Re-render entire TodoPanel
3. **Event Cascade**: Each disk write triggers multiple re-renders via TodoProvider
4. **Grouping Limitations**: Current `groupToolCalls` only groups consecutive identical calls

## Proposed Solution: In-Memory Tool Call Tracking

### Core Changes

1. **Remove Persistence**: Eliminate `recordToolCall` disk writes entirely
2. **Extend In-Memory Tracking**: Modify `executingToolCalls` Map to track both executing AND completed calls:
   ```typescript
   Map<sessionId, Map<todoId, {
     executing: Map<toolCallId, TodoToolCall>,
     completed: TodoToolCall[]
   }>>
   ```
3. **Keep Subscription System**: Use existing `notifySubscribers` for instant updates
4. **Session Lifecycle**: Tool calls naturally expire when session ends

### Benefits

- **No Flicker**: Eliminates race conditions from file I/O
- **Better Performance**: No disk writes per tool call
- **Simpler State Management**: Single source of truth (memory)
- **Natural Cleanup**: No stale tool calls persisted between sessions

## Implementation Steps

### Phase 1: Modify ToolCallTrackerService

1. Update `executingToolCalls` structure to include completed calls
2. Modify `completeToolCallTracking` to move calls from executing to completed in memory
3. Remove all calls to `store.writeTodos()` for tool calls
4. Update `getExecutingToolCalls` to return both executing and completed

### Phase 2: Update TodoPanel

1. Modify to read from the new in-memory structure
2. Remove distinction between executing and persisted tool calls
3. Ensure grouping works across all tool calls for a todo

### Phase 3: Clean Up

1. Remove tool call persistence from TodoStore
2. Remove `toolCalls` field from Todo schema (if no longer needed)
3. Update tests to reflect in-memory behavior

## Testing Strategy

1. Verify no flicker during rapid tool calls
2. Ensure tool calls appear immediately
3. Confirm grouping works (e.g., "Read 2x")
4. Test that tool calls clear when moving to new task
5. Verify no tool calls persist between sessions

## Success Criteria

- Zero visual flicker when tool calls execute
- Immediate display of tool calls (no delay)
- Proper grouping of consecutive identical calls
- Clean session boundaries (no persisted tool calls)
- Improved performance (no file I/O per tool call)