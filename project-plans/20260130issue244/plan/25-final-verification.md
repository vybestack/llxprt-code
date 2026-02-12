# Phase 25: Final Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P25`

## Prerequisites
- Required: All previous phases completed (P01-P24a)

## Requirements Verification

### Full Test Suite

```bash
# Run all tests
npm run test
# Expected: All pass

# Run lint
npm run lint
# Expected: No errors

# Run typecheck
npm run typecheck
# Expected: No errors

# Run format
npm run format
# Expected: No changes needed (already formatted)

# Run build
npm run build
# Expected: Success

# Run smoke test
node scripts/start.js --profile-load synthetic "write me a haiku"
# Expected: Works correctly
```

### Requirement Checklist

#### REQ-ASYNC-001: AsyncTaskManager Service
- [ ] Service exists and tracks tasks
- [ ] Tests pass

#### REQ-ASYNC-002: History Limits
- [ ] Limit enforced (2*max or 10)
- [ ] Only notified tasks removed
- [ ] Tests pass

#### REQ-ASYNC-003: Status in System Messages
- [ ] generateStatusSummary produces correct format
- [ ] Tests pass

#### REQ-ASYNC-004: Next-Turn Reminders
- [ ] Reminders include async task status
- [ ] Format matches TodoReminderService
- [ ] Tests pass

#### REQ-ASYNC-005: Async Parameter
- [ ] Task tool accepts async parameter
- [ ] Returns immediately when async=true
- [ ] Tests pass

#### REQ-ASYNC-006: Async Through Scheduler
- [ ] Async tasks display in UI same as sync
- [ ] Tests pass

#### REQ-ASYNC-007: Check Async Tasks Tool
- [ ] Tool exists and works
- [ ] List mode and peek mode work
- [ ] Prefix matching works
- [ ] Tests pass

#### REQ-ASYNC-008: /tasks list Command
- [ ] Command works
- [ ] Shows all tasks with status
- [ ] Tests pass

#### REQ-ASYNC-009: /task end Command
- [ ] Command works
- [ ] Cancels tasks
- [ ] Prefix matching works
- [ ] Tests pass

#### REQ-ASYNC-010: Auto-Trigger on Completion
- [ ] Auto-trigger works when agent idle
- [ ] Defers when agent busy
- [ ] Tests pass

#### REQ-ASYNC-011: Notification Timing
- [ ] notifiedAt set AFTER delivery
- [ ] Not set if delivery fails
- [ ] Tests pass

#### REQ-ASYNC-012: task-max-async Setting
- [ ] Setting works via /set
- [ ] Default is 5
- [ ] -1 for unlimited works
- [ ] Tests pass

### Code Quality

```bash
# Check no TODOs in implementation
grep -rn "TODO\|FIXME\|HACK" packages/core/src/services/async*.ts packages/core/src/tools/check-async*.ts
# Expected: No matches (or only in test files with explanations)

# Check no NotYetImplemented
grep -rn "NotYetImplemented" packages/core/src
# Expected: No matches

# Check plan markers present
grep -rn "@plan PLAN-20260130-ASYNCTASK" packages/core/src packages/cli/src | wc -l
# Expected: >= 10

# Check requirement markers present
grep -rn "@requirement REQ-ASYNC-" packages/core/src packages/cli/src | wc -l
# Expected: >= 12
```

### Manual Verification

1. Start CLI: `node scripts/start.js --profile-load synthetic`
2. Verify `/tasks list` shows "No async tasks"
3. Verify `/set task-max-async 3` works
4. Verify model can use check_async_tasks tool

## Success Criteria

- [ ] All tests pass
- [ ] Lint clean
- [ ] TypeScript clean
- [ ] Build succeeds
- [ ] Smoke test passes
- [ ] All requirements verified
- [ ] No deferred implementation
- [ ] Plan markers present
- [ ] Manual verification passed

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P25.md`

Contents:
```markdown
Phase: P25
Completed: [timestamp]
Tests: All passing
Lint: Clean
TypeScript: Clean
Build: Success
Requirements: All verified
```
