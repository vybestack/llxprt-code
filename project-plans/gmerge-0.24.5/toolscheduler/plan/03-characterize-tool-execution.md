# Phase 03: Characterize Tool Execution Behavior

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P03`

## Prerequisites

- Required: Phase 02a completed successfully
- Verification: `grep "export type {" packages/core/src/core/coreToolScheduler.ts | grep scheduler/types`
- Expected: Types extracted and re-exported

## Purpose

Write **characterization tests** that exercise the EXISTING tool execution behavior in coreToolScheduler.ts. These tests will lock down the behavior BEFORE extraction so we can verify equivalence after extraction.

**CRITICAL**: This is NOT TDD in the traditional sense. We're not writing tests for code that doesn't exist yet — we're documenting how the EXISTING code behaves so we can prove extraction preserves behavior.

## Requirements Implemented

### TS-EXEC-001 through TS-EXEC-007: Tool Execution Behaviors

**Full Text**: Document and test the existing tool execution lifecycle (state transitions, hooks, PID tracking, output streaming, truncation, error handling, cancellation).

**Why This Matters**: Without these tests, we won't know if extraction changes behavior subtly.

## Code to Characterize

The target code for extraction is in `coreToolScheduler.ts`:

### `launchToolExecution` (lines 1748-1927):
```typescript
private async launchToolExecution(
  scheduledCall: ScheduledToolCall,
  executionIndex: number,
  signal: AbortSignal,
): Promise<void> {
  // 1. Transition to executing (line 1757)
  this.setStatusInternal(callId, 'executing');
  
  // 2. Trigger BeforeTool hook (lines 1760-1789)
  const beforeResult = await triggerBeforeToolHook(...);
  if (beforeResult?.isBlockingDecision()) { /* buffer error */ }
  if (beforeResult?.getModifiedToolInput()) { /* rebuild invocation */ }
  
  // 3. Setup callbacks for streaming output and PID (lines 1791-1807)
  const liveOutputCallback = scheduledCall.tool.canUpdateOutput ? ... : undefined;
  const setPidCallback = (pid: number) => { this.setPidInternal(callId, pid); };
  
  // 4. Execute tool (lines 1809-1927)
  return invocation.execute(signal, liveOutputCallback, undefined, undefined, setPidCallback)
    .then(async (toolResult: ToolResult) => {
      // Handle abort (lines 1819-1828)
      // Trigger AfterTool hook (lines 1831-1866)
      // Buffer result (lines 1868-1874)
      // Publish buffered results (line 1876)
    })
    .catch(async (executionError: Error) => {
      // Handle abort or error (lines 1879-1895)
      // Buffer error or cancelled placeholder
      // Publish buffered results
    })
    .catch((publishError: Error) => {
      // Final catch for publishing errors (lines 1898-1925)
      // Ensure terminal state
    });
}
```

### Related Functions (will be extracted with executor):
- `triggerBeforeToolHook` (imported from coreToolHookTriggers.ts, lines 63-66)
- `triggerAfterToolHook` (imported from coreToolHookTriggers.ts, lines 63-66)
- `setPidInternal` (lines 774-785) — used by callback
- `setStatusInternal` (lines 548-728) — state transitions
- `bufferResult`, `bufferError`, `bufferCancelled` (lines 1421-1486) — result buffering
- `publishBufferedResults` (lines 1496-1623) — ordered publishing

**What We're Testing:**
- Input: ScheduledToolCall with a tool that can execute
- Output: Tool transitions to terminal state (success/error/cancelled)
- Side effects: Hooks fired, output streamed, PID tracked, result buffered and published

## Implementation Tasks

### Files to Create

#### 1. `packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts`

**MUST include: `@plan:PLAN-20260302-TOOLSCHEDULER.P03`**

**Test Structure:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P03
 * @requirement TS-EXEC-001 through TS-EXEC-007
 * 
 * Characterization tests for tool execution behavior in coreToolScheduler.
 * These tests exercise the EXISTING code to establish baseline behavior
 * before extraction to tool-executor.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreToolScheduler, type CoreToolSchedulerOptions } from './coreToolScheduler.js';
import { Config } from '../config/Config.js';
// ... other imports

describe('Tool Execution Characterization', () => {
  let scheduler: CoreToolScheduler;
  let config: Config;
  let mockTool: AnyDeclarativeTool;
  
  beforeEach(() => {
    // Setup minimal config and scheduler
    config = new Config(/* minimal config */);
    scheduler = new CoreToolScheduler({
      config,
      // ... minimal options
    });
  });

  describe('TS-EXEC-001: Single Tool State Transition', () => {
    it('transitions scheduled tool to success state with result', async () => {
      // GIVEN: A tool that returns success
      mockTool = createMockTool({
        name: 'test_tool',
        execute: async () => ({ llmContent: 'success', returnDisplay: 'Success' })
      });
      
      // WHEN: Tool is scheduled and executed
      await scheduler.schedule([{
        callId: 'call-001',
        name: 'test_tool',
        args: {},
      }], signal);
      
      // THEN: Tool reaches success state
      const completedCalls = await waitForCompletion(scheduler);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('success');
      expect(completedCalls[0].response.responseParts).toBeDefined();
    });

    it('transitions scheduled tool to error state on exception', async () => {
      // GIVEN: A tool that throws
      mockTool = createMockTool({
        name: 'failing_tool',
        execute: async () => { throw new Error('Test error'); }
      });
      
      // WHEN: Tool is scheduled and executed
      await scheduler.schedule([{
        callId: 'call-002',
        name: 'failing_tool',
        args: {},
      }], signal);
      
      // THEN: Tool reaches error state
      const completedCalls = await waitForCompletion(scheduler);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('error');
      expect(completedCalls[0].response.error).toBeDefined();
    });
  });

  describe('TS-EXEC-002: PID Tracking for Shell Tools', () => {
    it('reports PID for shell tools via callback', async () => {
      const pidUpdates: number[] = [];
      
      // GIVEN: A shell tool that reports PID
      mockTool = createShellTool({
        name: 'shell_tool',
        execute: async (signal, outputCb, undefined, undefined, pidCb) => {
          pidCb?.(12345);
          return { llmContent: 'done', returnDisplay: 'Done' };
        }
      });
      
      scheduler.setCallbacks({
        ...options,
        onToolCallsUpdate: (calls) => {
          const executing = calls.find(c => c.status === 'executing');
          if (executing?.pid) pidUpdates.push(executing.pid);
        }
      });
      
      // WHEN: Tool is executed
      await scheduler.schedule([{
        callId: 'call-003',
        name: 'shell_tool',
        args: {},
      }], signal);
      await waitForCompletion(scheduler);
      
      // THEN: PID is tracked during execution
      expect(pidUpdates).toContain(12345);
    });
  });

  describe('TS-EXEC-003: Live Output Streaming', () => {
    it('streams output chunks to callback during execution', async () => {
      const outputChunks: string[] = [];
      
      // GIVEN: A tool with streaming output
      mockTool = createStreamingTool({
        name: 'streaming_tool',
        execute: async (signal, outputCb) => {
          outputCb?.('chunk1');
          outputCb?.('chunk2');
          outputCb?.('chunk3');
          return { llmContent: 'final', returnDisplay: 'Final' };
        }
      });
      
      scheduler.setCallbacks({
        ...options,
        outputUpdateHandler: (callId, chunk) => {
          if (typeof chunk === 'string') outputChunks.push(chunk);
        }
      });
      
      // WHEN: Tool is executed
      await scheduler.schedule([{
        callId: 'call-004',
        name: 'streaming_tool',
        args: {},
      }], signal);
      await waitForCompletion(scheduler);
      
      // THEN: All chunks received in order
      expect(outputChunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });
  });

  describe('TS-EXEC-005: Error Handling Returns ErroredToolCall', () => {
    it('returns ErroredToolCall for execution errors without throwing', async () => {
      // GIVEN: A tool that throws during execution
      mockTool = createMockTool({
        name: 'error_tool',
        execute: async () => { throw new Error('Execution failed'); }
      });
      
      // WHEN: Tool is scheduled
      await scheduler.schedule([{
        callId: 'call-005',
        name: 'error_tool',
        args: {},
      }], signal);
      
      // THEN: Scheduler completes without throwing
      const completedCalls = await waitForCompletion(scheduler);
      expect(completedCalls[0].status).toBe('error');
      expect(completedCalls[0].response.error.message).toContain('Execution failed');
    });
  });

  describe('TS-EXEC-006: Cancellation via AbortSignal', () => {
    it('returns CancelledToolCall within 1 second of abort', async () => {
      const controller = new AbortController();
      
      // GIVEN: A long-running tool
      mockTool = createMockTool({
        name: 'slow_tool',
        execute: async (signal) => {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 10000);
            signal.addEventListener('abort', () => clearTimeout(timeout));
          });
          if (signal.aborted) throw new Error('Aborted');
          return { llmContent: 'done', returnDisplay: 'Done' };
        }
      });
      
      // WHEN: Tool is scheduled and aborted
      const schedulePromise = scheduler.schedule([{
        callId: 'call-006',
        name: 'slow_tool',
        args: {},
      }], controller.signal);
      
      setTimeout(() => controller.abort(), 100);
      
      const startTime = Date.now();
      await schedulePromise;
      const completedCalls = await waitForCompletion(scheduler);
      const endTime = Date.now();
      
      // THEN: Tool cancelled within 1 second
      expect(endTime - startTime).toBeLessThan(1000);
      expect(completedCalls[0].status).toBe('cancelled');
    });
  });

  describe('TS-EXEC-007: Hook Invocation', () => {
    it('invokes before and after hooks exactly once per execution', async () => {
      const hookCalls: string[] = [];
      
      // GIVEN: Hooks that track invocations
      vi.spyOn(config, 'getHookRegistry').mockReturnValue({
        executeBeforeToolHook: async () => {
          hookCalls.push('before');
          return undefined;
        },
        executeAfterToolHook: async () => {
          hookCalls.push('after');
          return undefined;
        },
      });
      
      mockTool = createMockTool({
        name: 'hooked_tool',
        execute: async () => ({ llmContent: 'result', returnDisplay: 'Result' })
      });
      
      // WHEN: Tool is executed
      await scheduler.schedule([{
        callId: 'call-007',
        name: 'hooked_tool',
        args: {},
      }], signal);
      await waitForCompletion(scheduler);
      
      // THEN: Hooks invoked in order
      expect(hookCalls).toEqual(['before', 'after']);
    });
  });
});

// Helper functions for test setup
function createMockTool(opts: { name: string; execute: Function }): AnyDeclarativeTool {
  // Return a mock DeclarativeTool that can be registered
}

function createShellTool(opts: { name: string; execute: Function }): AnyDeclarativeTool {
  // Return a shell tool mock with canUpdateOutput=true
}

function waitForCompletion(scheduler: CoreToolScheduler): Promise<CompletedToolCall[]> {
  // Wait for onAllToolCallsComplete callback
}
```

## Subagent Prompt

```
You are implementing Phase 03 of the CoreToolScheduler refactoring.

CONTEXT: This is a characterization phase. You are writing tests that EXERCISE the EXISTING behavior of coreToolScheduler.ts to establish a baseline before extraction.

TASK: Create packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts

WHAT TO DO:
1. Write tests that exercise launchToolExecution through the public schedule() API
2. Test each behavior from TS-EXEC-001 through TS-EXEC-007:
   - State transitions (scheduled → executing → success/error/cancelled)
   - PID tracking for shell tools
   - Live output streaming
   - Error handling (exceptions → ErroredToolCall)
   - Cancellation via AbortSignal
   - Hook invocation (before/after)
3. Use REAL tool execution (via mocked tools that behave like real ones)
4. Tests should PASS against UNMODIFIED coreToolScheduler.ts

CRITICAL RULES:
- DO NOT modify coreToolScheduler.ts (that's Phase 04)
- DO NOT stub behavior — test through public API with realistic mocks
- DO include @plan and @requirement markers
- Tests MUST pass against current code
- Use existing test utilities from coreToolScheduler.test.ts as reference

EXPECTED OUTPUT:
- New file: packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts (~400 lines)
- Tests pass when run against UNMODIFIED coreToolScheduler.ts
- Coverage: 7+ test cases covering TS-EXEC-001 through TS-EXEC-007

FORBIDDEN:
- Modifying coreToolScheduler.ts
- Testing implementation details (test through public API)
- Creating stubs that return dummy values
```

## Verification Commands

### Automated Checks

```bash
# Check file was created
test -f packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts || exit 1

# Check plan markers
grep "@plan:PLAN-20260302-TOOLSCHEDULER.P03" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts || exit 1

# Run tests against UNMODIFIED coreToolScheduler
npm test -- coreToolScheduler.toolExecutor.characterization.test.ts || exit 1

# Check coverage of TS-EXEC requirements
for req in TS-EXEC-001 TS-EXEC-002 TS-EXEC-003 TS-EXEC-004 TS-EXEC-005 TS-EXEC-006 TS-EXEC-007; do
  grep "$req" packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts || {
    echo "FAIL: $req not covered"
    exit 1
  }
done
```

## Success Criteria

- [ ] Test file created with characterization tests
- [ ] Tests pass against UNMODIFIED coreToolScheduler.ts
- [ ] All TS-EXEC-001 through TS-EXEC-007 requirements have test coverage
- [ ] Tests use realistic mocks (not dummy stubs)
- [ ] Plan markers present
- [ ] No modifications to coreToolScheduler.ts

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P03.md`

Contents:
```markdown
Phase: P03
Completed: [TIMESTAMP]
Files Created:
  - packages/core/src/core/coreToolScheduler.toolExecutor.characterization.test.ts (~400 lines)
Files Modified: None
Tests: 7+ characterization tests pass
Verification: All TS-EXEC requirements covered, tests pass against current code
```
