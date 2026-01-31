# Phase 02a: Pseudocode Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P02a`

## Prerequisites
- Required: Phase 02 completed
- Expected: All pseudocode files in `analysis/pseudocode/`

## Structural Verification

```bash
# Check all pseudocode files exist
ls project-plans/20260130issue244/analysis/pseudocode/async-task-manager.md
ls project-plans/20260130issue244/analysis/pseudocode/async-task-reminder-service.md
ls project-plans/20260130issue244/analysis/pseudocode/task-tool-async.md
ls project-plans/20260130issue244/analysis/pseudocode/check-async-tasks-tool.md
ls project-plans/20260130issue244/analysis/pseudocode/slash-commands.md
ls project-plans/20260130issue244/analysis/pseudocode/auto-trigger.md

# Check line numbers present in each
for f in project-plans/20260130issue244/analysis/pseudocode/*.md; do
  echo "=== $f ==="
  grep -c "^[0-9]" "$f" || echo "NO LINE NUMBERS"
done

# Check interface contracts
for f in project-plans/20260130issue244/analysis/pseudocode/*.md; do
  echo "=== $f ==="
  grep -c "INPUTS\|OUTPUTS\|DEPENDENCIES" "$f" || echo "NO CONTRACTS"
done

# Check anti-pattern warnings
for f in project-plans/20260130issue244/analysis/pseudocode/*.md; do
  echo "=== $f ==="
  grep -c "ERROR.*DO NOT" "$f" || echo "NO WARNINGS"
done
```

## Semantic Verification Checklist

### AsyncTaskManager Pseudocode

1. **State Machine Implementation**
   - [ ] Line numbers for registerTask (creates running state)
   - [ ] Line numbers for completeTask (running -> completed)
   - [ ] Line numbers for failTask (running -> failed)
   - [ ] Line numbers for cancelTask (running -> cancelled)
   - [ ] Idempotency check (return false if already terminal)

2. **Resource Limits**
   - [ ] canLaunchAsync checks maxAsyncTasks
   - [ ] Returns { allowed: false, reason: "..." } when limit reached
   - [ ] Handles maxAsyncTasks === -1 (unlimited)

3. **History Limits**
   - [ ] enforceHistoryLimit formula: max === -1 ? 10 : max * 2
   - [ ] Only removes notified tasks
   - [ ] Sorts by completedAt ASC (oldest first)

4. **Event Emissions**
   - [ ] onTaskCompleted, onTaskFailed, onTaskCancelled defined
   - [ ] Return unsubscribe function

### AsyncTaskReminderService Pseudocode

1. **Format Matching**
   - [ ] Uses exact TodoReminderService format
   - [ ] `---\nSystem Note: ...\n---`

2. **Status Summary**
   - [ ] Lists running tasks
   - [ ] Lists pending notification tasks

3. **Completion Notification**
   - [ ] Matches sync task output format exactly
   - [ ] Includes agent_id, terminate_reason, emitted_vars

### Task Tool Async Pseudocode

1. **Async Branch**
   - [ ] Check async parameter
   - [ ] Check canLaunchAsync
   - [ ] Register with AsyncTaskManager
   - [ ] Return immediately with launch message
   - [ ] Background execution (no await)

2. **Completion Handling**
   - [ ] Call completeTask on success
   - [ ] Call failTask on error

### Check Async Tasks Tool Pseudocode

1. **List Mode**
   - [ ] No args returns all tasks
   - [ ] Format: status, name, id

2. **Peek Mode**
   - [ ] task_id arg returns details
   - [ ] Includes partial emitted_vars for running

3. **Prefix Matching**
   - [ ] Unique prefix required
   - [ ] Ambiguous returns candidates list

### Slash Commands Pseudocode

1. **/tasks list**
   - [ ] Lists all async tasks
   - [ ] Shows status, duration, goal

2. **/task end**
   - [ ] Prefix matching
   - [ ] Calls cancelTask
   - [ ] Ambiguity handling

### Auto-Trigger Pseudocode

1. **Idle Check**
   - [ ] Checks isResponding
   - [ ] Checks isWaitingForConfirmation

2. **Trigger Logic**
   - [ ] Only one trigger in flight
   - [ ] Calls markNotified AFTER delivery

3. **Busy Path**
   - [ ] Defers to next turn reminder

## Blocking Issues

List any gaps found:

1. [Gap 1]
2. [Gap 2]

## Success Criteria

- [ ] All 6 pseudocode files present
- [ ] All have numbered lines
- [ ] All have interface contracts
- [ ] All have anti-pattern warnings
- [ ] Semantic verification passed

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P02a.md`
