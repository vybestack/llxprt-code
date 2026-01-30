# Phase 21: Settings Integration

## Phase ID
`PLAN-20260130-ASYNCTASK.P21`

## Prerequisites
- Required: Phase 20a completed

## Requirements Implemented

### REQ-ASYNC-012: task-max-async Setting
**Full Text**: User MUST be able to configure max concurrent async tasks via `/set task-max-async <num>`.
**Behavior**:
- GIVEN: User types `/set task-max-async 10`
- WHEN: Setting applied
- THEN: AsyncTaskManager limit is updated; new limit enforced on subsequent launches
**Why This Matters**: User control over resource usage.

## Implementation Tasks

### Files to Modify

1. **Settings Definition**
   - Find where ephemeral settings are defined
   - Add `task-max-async` setting
   - Default: 5, Range: -1 to 100

2. **Settings Handler**
   - Hook up setting changes to AsyncTaskManager.setMaxAsyncTasks()

### Research Existing Patterns

```bash
# Find settings definition
grep -rn "task-default-timeout\|ephemeral.*settings\|registerSetting" packages/core/src

# Find where /set is handled
grep -rn "case '/set'\|handleSet" packages/cli/src
```

### Required Changes

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P21
 * @requirement REQ-ASYNC-012
 */

// In settings definition:
{
  name: 'task-max-async',
  description: 'Maximum concurrent async tasks. Default 5, use -1 for unlimited.',
  type: 'number',
  default: 5,
  validate: (value) => value === -1 || (value >= 1 && value <= 100),
}

// In setting change handler:
if (settingName === 'task-max-async') {
  const asyncTaskManager = config.getAsyncTaskManager?.();
  if (asyncTaskManager) {
    asyncTaskManager.setMaxAsyncTasks(value);
  }
}
```

### Files to Create

- `packages/core/src/services/asyncTaskManager.spec.ts` or add to existing
  - Test setting integration

## Verification Commands

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P21" packages/core/src packages/cli/src

# Check setting defined
grep -rn "task-max-async" packages/core/src packages/cli/src

# TypeScript compiles
npm run typecheck

# Run tests
npm test
```

## Success Criteria

- [ ] task-max-async setting defined
- [ ] Default value is 5
- [ ] Setting changes propagate to AsyncTaskManager
- [ ] TypeScript compiles
- [ ] Tests pass

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P21.md`
