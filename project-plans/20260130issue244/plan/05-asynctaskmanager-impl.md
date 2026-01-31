# Phase 05: AsyncTaskManager Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `ls project-plans/20260130issue244/.completed/P04a.md`
- Pseudocode: `analysis/pseudocode/async-task-manager.md`

## Requirements Implemented

Implements REQ-ASYNC-001 and REQ-ASYNC-002 to make all tests pass.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/asyncTaskManager.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P05`
  - MUST include: `@requirement REQ-ASYNC-001, REQ-ASYNC-002`
  - Implement ALL methods following pseudocode EXACTLY
  - Reference pseudocode line numbers in comments

### Implementation Following Pseudocode

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P05
 * @requirement REQ-ASYNC-001, REQ-ASYNC-002
 * @pseudocode lines 10-130
 */

// Lines 20-23: setMaxAsyncTasks
setMaxAsyncTasks(max: number): void {
  this.maxAsyncTasks = max;
  this.enforceHistoryLimit();
}

// Lines 27-33: canLaunchAsync
canLaunchAsync(): { allowed: boolean; reason?: string } {
  if (this.maxAsyncTasks === -1) {
    return { allowed: true };
  }
  const runningCount = Array.from(this.tasks.values())
    .filter(t => t.status === 'running').length;
  if (runningCount >= this.maxAsyncTasks) {
    return { allowed: false, reason: `Max async tasks (${this.maxAsyncTasks}) reached` };
  }
  return { allowed: true };
}

// Lines 35-46: registerTask
registerTask(input: RegisterTaskInput): AsyncTaskInfo {
  const task: AsyncTaskInfo = {
    id: input.id,
    subagentName: input.subagentName,
    goalPrompt: input.goalPrompt,
    status: 'running',
    launchedAt: Date.now(),
    abortController: input.abortController
  };
  this.tasks.set(input.id, task);
  this.emitter.emit('task-launched', task);
  return task;
}

// Lines 48-57: completeTask
completeTask(id: string, output: OutputObject): boolean {
  const task = this.tasks.get(id);
  if (!task || task.status !== 'running') {
    return false; // Idempotent
  }
  task.status = 'completed';
  task.completedAt = Date.now();
  task.output = output;
  this.emitter.emit('task-completed', task);
  this.enforceHistoryLimit();
  return true;
}

// Lines 59-68: failTask
failTask(id: string, error: string): boolean {
  const task = this.tasks.get(id);
  if (!task || task.status !== 'running') {
    return false; // Idempotent
  }
  task.status = 'failed';
  task.completedAt = Date.now();
  task.error = error;
  this.emitter.emit('task-failed', task);
  this.enforceHistoryLimit();
  return true;
}

// Lines 70-82: cancelTask
cancelTask(id: string): boolean {
  const task = this.tasks.get(id);
  if (!task) {
    return false;
  }
  if (task.status !== 'running') {
    return false; // Idempotent
  }
  task.status = 'cancelled';
  task.completedAt = Date.now();
  if (task.abortController) {
    task.abortController.abort();
  }
  this.emitter.emit('task-cancelled', task);
  this.enforceHistoryLimit();
  return true;
}

// Lines 87-93: getTaskByPrefix
getTaskByPrefix(prefix: string): { task?: AsyncTaskInfo; candidates?: AsyncTaskInfo[] } {
  const matches = Array.from(this.tasks.values())
    .filter(t => t.id.startsWith(prefix));
  if (matches.length === 0) {
    return {};
  }
  if (matches.length === 1) {
    return { task: matches[0] };
  }
  return { candidates: matches };
}

// Lines 98-99: getRunningTasks
getRunningTasks(): AsyncTaskInfo[] {
  return Array.from(this.tasks.values()).filter(t => t.status === 'running');
}

// Lines 101-104: getPendingNotifications
getPendingNotifications(): AsyncTaskInfo[] {
  return Array.from(this.tasks.values()).filter(t =>
    (t.status === 'completed' || t.status === 'failed') && t.notifiedAt === undefined
  );
}

// Lines 106-109: markNotified
markNotified(id: string): void {
  const task = this.tasks.get(id);
  if (task && !task.notifiedAt) {
    task.notifiedAt = Date.now();
  }
}

// Lines 111-118: enforceHistoryLimit
private enforceHistoryLimit(): void {
  const historyLimit = this.maxAsyncTasks === -1 ? 10 : this.maxAsyncTasks * 2;
  const terminalTasks = Array.from(this.tasks.values())
    .filter(t => t.status !== 'running')
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  
  while (terminalTasks.length > historyLimit) {
    const oldest = terminalTasks.shift();
    if (oldest && oldest.notifiedAt !== undefined) {
      this.tasks.delete(oldest.id);
    } else {
      break; // Don't remove if not yet notified
    }
  }
}

// Lines 120-127: Event subscriptions
onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void {
  this.emitter.on('task-completed', handler);
  return () => this.emitter.off('task-completed', handler);
}

onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void {
  this.emitter.on('task-failed', handler);
  return () => this.emitter.off('task-failed', handler);
}

onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void {
  this.emitter.on('task-cancelled', handler);
  return () => this.emitter.off('task-cancelled', handler);
}
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P05" packages/core/src/services/asyncTaskManager.ts

# Check pseudocode references
grep -n "@pseudocode" packages/core/src/services/asyncTaskManager.ts

# Check no TODO/FIXME/NotYetImplemented
grep -n "TODO\|FIXME\|NotYetImplemented" packages/core/src/services/asyncTaskManager.ts
# Expected: No matches

# Run tests - ALL should PASS now
npm test -- packages/core/src/services/asyncTaskManager.test.ts
# Expected: All tests pass

# TypeScript compiles
npm run typecheck

# Check for empty returns (fraud detection)
grep -n "return \[\]\|return \{\}\|return null\|return undefined" packages/core/src/services/asyncTaskManager.ts
# Expected: No matches in implementation (only in edge cases like getTask not found)
```

## Semantic Verification Checklist

### Does the code DO what the requirement says?

1. **REQ-ASYNC-001: Task Tracking**
   - [ ] registerTask creates task with all fields
   - [ ] getTask retrieves task by ID
   - [ ] getAllTasks returns all tasks
   - [ ] getRunningTasks filters correctly
   - [ ] getPendingNotifications filters correctly

2. **REQ-ASYNC-001: State Transitions**
   - [ ] Only one terminal transition allowed
   - [ ] completeTask sets status and output
   - [ ] failTask sets status and error
   - [ ] cancelTask sets status and calls abort

3. **REQ-ASYNC-002: History Limits**
   - [ ] Formula: max === -1 ? 10 : max * 2
   - [ ] Only removes notified tasks
   - [ ] Removes oldest first

### Is this REAL implementation?

- [ ] No TODO/FIXME markers
- [ ] No NotYetImplemented errors
- [ ] No empty returns
- [ ] Code matches pseudocode lines

### Would tests FAIL if implementation removed?

- [ ] All tests currently pass
- [ ] Tests verify actual values, not just existence

## Success Criteria

- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] No deferred implementation markers
- [ ] Pseudocode line references present
- [ ] Semantic verification passed

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P05.md`

Contents:
```markdown
Phase: P05
Completed: [timestamp]
Tests: All passing
Implementation: Complete per pseudocode
```
