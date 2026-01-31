# Phase 09: Task Tool Async Mode - Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P09`

## Prerequisites
- Required: Phase 08a completed
- Verification: `ls project-plans/20260130issue244/.completed/P08a.md`
- Pseudocode: `analysis/pseudocode/task-tool-async.md`

## Requirements Implemented

### REQ-ASYNC-005: Async Parameter
**Full Text**: The Task tool MUST accept an optional `async` parameter that launches subagent without blocking.
**Behavior**:
- GIVEN: Task tool called with `async=true`
- WHEN: Subagent is launched
- THEN: Tool returns immediately with launch status; subagent runs in background
**Why This Matters**: Enables non-blocking subagent execution for parallel work patterns.

### REQ-ASYNC-006: Async Through Scheduler
**Full Text**: Async tasks MUST go through the same tool scheduler and UI display as sync tasks.
**Behavior**:
- GIVEN: An async task is launched
- WHEN: Task executes
- THEN: UI shows same progress display as sync task; scheduler manages execution
**Why This Matters**: Consistent UX - async tasks aren't "invisible background" operations.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/task.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P09`
  - MUST include: `@requirement REQ-ASYNC-005, REQ-ASYNC-006`
  - Add `async?: boolean` to TaskToolParams
  - Add `async` to schema properties
  - Add async-specific logic stubs in TaskToolInvocation

### Required Changes

1. **TaskToolParams** (around line 37):
```typescript
export interface TaskToolParams {
  // ... existing params ...
  async?: boolean;  // NEW
}
```

2. **TaskToolInvocationParams** (around line 56):
```typescript
interface TaskToolInvocationParams {
  // ... existing params ...
  async: boolean;  // NEW
}
```

3. **TaskToolDependencies** (around line 65):
```typescript
export interface TaskToolDependencies {
  // ... existing deps ...
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;  // NEW
}
```

4. **Schema** (around line 654):
```typescript
properties: {
  // ... existing properties ...
  async: {
    type: 'boolean',
    description: 'If true, launch subagent in background and return immediately. Default: false (blocking).',
  },
}
```

5. **normalizeParams** (around line 738):
```typescript
private normalizeParams(params: TaskToolParams): TaskToolInvocationParams {
  // ... existing normalization ...
  return {
    // ... existing fields ...
    async: params.async ?? false,  // NEW
  };
}
```

6. **execute method** - stub async branch (around line 204):
```typescript
// At start of execute method, after initial checks:
if (this.normalized.async) {
  // @plan PLAN-20260130-ASYNCTASK.P09
  // Async mode - stub for now
  throw new Error('NotYetImplemented: async mode');
}
// Rest of existing sync implementation...
```

## Verification Commands

```bash
# Check async parameter added to params interface
grep -n "async.*boolean" packages/core/src/tools/task.ts

# Check schema updated
grep -A 5 '"async"' packages/core/src/tools/task.ts

# Check plan marker
grep -n "@plan PLAN-20260130-ASYNCTASK.P09" packages/core/src/tools/task.ts

# Check stub exists
grep -n "NotYetImplemented.*async" packages/core/src/tools/task.ts

# TypeScript compiles
npm run typecheck

# Existing tests still pass (sync mode unchanged)
npm test -- packages/core/src/tools/task.test.ts
```

## Success Criteria

- [ ] async parameter added to TaskToolParams
- [ ] async added to schema with description
- [ ] Async branch stub exists in execute
- [ ] TypeScript compiles
- [ ] Existing sync tests pass
- [ ] Plan/requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P09.md`
