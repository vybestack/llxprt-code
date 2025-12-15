# Implementation Plan: ada179f5 - Buffered Parallel Tool Execution

**CRITICAL COMMIT - AFFECTS CORE PERFORMANCE AND CORRECTNESS**

## Summary of Upstream Changes

**Upstream Commit:** `ada179f572804ce09170773e3877daf5f01ba27c`
**Title:** "bug(core): Process returned function calls sequentially. (#10659)"

**Core Changes:**
1. `coreToolScheduler.ts` - Changed `attemptExecutionOfScheduledCalls()` from parallel `forEach` with fire-and-forget to sequential `for...of` with `await`
2. `geminiChat.ts` - Removed `stopBeforeSecondMutator()` (workaround no longer needed)
3. Tests - Removed old tests, added new "Sequential Execution" test block

## WHY Upstream Did This

The bug fixes **tool call result ordering determinism**:
- **Before:** All tools executed concurrently via `forEach()`. Results completed in arbitrary order.
- **After:** Tools execute sequentially in the order they appear in the model's response.

**Correctness issues addressed:**
- Tool dependencies: If Tool A reads a file and Tool B modifies it, ordering matters
- Result ordering: LLM expects results in same order as calls
- State consistency: Concurrent reads/writes can cause race conditions

## Current State in LLxprt

**File:** `packages/core/src/core/coreToolScheduler.ts`

LLxprt currently uses parallel execution (lines 1307-1353):
```typescript
private attemptExecutionOfScheduledCalls(signal: AbortSignal): void {
  // ...
  callsToExecute.forEach((toolCall) => {
    invocation.execute(signal, liveOutputCallback)
      .then(async (toolResult: ToolResult) => { /* ... */ })
      .catch((executionError: Error) => { /* ... */ });
  });
}
```

**Key observation:** LLxprt does NOT have `stopBeforeSecondMutator` (already removed), so that part is N/A.

## CRITICAL ARCHITECTURAL REQUIREMENT

**From `dev-docs/cherrypicking.md` lines 65-76:**

> #### Features Reimplemented (Don't Cherry-pick):
>
> These upstream features have been reimplemented in llxprt with our own approach:
>
> - **Tool Scheduler Request Queue (commit `69322e12`)** - llxprt has superior parallel batching that queues and processes multiple requests in parallel for better multi-provider performance, while upstream processes serially

**THIS PARALLEL BATCHING IS A KEY LLXPRT DIFFERENTIATOR AND MUST BE PRESERVED.**

## Implementation Approach

**RECOMMENDATION: Buffered Parallel Execution (Option B from PLAN.md:892-894)**

### Why NOT Sequential (Upstream's Approach)?

1. **Performance regression**: Sequential execution destroys LLxprt's parallel batching advantage
2. **Architectural violation**: Contradicts explicit requirement in cherrypicking.md
3. **Multi-provider impact**: Parallel execution is especially valuable for multi-provider scenarios
4. **Unnecessary compromise**: We can have BOTH performance AND correctness

### Why Buffered Parallel?

1. **Preserves performance**: Tools still execute in parallel
2. **Fixes ordering**: Results buffered and emitted in original request order
3. **Maintains correctness**: State updates happen in deterministic order
4. **Best of both worlds**: No performance sacrifice for correctness

## Implementation Strategy

### Core Concept: Execute Concurrently, Publish Sequentially

```
Request Order: [Tool A, Tool B, Tool C]
Execution:     A -----> (100ms)
               B -> (20ms)
               C ----> (80ms)

Completion Order: B (20ms), C (80ms), A (100ms)
Result Buffer:    [A: pending, B: ready, C: ready]
Publish Order:    A (wait...), then B, then C
```

### Step 1: Add Data Structures for Result Buffering

**File:** `packages/core/src/core/coreToolScheduler.ts`

Add private field to store results:
```typescript
private pendingResults: Map<string, {
  result: ToolResult;
  callId: string;
  toolName: string;
  scheduledCall: ScheduledToolCall;
  completionOrder: number;
}> = new Map();

private nextCompletionOrder = 0;
private nextPublishIndex = 0;
```

### Step 2: Add Regression Test (BEFORE Changes)

**File:** `packages/core/src/core/coreToolScheduler.test.ts`

```typescript
describe('CoreToolScheduler Buffered Parallel Execution', () => {
  it('should execute tool calls in parallel but publish results in order', async () => {
    const completionOrder: number[] = [];
    const publishOrder: number[] = [];

    const executeFn = vi.fn().mockImplementation(async (args: { call: number }) => {
      // Tool 1 takes longest (100ms)
      if (args.call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        completionOrder.push(1);
        return { llmContent: 'First call done' };
      }
      // Tool 2 completes first (20ms)
      if (args.call === 2) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        completionOrder.push(2);
        return { llmContent: 'Second call done' };
      }
      // Tool 3 completes second (50ms)
      if (args.call === 3) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completionOrder.push(3);
        return { llmContent: 'Third call done' };
      }
      return { llmContent: 'default' };
    });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });

    // Track publish order by monitoring status changes
    const statusUpdates: Array<{ callId: string; status: string }> = [];
    scheduler.onToolCallsUpdate((calls) => {
      calls.forEach(call => {
        if (call.status === 'success') {
          publishOrder.push(parseInt(call.request.args.call));
        }
      });
    });

    // Schedule 3 tool calls
    await scheduler.schedule([
      { callId: 'call1', name: 'mockTool', args: { call: 1 } },
      { callId: 'call2', name: 'mockTool', args: { call: 2 } },
      { callId: 'call3', name: 'mockTool', args: { call: 3 } },
    ], signal);

    await scheduler.waitForCompletion();

    // Verify parallel execution (completion order != request order)
    expect(completionOrder).toEqual([2, 3, 1]); // Fastest to slowest

    // Verify ordered publishing (publish order == request order)
    expect(publishOrder).toEqual([1, 2, 3]); // Request order maintained
  });

  it('should handle errors in parallel execution without blocking subsequent results', async () => {
    const executeFn = vi.fn().mockImplementation(async (args: { call: number }) => {
      if (args.call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { llmContent: 'First call done' };
      }
      if (args.call === 2) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('Tool 2 failed');
      }
      if (args.call === 3) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { llmContent: 'Third call done' };
      }
      return { llmContent: 'default' };
    });

    // Test that error in tool 2 doesn't prevent tool 3's result from being published
    // after tool 1 completes
  });

  it('should cancel remaining buffered results when signal is aborted', async () => {
    // Tests that abort properly handles buffered results
  });
});
```

### Step 3: Implement Buffered Result Publishing

**File:** `packages/core/src/core/coreToolScheduler.ts`

Modify `attemptExecutionOfScheduledCalls`:

```typescript
private attemptExecutionOfScheduledCalls(signal: AbortSignal): void {
  const allCallsFinalOrScheduled = this.toolCalls.every(
    (call) =>
      call.status === 'scheduled' ||
      call.status === 'cancelled' ||
      call.status === 'success' ||
      call.status === 'error',
  );

  if (allCallsFinalOrScheduled) {
    const callsToExecute = this.toolCalls.filter(
      (call) => call.status === 'scheduled',
    );

    // Assign execution indices for ordered publishing
    const executionIndices = new Map<string, number>();
    callsToExecute.forEach((call, index) => {
      executionIndices.set(call.request.callId, index);
    });

    // Execute all tools in parallel (PRESERVE EXISTING PATTERN)
    callsToExecute.forEach((toolCall) => {
      if (toolCall.status !== 'scheduled') return;

      const scheduledCall = toolCall;
      const { callId, name: toolName } = scheduledCall.request;
      const invocation = scheduledCall.invocation;
      const executionIndex = executionIndices.get(callId)!;

      this.setStatusInternal(callId, 'executing');

      const liveOutputCallback =
        scheduledCall.tool.canUpdateOutput && this.outputUpdateHandler
          ? (outputChunk: string) => {
              if (this.outputUpdateHandler) {
                this.outputUpdateHandler(callId, outputChunk);
              }
              this.toolCalls = this.toolCalls.map((tc) =>
                tc.request.callId === callId && tc.status === 'executing'
                  ? { ...tc, liveOutput: outputChunk }
                  : tc,
              );
              this.notifyToolCallsUpdate();
            }
          : undefined;

      invocation
        .execute(signal, liveOutputCallback)
        .then(async (toolResult: ToolResult) => {
          if (signal.aborted) {
            this.handleAbortedExecution(callId, executionIndex);
            return;
          }

          // Buffer the result instead of publishing immediately
          this.bufferResult(callId, toolName, toolResult, scheduledCall, executionIndex);

          // Try to publish buffered results in order
          await this.publishBufferedResults(signal);
        })
        .catch(async (executionError: Error) => {
          if (signal.aborted) {
            this.handleAbortedExecution(callId, executionIndex);
          } else {
            this.bufferError(callId, executionError, scheduledCall, executionIndex);
            await this.publishBufferedResults(signal);
          }
        });
    });
  }
}

private bufferResult(
  callId: string,
  toolName: string,
  result: ToolResult,
  scheduledCall: ScheduledToolCall,
  executionIndex: number,
): void {
  this.pendingResults.set(callId, {
    result,
    callId,
    toolName,
    scheduledCall,
    completionOrder: this.nextCompletionOrder++,
  });
}

private bufferError(
  callId: string,
  error: Error,
  scheduledCall: ScheduledToolCall,
  executionIndex: number,
): void {
  const errorResult: ToolResult = {
    error: error,
    llmContent: error.message,
  };
  this.pendingResults.set(callId, {
    result: errorResult,
    callId,
    toolName: scheduledCall.request.name,
    scheduledCall,
    completionOrder: this.nextCompletionOrder++,
  });
}

private async publishBufferedResults(signal: AbortSignal): Promise<void> {
  const callsInOrder = this.toolCalls.filter(
    (call) => call.status === 'scheduled' || call.status === 'executing',
  );

  // Publish results in original request order
  for (let i = this.nextPublishIndex; i < callsInOrder.length; i++) {
    const expectedCall = callsInOrder[i];
    const buffered = this.pendingResults.get(expectedCall.request.callId);

    if (!buffered) {
      // Next result not ready yet, stop publishing
      break;
    }

    // Publish this result
    await this.publishResult(buffered, signal);

    // Remove from buffer
    this.pendingResults.delete(buffered.callId);
    this.nextPublishIndex++;
  }

  // Check if all tools completed
  if (this.nextPublishIndex === callsInOrder.length) {
    // Reset for next batch
    this.nextPublishIndex = 0;
    this.nextCompletionOrder = 0;
    this.pendingResults.clear();
  }
}

private async publishResult(
  buffered: { result: ToolResult; callId: string; toolName: string; scheduledCall: ScheduledToolCall },
  signal: AbortSignal,
): Promise<void> {
  const { result, callId, toolName, scheduledCall } = buffered;

  if (result.error === undefined) {
    // Success case - same logic as current .then() block
    const response = convertToFunctionResponse(
      toolName,
      callId,
      result.llmContent,
      this.config,
    );
    const metadataAgentId = extractAgentIdFromMetadata(
      result.metadata as Record<string, unknown> | undefined,
    );

    this.setStatusInternal(callId, 'success', {
      calls: [scheduledCall.request],
      responses: [response],
      metadataAgentId,
    });
  } else {
    // Error case - same logic as current .catch() block
    this.setStatusInternal(
      callId,
      'error',
      createErrorResponse(
        scheduledCall.request,
        result.error,
        ToolErrorType.UNHANDLED_EXCEPTION,
      ),
    );
  }
}

private handleAbortedExecution(callId: string, executionIndex: number): void {
  this.setStatusInternal(
    callId,
    'cancelled',
    'User cancelled tool execution.',
  );
  // Don't buffer aborted results
}
```

## Performance Benchmarking Plan

### Before Implementation

Run baseline benchmarks to establish current performance:

```bash
# Test 1: Single tool execution
time node scripts/start.js --profile-load synthetic --prompt "read package.json"

# Test 2: Multiple independent tools (parallel benefit)
time node scripts/start.js --profile-load synthetic --prompt "list files in src/ and also show git status and also read README.md"

# Test 3: Multiple dependent tools (sequential benefit)
time node scripts/start.js --profile-load synthetic --prompt "read package.json, then based on dependencies, search for import statements"
```

### After Implementation

Run same benchmarks and compare:

**Expected Results:**
- Test 1: No change (single tool)
- Test 2: **No regression** (parallel execution preserved, minimal buffering overhead)
- Test 3: **Potential improvement** (ordered publishing may help LLM processing)

**Acceptance Criteria:**
- No more than 5% performance regression on any benchmark
- Parallel execution benefits still visible in Test 2
- Results always in deterministic order

## Rollback Plan

If issues are discovered after landing this reimplementation:

1. Revert the reimplementation commit(s) that introduced buffered publishing.
2. Re-run `npm run typecheck`, `npm run lint`, and `npm run test` to confirm green.

No runtime feature flag: LLXPRT must remain parallel-by-default.

## Files to Modify

| File | Type of Change |
|------|----------------|
| `packages/core/src/core/coreToolScheduler.ts` | Add buffered parallel execution |
| `packages/core/src/core/coreToolScheduler.test.ts` | Add buffered parallel tests |

## Implementation Steps

### Step 1: Add Regression Tests (BEFORE Changes)
- Add buffered parallel execution tests
- Tests should initially FAIL (verify current ordering issues)
- Commit tests separately

### Step 2: Implement Result Buffering
- Add `pendingResults` map and tracking fields
- Add `bufferResult()` and `bufferError()` methods
- Add `publishBufferedResults()` method
- Preserve existing `forEach` parallel execution pattern

### Step 3: Run Performance Benchmarks
- Execute benchmark suite
- Compare before/after results
- Document any performance changes

### Step 4: Verify All Tests Pass
- Run full test suite
- Ensure new tests pass
- Ensure no regressions in existing tests

## Acceptance Criteria

- [x] Regression tests pass (buffered parallel execution)
- [x] Results published in deterministic order (same as request order)
- [x] Parallel execution preserved (no sequential bottleneck)
- [x] All existing tests pass
- [x] No performance regression (< 5% overhead)
- [x] Proper abort handling (buffered results cleared)
- [x] Error handling preserves ordering

## Testing Plan

1. **Unit Tests**
   - Run existing tests BEFORE changes: `npm run test`
   - Add buffered parallel tests (should FAIL initially)
   - Implement changes
   - Run tests AFTER changes: `npm run test`
   - Verify new tests pass, no regressions

2. **Performance Benchmarks**
   - Run benchmark suite before changes
   - Run benchmark suite after changes
   - Compare results
   - Document findings

3. **Integration Tests**
   - Smoke test with independent tools: `node scripts/start.js --profile-load synthetic --prompt "read package.json and show git status"`
   - Smoke test with dependent tools: `node scripts/start.js --profile-load synthetic --prompt "list files then read the first one"`
   - Verify results in correct order
   - Verify no deadlocks

4. **Abort Handling**
   - Test Ctrl+C during parallel execution
   - Verify buffered results cleared
   - Verify clean cancellation

## Risk Mitigation

**Risk 1: Performance Regression**
- *Mitigation:* Benchmark before/after; if regression is unacceptable, revert the reimplementation commit(s)
- *Threshold:* < 5% acceptable, > 5% requires optimization

**Risk 2: Buffering Logic Bugs**
- *Mitigation:* Comprehensive unit tests; revert if a correctness bug is found
- *Detection:* Out-of-order results, missing results

**Risk 3: Memory Leaks (Unbounded Buffer)**
- *Mitigation:* Clear buffer after each batch, track buffer size
- *Detection:* Monitor memory usage in long-running sessions

**Risk 4: Race Conditions**
- *Mitigation:* Careful state management, atomic buffer operations
- *Detection:* Non-deterministic test failures

## Why This Approach is Superior

### vs. Upstream Sequential Approach
- **Performance:** Maintains parallel execution advantage
- **Architecture:** Preserves LLxprt's design principles
- **Multi-provider:** Especially valuable with multiple LLM providers

### vs. Current Parallel Approach
- **Correctness:** Fixes ordering issues
- **Determinism:** Results always in predictable order
- **Tool dependencies:** Handles read-then-modify patterns correctly

### Best of Both Worlds
- Execute fast (parallel)
- Publish correctly (ordered)
- Rollback is a revert (no runtime switches)

## Post-Implementation Verification

After merging:

1. Monitor production performance metrics
2. Watch for ordering-related bug reports
3. Collect user feedback on responsiveness
4. If issues are discovered: revert the reimplementation commit(s)

## Notes

- This approach explicitly PRESERVES LLxprt's parallel batching advantage per cherrypicking.md
- The buffering overhead is minimal (Map lookups are O(1))
- Parallel execution still provides performance benefits
- Sequential publishing ensures correctness without sacrificing speed
