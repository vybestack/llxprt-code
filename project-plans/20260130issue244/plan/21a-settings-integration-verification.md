# Phase 21a: Settings Integration Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P21a`

## Prerequisites
- Required: Phase 21 completed

## Structural Verification

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P21" packages/core/src packages/cli/src

# Check setting defined
grep -rn "task-max-async" packages/core/src packages/cli/src

# TypeScript compiles
npm run typecheck

# Tests pass
npm test
```

## Semantic Verification Checklist

- [ ] Setting registered with name 'task-max-async'
- [ ] Default is 5
- [ ] Accepts -1 for unlimited
- [ ] Setting changes call setMaxAsyncTasks

## Manual Test

```bash
npm run build
node scripts/start.js --profile-load synthetic

# In session:
# /set task-max-async 10
# (Should confirm setting changed)
```

## Success Criteria

- [ ] Setting defined and works
- [ ] Tests pass
- [ ] Manual test works

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P21a.md`
