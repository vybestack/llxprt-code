# Phase 17a: Slash Commands Implementation Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P17a`

## Prerequisites
- Required: Phase 17 completed

## Structural Verification

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P17" packages/cli/src

# Check no stubs
grep -rn "NotYetImplemented" packages/cli/src/ui/commands.ts
# Expected: No matches

# Run tests
npm test -- packages/cli
# Expected: All pass

# TypeScript
npm run typecheck
```

## Semantic Verification Checklist

### /tasks list

- [ ] Shows all tasks
- [ ] Shows status for each task
- [ ] Shows duration
- [ ] Shows goal preview
- [ ] Handles empty list

### /task end

- [ ] Cancels by exact ID
- [ ] Cancels by prefix
- [ ] Reports ambiguous prefix
- [ ] Reports no match
- [ ] Reports already completed/failed

## Manual Test

```bash
# Build and run CLI
npm run build

# Start interactive session
node scripts/start.js --profile-load synthetic

# (In session, type):
# /tasks list
# (Should show "No async tasks" or list of tasks)
```

## Success Criteria

- [ ] All tests pass
- [ ] Commands work interactively
- [ ] TypeScript compiles

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P17a.md`
