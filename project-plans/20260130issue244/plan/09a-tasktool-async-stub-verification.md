# Phase 09a: Task Tool Async Mode Stub Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P09a`

## Prerequisites
- Required: Phase 09 completed

## Structural Verification

```bash
# Check async in TaskToolParams
grep -n "async.*:.*boolean" packages/core/src/tools/task.ts

# Check async in schema
grep -B 2 -A 5 '"async"' packages/core/src/tools/task.ts

# Check plan marker
grep -n "@plan PLAN-20260130-ASYNCTASK.P09" packages/core/src/tools/task.ts

# Check requirement marker
grep -n "@requirement REQ-ASYNC-005\|@requirement REQ-ASYNC-006" packages/core/src/tools/task.ts

# Check async branch stub
grep -n "if.*normalized\.async\|this\.normalized\.async" packages/core/src/tools/task.ts

# TypeScript compiles
npm run typecheck

# Existing tests pass
npm test -- packages/core/src/tools/task.test.ts
```

## Semantic Verification Checklist

### Interface Changes

- [ ] TaskToolParams has `async?: boolean`
- [ ] TaskToolInvocationParams has `async: boolean`
- [ ] TaskToolDependencies has `getAsyncTaskManager`

### Schema Changes

- [ ] Schema has async property with type: 'boolean'
- [ ] Schema has description for async parameter

### Code Flow

- [ ] execute method has async branch check
- [ ] Async branch throws NotYetImplemented (stub)
- [ ] Sync path unchanged (tests pass)

## Success Criteria

- [ ] All structural verification passed
- [ ] All semantic verification passed
- [ ] TypeScript compiles
- [ ] Existing tests pass

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P09a.md`
