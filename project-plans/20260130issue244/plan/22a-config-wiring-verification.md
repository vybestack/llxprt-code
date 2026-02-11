# Phase 22a: Config Wiring Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P22a`

## Prerequisites
- Required: Phase 22 completed

## Structural Verification

```bash
# Check Config has async task getters
grep -rn "getAsyncTaskManager\|getAsyncTaskReminderService\|setupAsyncTaskAutoTrigger" packages/core/src/config/config.ts

# Check tools registered
grep -rn "CheckAsyncTasksTool" packages/core/src

# TypeScript compiles
npm run typecheck

# Tests pass
npm test
```

## Semantic Verification Checklist

### Config

- [ ] getAsyncTaskManager returns singleton
- [ ] getAsyncTaskReminderService returns singleton
- [ ] setupAsyncTaskAutoTrigger wires everything

### Tool Dependencies

- [ ] TaskTool has getAsyncTaskManager dependency
- [ ] CheckAsyncTasksTool registered

### Client Integration

- [ ] Next-turn reminders include async task status
- [ ] Auto-trigger wired to agent turn

## Integration Test

```bash
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku"
# Expected: Works without errors
```

## Success Criteria

- [ ] All components wired
- [ ] TypeScript compiles
- [ ] Tests pass
- [ ] Integration test works

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P22a.md`
