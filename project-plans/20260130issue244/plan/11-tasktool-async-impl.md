# Phase 11: Task Tool Async Mode Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P11`

## Prerequisites
- Required: Phase 10a completed
- Pseudocode: `analysis/pseudocode/task-tool-async.md`

## Requirements Implemented

Implements REQ-ASYNC-005 and REQ-ASYNC-006 to make all async tests pass.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/task.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P11`
  - MUST include: `@requirement REQ-ASYNC-005, REQ-ASYNC-006`
  - Replace async stub with full implementation

### Implementation Details

The async branch in execute() must:
1. Check canLaunchAsync and return error if limit reached
2. Create orchestrator and launch subagent (same as sync)
3. Register task with AsyncTaskManager
4. Return immediately with launch status
5. Execute subagent in background (no await)
6. On completion: call completeTask
7. On failure: call failTask

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P11
 * @requirement REQ-ASYNC-005, REQ-ASYNC-006
 */

// In execute method, replace the async stub:
if (this.normalized.async) {
  // Check limit before launching
  const asyncTaskManager = this.deps.getAsyncTaskManager?.();
  if (!asyncTaskManager) {
    return {
      llmContent: 'Async mode requires AsyncTaskManager to be configured.',
      returnDisplay: 'Error: Async mode not available.',
      error: { message: 'AsyncTaskManager not configured', type: ToolErrorType.EXECUTION_FAILED }
    };
  }
  
  const canLaunch = asyncTaskManager.canLaunchAsync();
  if (!canLaunch.allowed) {
    return {
      llmContent: canLaunch.reason ?? 'Cannot launch async task.',
      returnDisplay: canLaunch.reason ?? 'Async task limit reached.',
      error: { message: canLaunch.reason ?? 'Limit reached', type: ToolErrorType.EXECUTION_FAILED }
    };
  }

  // Create orchestrator and launch (same initial steps as sync)
  let orchestrator: SubagentOrchestrator;
  try {
    orchestrator = this.deps.createOrchestrator();
  } catch (error) {
    return this.createErrorResult(error, 'Failed to create orchestrator for async task.');
  }

  const launchRequest = this.createLaunchRequest(timeoutMs);
  
  let launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>;
  try {
    launchResult = await orchestrator.launch(launchRequest, signal);
  } catch (error) {
    return this.createErrorResult(error, `Failed to launch async subagent '${this.normalized.subagentName}'.`);
  }

  const { scope, agentId, dispose } = launchResult;
  const contextState = this.buildContextState();

  // Create abort controller for the async task
  const asyncAbortController = new AbortController();

  // Register with AsyncTaskManager
  asyncTaskManager.registerTask({
    id: agentId,
    subagentName: this.normalized.subagentName,
    goalPrompt: this.normalized.goalPrompt,
    abortController: asyncAbortController,
  });

  // Set up message streaming (same as sync)
  if (updateOutput) {
    const existingHandler = scope.onMessage;
    const normalizeForStreaming = (text: string): string => {
      if (!text) return '';
      const lf = text.replace(/\r\n?/g, '\n');
      return lf.endsWith('\n') ? lf : lf + '\n';
    };
    scope.onMessage = (message: string) => {
      const cleaned = normalizeForStreaming(message);
      if (cleaned.trim().length > 0) {
        updateOutput(`[${agentId}] ${cleaned}`);
      }
      existingHandler?.(message);
    };
  }

  // Execute in background (do NOT await)
  this.executeAsyncInBackground(
    scope,
    contextState,
    agentId,
    asyncTaskManager,
    dispose,
    asyncAbortController.signal
  );

  // Return immediately with launch status
  return {
    llmContent: `Async task launched: subagent '${this.normalized.subagentName}' (ID: ${agentId}). ` +
      `Task is running in background. Use 'check_async_tasks' to monitor progress.`,
    returnDisplay: `Async task started: **${this.normalized.subagentName}** (\`${agentId}\`)`,
    metadata: {
      agentId,
      async: true,
      status: 'running',
    },
  };
}

// New private method for background execution
private executeAsyncInBackground(
  scope: SubAgentScope,
  contextState: ContextState,
  agentId: string,
  asyncTaskManager: AsyncTaskManager,
  dispose: () => Promise<void>,
  signal: AbortSignal,
): void {
  (async () => {
    try {
      // Use non-interactive mode for async (no scheduler integration needed after launch)
      await scope.runNonInteractive(contextState);
      
      if (signal.aborted) {
        // Task was cancelled
        asyncTaskManager.cancelTask(agentId);
      } else {
        const output = scope.output ?? {
          terminate_reason: SubagentTerminateMode.ERROR,
          emitted_vars: {},
        };
        asyncTaskManager.completeTask(agentId, output);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      asyncTaskManager.failTask(agentId, errorMessage);
    } finally {
      try {
        await dispose();
      } catch {
        // Swallow dispose errors
      }
    }
  })();
}
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P11" packages/core/src/tools/task.ts

# Check requirement markers
grep -n "@requirement REQ-ASYNC-005\|@requirement REQ-ASYNC-006" packages/core/src/tools/task.ts

# Check no NotYetImplemented in async path
grep -n "NotYetImplemented" packages/core/src/tools/task.ts
# Expected: No matches

# Check executeAsyncInBackground exists
grep -n "executeAsyncInBackground" packages/core/src/tools/task.ts

# Run ALL tests - should PASS now
npm test -- packages/core/src/tools/task.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] All async tests pass
- [ ] All sync tests pass
- [ ] TypeScript compiles
- [ ] No NotYetImplemented in code
- [ ] Plan/requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P11.md`
