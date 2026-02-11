# Phase 17: Slash Commands Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P17`

## Prerequisites
- Required: Phase 16a completed
- Pseudocode: `analysis/pseudocode/slash-commands.md`

## Requirements Implemented

Implements REQ-ASYNC-008 and REQ-ASYNC-009 to make all tests pass.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/commands.ts` (or similar)
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P17`
  - Replace stubs with full implementation

### Implementation Details

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P17
 * @requirement REQ-ASYNC-008, REQ-ASYNC-009
 */

// /tasks list
function handleTasksList(asyncTaskManager: AsyncTaskManager): CommandResult {
  const tasks = asyncTaskManager.getAllTasks();
  
  if (tasks.length === 0) {
    return {
      success: true,
      output: 'No async tasks.',
    };
  }

  const lines = ['Async Tasks:', ''];
  
  for (const task of tasks) {
    const statusIcon = {
      running: 'Running ',
      completed: 'Done    ',
      failed: 'Failed  ',
      cancelled: 'Cancelled',
    }[task.status];

    let duration = '';
    if (task.completedAt) {
      const ms = task.completedAt - task.launchedAt;
      duration = ` (${(ms / 1000).toFixed(1)}s)`;
    } else if (task.status === 'running') {
      const ms = Date.now() - task.launchedAt;
      duration = ` (${(ms / 1000).toFixed(0)}s elapsed)`;
    }

    const goalPreview = task.goalPrompt.length > 40 
      ? task.goalPrompt.slice(0, 40) + '...'
      : task.goalPrompt;

    lines.push(`  ${statusIcon} ${task.id.slice(0, 8)}  ${task.subagentName}${duration}`);
    lines.push(`           ${goalPreview}`);
    lines.push('');
  }

  return {
    success: true,
    output: lines.join('\n'),
  };
}

// /task end <id>
function handleTaskEnd(asyncTaskManager: AsyncTaskManager, taskId: string): CommandResult {
  if (!taskId.trim()) {
    return {
      success: false,
      output: 'Usage: /task end <task-id-or-prefix>',
    };
  }

  const result = asyncTaskManager.getTaskByPrefix(taskId);

  // Ambiguous prefix
  if (result.candidates && result.candidates.length > 1) {
    const candidateLines = result.candidates.map(c => 
      `  ${c.id} (${c.subagentName})`
    );
    return {
      success: false,
      output: `Multiple tasks match '${taskId}':\n${candidateLines.join('\n')}\n\nProvide a more specific ID.`,
    };
  }

  // No match
  if (!result.task) {
    return {
      success: false,
      output: `No task found matching '${taskId}'.`,
    };
  }

  const task = result.task;

  // Already terminal
  if (task.status !== 'running') {
    return {
      success: false,
      output: `Task '${task.id}' is already ${task.status}.`,
    };
  }

  // Cancel it
  const cancelled = asyncTaskManager.cancelTask(task.id);
  
  if (!cancelled) {
    return {
      success: false,
      output: `Failed to cancel task '${task.id}'.`,
    };
  }

  return {
    success: true,
    output: `Task '${task.id}' (${task.subagentName}) has been cancelled.`,
  };
}
```

## Verification Commands

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P17" packages/cli/src

# Check no NotYetImplemented
grep -rn "NotYetImplemented" packages/cli/src/ui/commands.ts
# Expected: No matches

# Run tests - ALL should PASS
npm test -- packages/cli
# Expected: All pass

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] No stubs remaining
- [ ] Plan markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P17.md`
