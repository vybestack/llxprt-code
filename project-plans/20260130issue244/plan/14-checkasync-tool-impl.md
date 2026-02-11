# Phase 14: Check Async Tasks Tool Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P14`

## Prerequisites
- Required: Phase 13a completed
- Pseudocode: `analysis/pseudocode/check-async-tasks-tool.md`

## Requirements Implemented

Implements REQ-ASYNC-007 to make all tests pass.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/check-async-tasks.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P14`
  - Replace stub with full implementation

### Implementation Details

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P14
 * @requirement REQ-ASYNC-007
 */

override async execute(): Promise<ToolResult> {
  const tasks = this.taskManager.getAllTasks();

  // List mode - no task_id provided
  if (!this.params.task_id) {
    if (tasks.length === 0) {
      return {
        llmContent: 'No async tasks currently running or completed.',
        returnDisplay: 'No async tasks.',
        metadata: { count: 0 },
      };
    }

    const statusIcon: Record<string, string> = {
      running: '[running]',
      completed: '[completed]',
      failed: '[failed]',
      cancelled: '[cancelled]',
    };

    const lines = [
      `Async Tasks (${tasks.length} total):`,
      '',
      ...tasks.map(t => 
        `- ${statusIcon[t.status]} ${t.subagentName} (${t.id.slice(0, 8)}...): ${t.goalPrompt.slice(0, 50)}${t.goalPrompt.length > 50 ? '...' : ''}`
      ),
    ];

    return {
      llmContent: lines.join('\n'),
      returnDisplay: lines.join('\n'),
      metadata: { count: tasks.length },
    };
  }

  // Peek mode - task_id provided
  const result = this.taskManager.getTaskByPrefix(this.params.task_id);

  // Ambiguous prefix
  if (result.candidates && result.candidates.length > 1) {
    const candidateLines = result.candidates.map(c => 
      `- ${c.id} (${c.subagentName})`
    );
    return {
      llmContent: `Multiple tasks match prefix '${this.params.task_id}':\n${candidateLines.join('\n')}\n\nProvide a more specific ID or prefix.`,
      returnDisplay: `Ambiguous: ${result.candidates.length} tasks match`,
      metadata: { ambiguous: true, count: result.candidates.length },
    };
  }

  // No match
  if (!result.task) {
    return {
      llmContent: `No task found matching '${this.params.task_id}'.`,
      returnDisplay: `Task not found: ${this.params.task_id}`,
      error: { message: 'Task not found', type: ToolErrorType.EXECUTION_FAILED },
    };
  }

  // Found task - return details
  const task = result.task;
  const details: Record<string, unknown> = {
    id: task.id,
    subagentName: task.subagentName,
    goalPrompt: task.goalPrompt,
    status: task.status,
    launchedAt: new Date(task.launchedAt).toISOString(),
  };

  if (task.completedAt) {
    details.completedAt = new Date(task.completedAt).toISOString();
    details.duration = `${((task.completedAt - task.launchedAt) / 1000).toFixed(1)}s`;
  }

  if (task.status === 'completed' && task.output) {
    details.terminate_reason = task.output.terminate_reason;
    details.emitted_vars = task.output.emitted_vars;
    if (task.output.final_message) {
      details.final_message = task.output.final_message;
    }
  }

  if (task.status === 'failed' && task.error) {
    details.error = task.error;
  }

  const llmContent = JSON.stringify(details, null, 2);

  // Human-friendly display
  const displayLines = [
    `Task: ${task.id}`,
    `Subagent: ${task.subagentName}`,
    `Status: ${task.status}`,
    `Goal: ${task.goalPrompt}`,
  ];

  if (task.status === 'completed' && task.output) {
    displayLines.push(`Result: ${JSON.stringify(task.output.emitted_vars)}`);
  }
  if (task.status === 'failed' && task.error) {
    displayLines.push(`Error: ${task.error}`);
  }

  return {
    llmContent,
    returnDisplay: displayLines.join('\n'),
    metadata: { taskId: task.id, status: task.status },
  };
}
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P14" packages/core/src/tools/check-async-tasks.ts

# Check no NotYetImplemented
grep -n "NotYetImplemented" packages/core/src/tools/check-async-tasks.ts
# Expected: No matches

# Run tests - ALL should PASS
npm test -- packages/core/src/tools/check-async-tasks.test.ts
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

Create: `project-plans/20260130issue244/.completed/P14.md`
