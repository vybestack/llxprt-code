# Phase 04: Extract Tool Executor

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P04`

## Prerequisites

- Required: Phase 03a completed successfully
- Verification: Characterization tests pass against current code
- Expected: Baseline behavior documented and tested

## Purpose

**EXTRACT** (cut-paste) the tool execution logic from `coreToolScheduler.ts` into `scheduler/tool-executor.ts`. Wire `coreToolScheduler` to delegate to the extracted module. This is an EXTRACTION, not a rewrite — the code is MOVED, not reimplemented.

## Requirements Implemented

### TS-EXEC-001 through TS-EXEC-007: Tool Execution Module

**Full Text**: Create a standalone module that executes a single tool with hooks, PID tracking, output streaming, truncation, error handling, and cancellation.

**Behavior**:
- GIVEN: Code extracted from launchToolExecution (lines 1748-1927)
- WHEN: coreToolScheduler.ts is modified to delegate to ToolExecutor
- THEN: ALL tests (existing + characterization) pass without modification

**Why This Matters**: Extraction reduces coreToolScheduler complexity and enables reuse (e.g., in nonInteractiveToolExecutor).

## Implementation Tasks

### Files to Create

#### 1. `packages/core/src/scheduler/tool-executor.ts`

**MUST include: `@plan PLAN-20260302-TOOLSCHEDULER.P04`**

**What to Extract:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P04
 * @requirement TS-EXEC-001 through TS-EXEC-007
 * 
 * Tool executor module — extracted from coreToolScheduler.ts launchToolExecution.
 * Executes a single tool with hooks, PID tracking, output streaming, and error handling.
 */

import type { ToolCall, ScheduledToolCall, ExecutingToolCall, CompletedToolCall } from './types.js';
import type { ToolResult } from '../tools/tools.js';
import type { Config } from '../config/Config.js';
import { triggerBeforeToolHook, triggerAfterToolHook } from '../core/coreToolHookTriggers.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

export interface ToolExecutionContext {
  call: ScheduledToolCall;
  signal: AbortSignal;
  onLiveOutput?: (callId: string, chunk: string | AnsiOutput) => void;
  onPid?: (callId: string, pid: number) => void;
}

export class ToolExecutor {
  constructor(private readonly config: Config) {}

  /**
   * Execute a single tool call from scheduled to completed state.
   * 
   * Extracted from coreToolScheduler.ts launchToolExecution (lines 1748-1927).
   * 
   * Handles:
   * - Before/after hook invocation
   * - PID tracking for shell tools
   * - Live output streaming
   * - Error handling and cancellation
   * - Result transformation
   */
  async execute(context: ToolExecutionContext): Promise<CompletedToolCall> {
    const { call: scheduledCall, signal, onLiveOutput, onPid } = context;
    const { callId, name: toolName, args } = scheduledCall.request;
    let invocation = scheduledCall.invocation;
    let effectiveArgs = args;

    // ============================================================
    // EXTRACTED CODE STARTS HERE (from launchToolExecution)
    // ============================================================
    
    // [LINES 1760-1789: Before hook logic]
    const beforeResult = await triggerBeforeToolHook(
      this.config,
      toolName,
      args,
    );

    // Check if hook wants to block execution
    if (beforeResult?.isBlockingDecision()) {
      const blockReason =
        beforeResult.getEffectiveReason() || 'Blocked by BeforeTool hook';
      throw new Error(blockReason);
    }

    // Check if hook wants to modify tool input
    const modifiedInput = beforeResult?.getModifiedToolInput();
    if (modifiedInput) {
      effectiveArgs = modifiedInput;
      invocation = scheduledCall.tool.build(modifiedInput);
    }

    // [LINES 1791-1807: Setup callbacks]
    const liveOutputCallback = scheduledCall.tool.canUpdateOutput
      ? (outputChunk: string | AnsiOutput) => {
          onLiveOutput?.(callId, outputChunk);
        }
      : undefined;

    const setPidCallback = (pid: number) => {
      onPid?.(callId, pid);
    };

    // [LINES 1809-1927: Execute tool with error handling]
    return invocation
      .execute(
        signal,
        liveOutputCallback,
        undefined,
        undefined,
        setPidCallback,
      )
      .then(async (toolResult: ToolResult) => {
        if (signal.aborted) {
          return this.createCancelledResult(scheduledCall, 'User cancelled tool execution.');
        }

        // [LINES 1831-1866: After hook logic]
        const afterResult = await triggerAfterToolHook(
          this.config,
          toolName,
          effectiveArgs,
          toolResult,
        );

        // Apply hook modifications to tool result
        let finalResult = toolResult;
        if (afterResult) {
          const systemMessage = afterResult.systemMessage;
          const additionalContext = afterResult.getAdditionalContext();
          if (systemMessage || additionalContext) {
            const appendText = systemMessage || additionalContext || '';
            const existingContent =
              typeof finalResult.llmContent === 'string'
                ? finalResult.llmContent
                : JSON.stringify(finalResult.llmContent);
            finalResult = {
              ...finalResult,
              llmContent: `${existingContent}\n\n${appendText}`,
            };
          }

          if (afterResult.suppressOutput) {
            finalResult = {
              ...finalResult,
              suppressDisplay: true,
            };
          }
        }

        return this.createSuccessResult(scheduledCall, finalResult);
      })
      .catch(async (executionError: Error) => {
        if (signal.aborted) {
          return this.createCancelledResult(scheduledCall, 'User cancelled tool execution.');
        }
        return this.createErrorResult(scheduledCall, executionError);
      });
    
    // ============================================================
    // EXTRACTED CODE ENDS HERE
    // ============================================================
  }

  private createSuccessResult(
    call: ScheduledToolCall,
    result: ToolResult,
  ): SuccessfulToolCall {
    // Create SuccessfulToolCall from ToolResult
    // This will be implemented by copying logic from publishResult (lines 1636-1672)
    // [IMPLEMENTATION EXTRACTED FROM publishResult]
  }

  private createErrorResult(
    call: ScheduledToolCall,
    error: Error,
  ): ErroredToolCall {
    // Create ErroredToolCall from error
    // [IMPLEMENTATION EXTRACTED FROM bufferError/publishResult]
  }

  private createCancelledResult(
    call: ScheduledToolCall,
    reason: string,
  ): CancelledToolCall {
    // Create CancelledToolCall
    // [IMPLEMENTATION EXTRACTED FROM bufferCancelled logic]
  }
}
```

**CRITICAL**: The code in `execute()` is NOT rewritten — it's CUT from lines 1760-1927 of coreToolScheduler.ts and PASTED here with minimal adaptation (changing `this.setStatusInternal` to callback invocations, etc.).

### Files to Modify

#### 1. `packages/core/src/core/coreToolScheduler.ts`

**CUT the launchToolExecution method (lines 1748-1927)**

**REPLACE with:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P04
 * Launch a single scheduled tool call and wire up result buffering / error handling.
 * Delegates execution to ToolExecutor.
 */
private async launchToolExecution(
  scheduledCall: ScheduledToolCall,
  executionIndex: number,
  signal: AbortSignal,
): Promise<void> {
  const { callId } = scheduledCall.request;

  // Transition to executing
  this.setStatusInternal(callId, 'executing');

  // Delegate to ToolExecutor
  const toolExecutor = new ToolExecutor(this.config);
  
  try {
    const completedCall = await toolExecutor.execute({
      call: scheduledCall,
      signal,
      onLiveOutput: (callId, chunk) => {
        if (this.outputUpdateHandler) {
          this.outputUpdateHandler(callId, chunk);
        }
        this.toolCalls = this.toolCalls.map((tc) =>
          tc.request.callId === callId && tc.status === 'executing'
            ? { ...tc, liveOutput: chunk }
            : tc,
        );
        this.notifyToolCallsUpdate();
      },
      onPid: (callId, pid) => {
        this.setPidInternal(callId, pid);
      },
    });

    // Convert CompletedToolCall to buffered result
    if (completedCall.status === 'success') {
      // Extract ToolResult from SuccessfulToolCall
      const toolResult: ToolResult = {
        llmContent: completedCall.response.responseParts, // Will need adaptation
        returnDisplay: completedCall.response.resultDisplay,
        // ... extract from response
      };
      this.bufferResult(callId, scheduledCall.request.name, toolResult, scheduledCall, executionIndex);
    } else if (completedCall.status === 'error') {
      this.bufferError(callId, new Error(completedCall.response.error.message), scheduledCall, executionIndex);
    } else {
      this.bufferCancelled(callId, scheduledCall, executionIndex);
    }

    await this.publishBufferedResults(signal);
  } catch (publishError) {
    // Final catch for publishing errors (preserve existing logic)
    // ... existing catch block from lines 1898-1925
  }
}
```

**Add import at top of file:**

```typescript
import { ToolExecutor } from '../scheduler/tool-executor.js';
```

## Subagent Prompt

```
You are implementing Phase 04 of the CoreToolScheduler refactoring.

CONTEXT: You are EXTRACTING code from coreToolScheduler.ts, NOT rewriting it. This is a cut-paste operation with minimal adaptation.

TASK: 
1. Create packages/core/src/scheduler/tool-executor.ts
2. CUT code from coreToolScheduler.ts lines 1760-1927 (launchToolExecution body)
3. PASTE into ToolExecutor.execute() with minimal changes
4. REPLACE launchToolExecution in coreToolScheduler with delegation to ToolExecutor

WHAT TO DO:
1. Read coreToolScheduler.ts lines 1748-1927 to see the EXACT code to extract
2. Create tool-executor.ts with ToolExecutor class
3. Copy (DO NOT REWRITE) the execution logic from launchToolExecution
4. Adapt only where necessary:
   - Change `this.setStatusInternal(callId, 'executing')` → done by caller
   - Change `this.bufferResult/bufferError/bufferCancelled` → return CompletedToolCall
   - Change `this.outputUpdateHandler` → call onLiveOutput callback
   - Change `this.setPidInternal` → call onPid callback
5. Update launchToolExecution to delegate to ToolExecutor
6. Add import for ToolExecutor

CRITICAL RULES:
- DO NOT rewrite the logic — CUT and PASTE
- DO NOT change behavior — adapt only for module boundaries
- DO include @plan and @requirement markers
- ALL tests (existing + characterization) must pass

EXPECTED OUTPUT:
- New file: packages/core/src/scheduler/tool-executor.ts (~200 lines)
- Modified: packages/core/src/core/coreToolScheduler.ts (-180 lines of logic, +50 lines delegation)
- All tests pass (npm test -- coreToolScheduler)

FORBIDDEN:
- Rewriting the execution logic
- Changing behavior
- Breaking existing tests
```

## Verification Commands

### Automated Checks

```bash
# Check file was created
test -f packages/core/src/scheduler/tool-executor.ts || exit 1

# Check plan markers
grep "@plan PLAN-20260302-TOOLSCHEDULER.P04" packages/core/src/scheduler/tool-executor.ts || exit 1

# Check launchToolExecution delegates to ToolExecutor
grep "new ToolExecutor" packages/core/src/core/coreToolScheduler.ts || exit 1
grep "toolExecutor.execute" packages/core/src/core/coreToolScheduler.ts || exit 1

# TypeScript compilation
npm run typecheck || exit 1

# Run ALL tests (existing + characterization)
npm test -- coreToolScheduler || exit 1

# Check file size reduction
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
if [ "$current_size" -gt 2000 ]; then
  echo "WARN: File size is $current_size, expected < 2000 after extraction"
fi
```

## Verification Commands

### Automated Checks

```bash
# Check file was created
test -f packages/core/src/scheduler/tool-executor.ts || exit 1

# Check plan markers
grep "@plan PLAN-20260302-TOOLSCHEDULER.P04" packages/core/src/scheduler/tool-executor.ts || exit 1

# Check launchToolExecution delegates to ToolExecutor
grep "new ToolExecutor" packages/core/src/core/coreToolScheduler.ts || exit 1
grep "toolExecutor.execute" packages/core/src/core/coreToolScheduler.ts || exit 1

# TypeScript compilation
npm run typecheck || exit 1

# Run ALL tests (existing + characterization)
npm test -- coreToolScheduler || exit 1

# Check file size reduction
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
if [ "$current_size" -gt 2000 ]; then
  echo "WARN: File size is $current_size, expected < 2000 after extraction"
fi
```

### Structural Verification Checklist

- [ ] tool-executor.ts file created
- [ ] ToolExecutor class exported
- [ ] execute() method present
- [ ] Plan markers present
- [ ] launchToolExecution modified to delegate
- [ ] Import added to coreToolScheduler.ts
- [ ] File size reduced

### Semantic Verification Checklist

- [ ] All existing tests pass (behavior preserved)
- [ ] All characterization tests pass (extraction correct)
- [ ] TypeScript compilation succeeds
- [ ] No TODO/HACK/STUB in extracted code
- [ ] Code is CUT/PASTE, not rewritten

## Success Criteria

- [ ] tool-executor.ts created with extracted code
- [ ] launchToolExecution delegates to ToolExecutor
- [ ] ALL existing tests pass
- [ ] ALL characterization tests pass
- [ ] TypeScript compilation succeeds
- [ ] File size reduced by ~130 lines
- [ ] Plan markers present

## Failure Recovery

If this phase fails:

1. **Compilation errors:** Check imports and type definitions
2. **Tests fail:** Verify behavior was not changed during extraction
3. **Missing delegation:** Ensure launchToolExecution calls ToolExecutor.execute()
4. Rollback: `git checkout -- packages/core/src/core/coreToolScheduler.ts`
5. Delete: `rm packages/core/src/scheduler/tool-executor.ts`
6. Re-run Phase 04

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P04.md`

Contents:
```markdown
Phase: P04
Completed: [TIMESTAMP]
Files Created:
  - packages/core/src/scheduler/tool-executor.ts (~200 lines)
Files Modified:
  - packages/core/src/core/coreToolScheduler.ts (-180 lines logic, +50 delegation = -130 net)
Tests: All tests pass (existing + characterization)
Verification: Extraction successful, behavior preserved
```
