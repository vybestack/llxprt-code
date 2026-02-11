# Phase 12a: Check Async Tasks Tool Stub Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P12a`

## Prerequisites
- Required: Phase 12 completed

## Structural Verification

```bash
# Files exist
ls -la packages/core/src/tools/check-async-tasks.ts
ls -la packages/core/src/tools/check-async-tasks.test.ts

# Plan markers
grep "@plan PLAN-20260130-ASYNCTASK.P12" packages/core/src/tools/check-async-tasks.ts

# Requirement markers
grep "@requirement REQ-ASYNC-007" packages/core/src/tools/check-async-tasks.ts

# TypeScript compiles
npm run typecheck
```

## Semantic Verification Checklist

- [ ] CheckAsyncTasksParams has task_id?: string
- [ ] CheckAsyncTasksTool extends BaseDeclarativeTool
- [ ] Tool name is 'check_async_tasks'
- [ ] Kind is Think
- [ ] Schema has task_id property
- [ ] createInvocation gets AsyncTaskManager from deps

## Success Criteria

- [ ] All structural verification passed
- [ ] All semantic verification passed
- [ ] TypeScript compiles

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P12a.md`
