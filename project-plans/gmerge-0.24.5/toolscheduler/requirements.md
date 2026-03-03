# CoreToolScheduler Refactoring Requirements

**Version:** 1.1  
**Date:** 2026-03-02  
**Status:** Draft (Revised)

---

## Document Purpose

This document specifies the functional and technical requirements for refactoring `packages/core/src/core/coreToolScheduler.ts` from a 2,139-line monolithic file into a modular architecture. Requirements focus on **observable behaviors** rather than implementation details.

---

## 1. Type Extraction Requirements

### TS-TYPE-001
**Requirement:** When a consumer imports a ToolCall state type, the system shall provide that type from `scheduler/types.ts` without requiring changes to existing import statements.  
**Priority:** MUST  
**Rationale:** Centralize type definitions for reuse while maintaining backward compatibility.  
**Verification:** Compiler confirms no import errors; existing tests pass without modification.

**Observable Behavior:**
- Existing imports from `coreToolScheduler.ts` continue to work (re-exports)
- New code can import from `scheduler/types.ts` directly
- TypeScript compilation succeeds

### TS-TYPE-002
**Requirement:** When the scheduler creates a ToolCall state object, the system shall ensure the type discriminant (`status` field) accurately reflects the tool's lifecycle stage.  
**Priority:** MUST  
**Rationale:** State machine correctness depends on accurate type guards.  
**Verification:** Runtime tests verify state transitions; type guards work correctly in all modules.

### TS-TYPE-003
**Requirement:** The system shall prevent circular dependency errors when `scheduler/types.ts` is imported by any module.  
**Priority:** MUST  
**Rationale:** Circular dependencies cause build failures and runtime issues in ESM.  
**Verification:** Build succeeds; module graph analysis shows no cycles involving types.ts.

**Observable Behavior:**
- `scheduler/types.ts` imports only from leaf modules (e.g., `from '../tools/tool.js'`), NEVER from `../index.js`
- Build completes without module resolution errors
- ESM runtime loading succeeds

### TS-TYPE-004
**Requirement:** When handler callbacks are invoked, the system shall provide type-safe parameters matching the handler type definitions.  
**Priority:** MUST  
**Rationale:** Type safety prevents runtime errors from incorrect callback signatures.  
**Verification:** TypeScript compiler enforces callback signatures; tests verify runtime behavior.

---

## 2. Tool Execution Extraction Requirements

### TS-EXEC-001
**Requirement:** When a scheduled tool is executed, the system shall transition it from `scheduled` or `executing` status to a terminal status (`success`, `error`, or `cancelled`) exactly once per execution attempt.  
**Priority:** MUST  
**Rationale:** Single-tool execution is a state machine transition that must complete atomically.  
**Verification:** Unit tests verify state transitions; integration tests confirm no duplicate completions.

**Observable Behavior:**
- Input: `ScheduledToolCall` or `ExecutingToolCall`
- Output: `CompletedToolCall` (success/error/cancelled)
- No partial state updates
- Execution completes even if signal is aborted (returns `CancelledToolCall`)

### TS-EXEC-002
**Requirement:** When a tool execution produces a PID, the system shall notify the scheduler via a dedicated PID callback promptly after PID availability.  
**Priority:** MUST  
**Rationale:** PID tracking enables cancellation of shell tools and UI display of process information.  
**Verification:** Integration tests verify PID updates appear in ToolCall state.

**Observable Behavior:**
- Shell tools receive `onPid(callId, pid)` callback exactly once when PID is available
- Non-shell tools do NOT invoke PID callback
- PID value matches actual system process ID
- Scheduler state reflects PID after callback

### TS-EXEC-003
**Requirement:** When a tool execution produces live output, the system shall stream output chunks to the scheduler via a dedicated output callback without buffering more than 1KB between notifications.  
**Priority:** MUST  
**Rationale:** Live output streaming enables real-time UI updates for long-running tools.  
**Verification:** Integration tests verify output chunks arrive incrementally; UI tests confirm real-time display.

**Observable Behavior:**
- Tools with streaming output receive `onLiveOutput(callId, chunk)` callback for each chunk
- Chunks delivered in chronological order
- Total output reconstructable from chunks

### TS-EXEC-004
**Requirement:** When a shell tool produces output exceeding the configured truncation threshold, the system shall save the full output to a temporary file and return truncated content with file path instructions.  
**Priority:** MUST  
**Rationale:** Large outputs must fit in context window while preserving full data for user access.  
**Verification:** Integration tests verify file creation and truncation message format.

**Observable Behavior:**
- Full output saved to `<projectTempDir>/tool-output-<callId>.txt`
- Truncated content includes: first N lines + "[Output truncated. Full output saved to: ...]"
- File exists and contains complete output
- Telemetry event logged: `ToolOutputTruncatedEvent`

### TS-EXEC-005
**Requirement:** When a tool execution encounters an error, the system shall return an `ErroredToolCall` with the error message and type, and shall NOT throw an exception to the caller.  
**Priority:** MUST  
**Rationale:** Errors are expected outcomes, not exceptional conditions; scheduler must handle gracefully.  
**Verification:** Unit tests verify error handling; integration tests confirm scheduler continues after errors.

**Observable Behavior:**
- Input: Tool throws exception
- Output: `ErroredToolCall` with `response.error` and `response.errorType`
- No uncaught exceptions
- Scheduler processes remaining tools in batch

### TS-EXEC-006
**Requirement:** When a tool execution is aborted via signal, the system shall return a `CancelledToolCall` within 1 second of abort signal firing.  
**Priority:** MUST  
**Rationale:** Cancellation must be responsive to user action.  
**Verification:** Integration tests verify cancellation behavior; stress tests confirm no hung executions.

**Observable Behavior:**
- Abort signal triggers cancellation
- `CancelledToolCall` returned with message "Tool call cancelled by user."
- Execution stops (no further side effects)
- Cancellation completes within 1 second

### TS-EXEC-007
**Requirement:** When tool execution begins, the system shall invoke before-tool hooks, and when execution completes, the system shall invoke after-tool hooks exactly once per execution.  
**Priority:** MUST  
**Rationale:** Hooks enable telemetry, logging, and policy enforcement.  
**Verification:** Integration tests verify hook invocation counts and ordering.

**Observable Behavior:**
- Before hook invoked before tool invocation
- After hook invoked after completion (success/error/cancelled)
- Hook order: before → execute → after
- Hooks invoked exactly once per execution

---

## 3. Parallel Batching Requirements (Observable Acceptance Criteria)

### TS-BATCH-001
**Requirement:** When N tools are scheduled in a batch, the system shall execute all N tools concurrently and shall publish results in the original scheduling order (by `executionIndex`), regardless of completion order.  
**Priority:** MUST  
**Rationale:** Deterministic result ordering is critical for reproducibility and debugging.  
**Verification:** Integration test with 5 tools completing in reverse order; verify result order matches scheduling order.

**Observable Behavior:**
- Input: Schedule tools [A, B, C, D, E] with indices [0, 1, 2, 3, 4]
- Execution: Tools complete in order [E, C, A, D, B] (shuffled)
- Output: Results published in order [A, B, C, D, E] (original)
- All executions start concurrently (within same event loop tick via Promise.all)

**Test Scenario:**
```typescript
// Schedule 5 read_file calls with staggered delays
const tools = [
  { name: 'read_file', delay: 500ms },  // index 0
  { name: 'read_file', delay: 100ms },  // index 1
  { name: 'read_file', delay: 300ms },  // index 2
  { name: 'read_file', delay: 50ms },   // index 3
  { name: 'read_file', delay: 200ms },  // index 4
];
// Expected completion order: [3, 1, 4, 2, 0]
// Expected publish order: [0, 1, 2, 3, 4]
// Verify: responseArray[i].callId === tools[i].callId
```

### TS-BATCH-002
**Requirement:** When `publishBufferedResults` is invoked concurrently (e.g., from multiple completing tools), the system shall ensure exactly one publish operation executes at a time and all results are published exactly once.  
**Priority:** MUST  
**Rationale:** Reentrancy guard prevents race conditions and duplicate publishing.  
**Verification:** Stress test with 10 tools completing simultaneously; verify no duplicate results.

**Observable Behavior:**
- Multiple `publishBufferedResults` calls → serialized execution
- `isPublishingBufferedResults` flag prevents reentrancy
- `pendingPublishRequest` flag triggers retry after current publish completes
- Each buffered result published exactly once

**Test Scenario:**
```typescript
// Simulate 3 tools completing simultaneously
await Promise.all([
  launchToolExecution(tool0, 0, signal),
  launchToolExecution(tool1, 1, signal),
  launchToolExecution(tool2, 2, signal),
]);
// Verify: 3 publish events, no duplicates, correct order
```

### TS-BATCH-003
**Requirement:** After all tools in a batch are published, the system shall reset `nextPublishIndex` to 0 and clear `pendingResults` map to prepare for the next batch.  
**Priority:** MUST  
**Rationale:** Batch state must be isolated between batches to prevent cross-contamination.  
**Verification:** Integration test schedules two sequential batches; verify second batch starts clean.

**Observable Behavior:**
- After batch 1 completes: `nextPublishIndex === 0`, `pendingResults.size === 0`
- After batch 2 starts: No results from batch 1 in `pendingResults`
- Each batch is independent

**Test Scenario:**
```typescript
// Batch 1: Schedule 3 tools, wait for completion
await schedule([tool0, tool1, tool2], signal);
await waitForCompletion();
// Verify: nextPublishIndex === 0, pendingResults.size === 0

// Batch 2: Schedule 2 tools, verify clean state
await schedule([tool3, tool4], signal);
// Verify: nextPublishIndex === 0 at start, no batch 1 results buffered
```

### TS-BATCH-004
**Requirement:** When the configured token budget is exceeded by a parallel batch, the system shall divide the budget equally among batch members before execution begins.  
**Priority:** MUST  
**Rationale:** Batch output limits prevent context overflow when many tools run in parallel.  
**Verification:** Integration test with 5 tools and 1000-token budget; verify each tool limited to 200 tokens.

**Observable Behavior:**
- Global budget: 1000 tokens
- Batch size: 5 tools
- Per-tool budget: 1000 / 5 = 200 tokens
- Each tool output truncated to 200 tokens max
- Total batch output <= 1000 tokens

**Test Scenario:**
```typescript
// Configure 1000 token limit
config.setToolOutputMaxTokens(1000);

// Schedule 5 tools that each produce 500 tokens
const tools = Array(5).fill({ name: 'read_file', size: 500 });
await schedule(tools, signal);

// Verify: Each result <= 200 tokens
for (const result of results) {
  assert(countTokens(result) <= 200);
}
assert(countTokens(results.join('')) <= 1000);
```

### TS-BATCH-005
**Requirement:** When a tool in a batch is cancelled before completion, the system shall buffer a cancelled placeholder to advance `nextPublishIndex` past that tool without blocking remaining results.  
**Priority:** MUST  
**Rationale:** Cancellation should not block other tools in the batch; ordered publishing must continue.  
**Verification:** Integration test cancels tool at index 1 in batch of 3; verify scheduler state advances correctly.

**Observable Behavior:**
- Batch: [tool0, tool1, tool2] with indices [0, 1, 2]
- Tool1 cancelled after scheduling but before completion
- Scheduler transitions tool1 to `cancelled` status immediately (via `setStatusInternal`)
- Buffering system stores cancelled placeholder with `isCancelled: true` flag
- When `nextPublishIndex === 1`, placeholder skipped (NO publish call), index advances to 2
- Tool0 and tool2 results published normally at their indices
- Order preserved: tool0 published at index 0, tool1 skipped at index 1, tool2 published at index 2

**Corrected Cancellation Semantics (addresses review finding #4):**
- Each tool execution receives its own `AbortSignal` (shared across batch from single `schedule()` call)
- Aborting signal cancels ALL tools in batch that haven't completed yet
- Per-tool cancellation NOT supported (would require per-tool AbortController, which current design doesn't have)
- Cancellation flow: signal.abort() → launchToolExecution catches abort → setStatusInternal('cancelled') → bufferCancelled(..., isCancelled: true) → publishBufferedResults skips when isCancelled flag set

**Test Scenario:**
```typescript
// Schedule 3 tools with shared abort signal
const [tool0, tool1, tool2] = [slowTool, fastTool, slowTool];
const controller = new AbortController();
void schedule([tool0, tool1, tool2], controller.signal);

// Cancel entire batch after tool1 starts
await waitForToolStart(tool1);
controller.abort();

// Expected states:
// - tool0: may be success (if fast) or cancelled (if aborted during execution)
// - tool1: cancelled (was executing when aborted)
// - tool2: cancelled (was executing when aborted)

// Verify: All tools reach terminal state (success or cancelled)
// Verify: nextPublishIndex advances through all indices (0, 1, 2)
// Verify: Batch completion fires once
```

---

## 4. Response Formatting Requirements

### TS-RESP-001
**Requirement:** When tool output contains text, binary data (images/PDFs), and fileData, the system shall format the response as a Gemini FunctionResponse with text in the response object and binary content as sibling parts.  
**Priority:** MUST  
**Rationale:** Different Gemini models have different multimodal support requirements.  
**Verification:** Unit tests verify part structure for text-only, binary-only, and mixed outputs.

**Observable Behavior:**
- Text → `{ functionResponse: { response: { output: text } } }`
- Binary → `{ functionResponse: { response: { output: "Binary content provided..." } } }` + sibling inlineData parts
- Mixed → FunctionResponse with text + sibling binary parts

### TS-RESP-002
**Requirement:** When tool output exceeds the per-tool token limit, the system shall truncate the text content and preserve the FunctionResponse structure.  
**Priority:** MUST  
**Rationale:** Token limits must be enforced without breaking response format.  
**Verification:** Unit tests verify truncated output still has valid FunctionResponse structure.

**Observable Behavior:**
- Output > limit → truncated to limit
- FunctionResponse structure preserved
- No corruption of JSON or Part format

---

## 5. Utility Function Requirements

### TS-UTIL-001
**Requirement:** When a tool name is not found in the registry, the system shall suggest up to 3 similar tool names using Levenshtein distance.  
**Priority:** SHOULD  
**Rationale:** User experience is improved when typos are detected and corrected.  
**Verification:** Unit tests verify suggestion accuracy and performance.

**Observable Behavior:**
- Unknown tool: "read_flie" → suggests "read_file"
- Unknown tool: "xyz" → no suggestions (distance too high)
- Synchronous computation (no async overhead)

### TS-UTIL-002
**Requirement:** When tool execution errors occur, the system shall create error responses with consistent structure including callId, error message, errorType, and agentId.  
**Priority:** MUST  
**Rationale:** Standardized error responses enable consistent error handling in UI and logs.  
**Verification:** Unit tests verify error response structure; integration tests confirm LLM receives errors.

**Observable Behavior:**
- Error response includes: `callId`, `error`, `errorType`, `agentId`
- FunctionResponse format: `{ response: { error: message } }`
- ErrorType enum values used consistently

---

## 6. Backward Compatibility Requirements

### TS-COMPAT-001
**Requirement:** After refactoring, the system shall continue to accept imports of ToolCall types from `coreToolScheduler.ts` without compilation errors.  
**Priority:** MUST  
**Rationale:** Existing code that imports types from coreToolScheduler must continue to work without changes.  
**Verification:** Existing codebase compiles; no import errors; tests pass without modification.

**Observable Behavior:**
- Old import: `import { ToolCall } from './coreToolScheduler.js'` → works
- New import: `import { ToolCall } from '../scheduler/types.js'` → works
- Both resolve to same type definition

### TS-COMPAT-002
**Requirement:** The public API of the `CoreToolScheduler` class shall remain unchanged after refactoring.  
**Priority:** MUST  
**Rationale:** Consumers of CoreToolScheduler (GeminiChat, CLI, tests) must not require modifications.  
**Verification:** API surface comparison before/after; existing tests pass without modification.

**Observable Behavior:**
- Same constructor signature
- Same public methods: `schedule`, `setCallbacks`, `dispose`, `cancelAll`
- Same callback types
- No new required parameters

---

## 7. State Management Requirements

### TS-STATE-001
**Requirement:** When a tool call transitions from one status to another, the system shall apply agent ID fallback logic (request.agentId → metadata.agentId → DEFAULT_AGENT_ID) exactly once per transition.  
**Priority:** MUST  
**Rationale:** Consistent agent attribution is required for multi-agent scenarios.  
**Verification:** Integration tests verify agent ID assignment across all state transitions.

**Observable Behavior:**
- Request with agentId → uses request.agentId
- Request without agentId but with metadata.agentId → uses metadata.agentId
- Request without either → uses DEFAULT_AGENT_ID
- Agent ID set on `response` object in success/error states

### TS-STATE-002
**Requirement:** When args are updated on a ToolCall, the system shall inject ContextAwareTool context (sessionId, agentId, interactiveMode) before rebuilding the invocation.  
**Priority:** MUST  
**Rationale:** Tools may depend on context for behavior (e.g., file paths, permissions).  
**Verification:** Integration tests verify context is available in tool invocations.

**Observable Behavior:**
- ContextAwareTool instances receive context before invocation
- Context includes: sessionId, agentId, interactiveMode
- Context values match scheduler configuration

### TS-STATE-003
**Requirement:** When duplicate tool call IDs are scheduled, the system shall execute each unique callId exactly once and ignore subsequent duplicates.  
**Priority:** MUST  
**Rationale:** Prevents duplicate execution if LLM repeats a tool call.  
**Verification:** Integration test schedules same callId twice; verify single execution.

**Observable Behavior:**
- Schedule callId "abc123" twice
- First execution proceeds normally
- Second scheduling is ignored (no error, no execution)
- `seenCallIds` set prevents duplicates

---

## 8. Confirmation Flow Requirements

### TS-CONFIRM-001
**Requirement:** When a tool requires confirmation, the system shall publish a confirmation request to the message bus and transition the tool to `awaiting_approval` status synchronously.  
**Priority:** MUST  
**Rationale:** Confirmation flow must be responsive to enable interactive policy enforcement.  
**Verification:** Integration tests verify message bus publication and state transition.

**Observable Behavior:**
- Tool requires confirmation → state becomes `awaiting_approval`
- Message bus receives TOOL_CONFIRMATION_REQUEST
- Correlation ID stored in `pendingConfirmations` map
- State transition from shouldConfirmExecute to awaiting_approval is synchronous

### TS-CONFIRM-002
**Requirement:** When a confirmation response arrives via message bus, the system shall process the response exactly once even if duplicate messages arrive.  
**Priority:** MUST  
**Rationale:** Message bus may deliver duplicates; idempotency prevents double-execution.  
**Verification:** Integration test sends duplicate confirmation responses; verify single execution.

**Observable Behavior:**
- First confirmation response → processes normally
- Duplicate confirmation response → ignored (logged if debug enabled)
- `processedConfirmations` set prevents duplicates
- Tool executes exactly once

### TS-CONFIRM-003
**Requirement:** When a tool is modified via editor and a new correlation ID is created, the system shall ignore responses for the stale correlation ID for at least 30 seconds.  
**Priority:** MUST  
**Rationale:** UI may send responses for old correlation ID after editor modification; prevent race conditions.  
**Verification:** Integration test modifies tool and sends response to old correlation ID; verify ignored.

**Observable Behavior:**
- Original correlationId: "abc123"
- ModifyWithEditor creates new correlationId: "def456"
- Response arrives for "abc123" → ignored (logged as stale)
- `staleCorrelationIds` map tracks old ID with 30-second timeout
- After 30 seconds, stale ID removed from tracking

---

## 9. Lifecycle & Cleanup Requirements

### TS-LIFE-001
**Requirement:** When `dispose()` is called, the system shall unsubscribe from the message bus, clear all pending confirmations, and cancel all stale correlation ID timeouts within 1 second.  
**Priority:** MUST  
**Rationale:** Proper cleanup prevents memory leaks and dangling subscriptions.  
**Verification:** Integration tests verify cleanup; memory profiling confirms no leaks.

**Observable Behavior:**
- Message bus unsubscribe callback invoked
- `pendingConfirmations` map cleared
- `processedConfirmations` set cleared
- `seenCallIds` set cleared
- All `staleCorrelationIds` timeouts cancelled
- Cleanup completes within 1 second

### TS-LIFE-002
**Requirement:** When `cancelAll()` is called, the system shall cancel all queued requests, reset batch state, and transition all active tools to `cancelled` status within 1 second.  
**Priority:** MUST  
**Rationale:** User cancellation must be immediate and comprehensive.  
**Verification:** Integration tests verify all tools cancelled; stress tests confirm cleanup.

**Observable Behavior:**
- All queued requests rejected with error
- `pendingResults` map cleared
- `nextPublishIndex` reset to 0
- `currentBatchSize` reset to 0
- `isPublishingBufferedResults` reset to false
- `pendingPublishRequest` reset to false
- `processedConfirmations` cleared
- `seenCallIds` cleared
- `batchOutputConfig` cleared
- All active tools → `cancelled` status
- Cleanup completes within 1 second

### TS-LIFE-003
**Requirement:** When `schedule()` receives an aborted signal, the system shall remove the request from the queue and reject the promise with a cancellation error promptly.  
**Priority:** MUST  
**Rationale:** Queue abort must be responsive to enable immediate cancellation.  
**Verification:** Integration tests verify abort handler cleanup.

**Observable Behavior:**
- Request queued with abort signal
- Signal aborted while in queue
- Request removed from queue
- Promise rejected with "Tool call cancelled while in queue."
- Cleanup completes synchronously (no lingering timers or callbacks)

---

## 10. Testing Requirements

### TS-TEST-001
**Requirement:** Unit tests for extracted modules shall achieve at least 90% line coverage and 85% branch coverage.  
**Priority:** SHOULD  
**Rationale:** High code coverage ensures confidence in the refactored code.  
**Verification:** Coverage report meets thresholds; CI enforces minimums.

**Modules:**
- `scheduler/tool-executor.ts`: 90% line, 85% branch
- `utils/generateContentResponseUtilities.ts`: 90% line, 85% branch
- `utils/fileUtils.ts` (new functions): 90% line, 85% branch
- `utils/tool-utils.ts` (new functions): 90% line, 85% branch

### TS-TEST-002
**Requirement:** Integration tests shall verify parallel execution order preservation for batch sizes from 1 to 10 tools.  
**Priority:** MUST  
**Rationale:** Parallel batching is LLxprt's competitive advantage and must be thoroughly tested.  
**Verification:** Parameterized tests with batch sizes [1, 2, 3, 5, 10]; verify order in all cases.

**Test Matrix:**
- Batch size 1: Order trivially preserved
- Batch size 2: Verify second tool waits for first
- Batch size 3: Verify middle tool completion order doesn't affect publish order
- Batch size 5: Shuffled completion order → original publish order
- Batch size 10: Stress test with random delays → verify order

### TS-TEST-003
**Requirement:** Integration tests shall verify reentrancy guard behavior under concurrent `publishBufferedResults` invocations.  
**Priority:** MUST  
**Rationale:** Reentrancy bugs are subtle and hard to debug; dedicated tests required.  
**Verification:** Test with 10 tools completing simultaneously; verify serialized publishing.

**Test Scenario:**
```typescript
// Simulate 10 tools completing at exactly the same time
const results = await Promise.all(
  Array(10).fill(null).map((_, i) => launchToolExecution(tools[i], i, signal))
);
// Verify:
// - isPublishingBufferedResults flag serialized access
// - pendingPublishRequest flag triggered retries
// - All 10 results published exactly once in order
```

### TS-TEST-004
**Requirement:** All existing tests shall pass without modification after refactoring (except tests moved to new files).  
**Priority:** MUST  
**Rationale:** Refactoring must not introduce regressions.  
**Verification:** Run existing test suite; verify 100% pass rate.

**Observable Behavior:**
- `coreToolScheduler.test.ts` passes (integration tests)
- Other test files importing from scheduler pass
- No test modifications required (except moved tests)

---

## 11. Non-Functional Requirements

### TS-NFR-001
**Requirement:** Tool execution latency shall not measurably regress after refactoring.  
**Priority:** SHOULD  
**Rationale:** Refactoring should not degrade performance. The extraction adds at most one function call of indirection.  
**Verification:** Run existing test suite before/after; spot-check with multi-tool batch if regression suspected.

**Acceptance Criteria:**
- No new async boundaries introduced in the hot path (ToolExecutor.execute is already async)
- No unnecessary object copies or allocations in extracted code

### TS-NFR-002
**Requirement:** TypeScript compilation time shall not measurably regress after refactoring.  
**Priority:** SHOULD  
**Rationale:** Developer experience depends on fast iteration cycles. More files but smaller files should be neutral or positive.  
**Verification:** Run `npm run typecheck` before/after; no significant regression.
- Incremental build time change: < 5%

### TS-NFR-003
**Requirement:** The scheduler module file size shall be reduced by at least 20% after refactoring.  
**Priority:** SHOULD  
**Rationale:** Smaller files are easier to understand and maintain.  
**Verification:** Line count comparison before/after.

**File Size Targets:**
- Before: 2,139 lines
- After: < 1,700 lines (20% reduction)
- Actual target: ~1,559 lines (27% reduction)

### TS-NFR-004
**Requirement:** The system shall detect and report circular dependencies during build.  
**Priority:** MUST  
**Rationale:** Circular dependencies cause build failures and runtime issues.  
**Verification:** Build tooling (e.g., madge) detects cycles; CI fails on circular deps.

**Observable Behavior:**
- Build tool analyzes module graph
- If cycle detected → build fails with clear error message
- `scheduler/types.ts` never imports from `../index.js`

---

## Appendix A: Requirement Traceability Matrix

**Note on Stable IDs (addresses review finding #12):**
- Requirement IDs (e.g., TS-BATCH-001) are stable and used for traceability
- Design section numbers may change as document evolves
- When referencing design sections, use requirement IDs as anchor points

| Requirement ID | Design Section Reference | Verification Method | Test File |
|---------------|--------------------------|---------------------|-----------|
| TS-TYPE-001 to TS-TYPE-004 | Module: scheduler/types.ts (design.md §4.1) | Compilation + runtime tests | scheduler/types.test.ts |
| TS-EXEC-001 to TS-EXEC-007 | Module: scheduler/tool-executor.ts (design.md §4.2) | Unit + integration tests | scheduler/tool-executor.test.ts |
| TS-BATCH-001 to TS-BATCH-005 | Parallel Batching Preservation (design.md §5) | Integration tests (parameterized) | coreToolScheduler.test.ts (batch tests) |
| TS-RESP-001 to TS-RESP-002 | Module: generateContentResponseUtilities.ts (design.md §4.5) | Unit tests | utils/generateContentResponseUtilities.test.ts |
| TS-UTIL-001 to TS-UTIL-002 | Module: tool-utils.ts (design.md §4.7) | Unit tests | utils/tool-utils.test.ts |
| TS-COMPAT-001 to TS-COMPAT-002 | Re-Export Strategy (design.md §7.7) | Compilation + existing tests | All existing test files |
| TS-STATE-001 to TS-STATE-003 | What Stays in CoreToolScheduler (design.md §4.8) | Integration tests | coreToolScheduler.test.ts (state tests) |
| TS-CONFIRM-001 to TS-CONFIRM-003 | What Stays in CoreToolScheduler (design.md §4.8) | Integration tests | coreToolScheduler.test.ts (confirmation tests) |
| TS-QUEUE-001 to TS-QUEUE-002 | Missing Test Scenarios (requirements.md §9) | Integration tests | coreToolScheduler.test.ts (queue tests) |
| TS-LIFE-001 to TS-LIFE-003 | What Stays in CoreToolScheduler (design.md §4.8) | Integration tests | coreToolScheduler.test.ts (lifecycle tests) |
| TS-TEST-001 to TS-TEST-004 | Test Strategy (design.md §7.8) | Coverage report + CI | All test files |
| TS-NFR-003 to TS-NFR-004 | Expected Outcome (design.md §9) | Line count + build analysis | CI tooling |
| ~~TS-NFR-001~~ | [REMOVED] | N/A | N/A |
| ~~TS-NFR-002~~ | [REMOVED] | N/A | N/A |

---

## Appendix B: Behavioral Test Scenarios

### Scenario 1: Parallel Batch with Shuffled Completion Order

**Given:** 5 tools scheduled with execution indices [0, 1, 2, 3, 4]  
**When:** Tools complete in order [4, 2, 0, 3, 1] (shuffled)  
**Then:** Results published in order [0, 1, 2, 3, 4] (original)

**Verification:**
1. Capture `publishResult` invocations with timestamps
2. Assert: `publishResult` call order matches [0, 1, 2, 3, 4]
3. Assert: All tools executed concurrently (launched via Promise.all in same tick)
4. Assert: Completion order != publish order (shuffled)

### Scenario 2: Reentrancy Guard Under Concurrent Completion

**Given:** 10 tools executing in parallel  
**When:** All 10 tools complete within 10ms of each other  
**Then:** `publishBufferedResults` executes serially; all results published exactly once

**Verification:**
1. Mock `isPublishingBufferedResults` flag checks
2. Assert: Flag set to true during publish, false after
3. Assert: `pendingPublishRequest` triggers retry when flag is true
4. Assert: All 10 results published exactly once
5. Assert: No concurrent `publishResult` invocations (serialized)

### Scenario 3: Batch State Reset Between Batches

**Given:** Batch 1 with 3 tools completes successfully  
**When:** Batch 2 with 2 tools is scheduled  
**Then:** Batch 2 starts with clean state (no batch 1 residue)

**Verification:**
1. After batch 1: Assert `nextPublishIndex === 0`, `pendingResults.size === 0`
2. During batch 2: Assert no batch 1 callIds in `pendingResults`
3. After batch 2: Assert independent completion (no interference)

### Scenario 4: Agent ID Fallback Chain

**Given:** Tool call with no `request.agentId`  
**When:** Metadata contains `agentId: "agent-123"`  
**Then:** Response uses `agentId: "agent-123"` (metadata fallback)

**Given:** Tool call with no `request.agentId` and no metadata  
**When:** Tool completes  
**Then:** Response uses `agentId: DEFAULT_AGENT_ID` (final fallback)

**Verification:**
1. Test case 1: Request with agentId → response has same agentId
2. Test case 2: Request without agentId, metadata with agentId → response has metadata agentId
3. Test case 3: Request without both → response has DEFAULT_AGENT_ID

### Scenario 5: Stale Correlation ID Handling After Modification

**Given:** Tool in `awaiting_approval` with correlationId "abc123"  
**When:** User chooses ModifyWithEditor → new correlationId "def456"  
**And:** UI sends response for "abc123" (stale)  
**Then:** Response is ignored; tool remains awaiting approval

**Verification:**
1. Trigger ModifyWithEditor flow
2. Capture old correlationId before modification
3. Send message bus response for old correlationId
4. Assert: Response logged as stale (if debug enabled)
5. Assert: Tool state unchanged (still awaiting approval for new correlationId)
6. After 30 seconds: Assert old correlationId removed from `staleCorrelationIds`

---

## Appendix C: Coverage Targets by Module

| Module | Line Coverage | Branch Coverage | Function Coverage |
|--------|---------------|-----------------|-------------------|
| scheduler/types.ts | N/A (types only) | N/A | N/A |
| scheduler/tool-executor.ts | 90% | 85% | 95% |
| utils/generateContentResponseUtilities.ts | 90% | 85% | 90% |
| utils/fileUtils.ts (new functions) | 90% | 85% | 90% |
| utils/tool-utils.ts (new functions) | 90% | 85% | 90% |
| core/coreToolScheduler.ts | 85% | 80% | 90% |

**Overall Target:** 85% line coverage, 80% branch coverage for scheduler subsystem.

---

**Verification:**
1. Trigger ModifyWithEditor flow
2. Capture old correlationId before modification
3. Send message bus response for old correlationId
4. Assert: Response logged as stale (if debug enabled)
5. Assert: Tool state unchanged (still awaiting approval for new correlationId)
6. After 30 seconds: Assert old correlationId removed from `staleCorrelationIds`

---

## Appendix C: Coverage Targets by Module

| Module | Line Coverage | Branch Coverage | Function Coverage |
|--------|---------------|-----------------|-------------------|
| scheduler/types.ts | N/A (types only) | N/A | N/A |
| scheduler/tool-executor.ts | 90% | 85% | 95% |
| utils/generateContentResponseUtilities.ts | 90% | 85% | 90% |
| utils/fileUtils.ts (new functions) | 90% | 85% | 90% |
| utils/tool-utils.ts (new functions) | 90% | 85% | 90% |
| core/coreToolScheduler.ts | 85% | 80% | 90% |

**Overall Target:** 85% line coverage, 80% branch coverage for scheduler subsystem.

---

## Requirement Summary

| Category | MUST | SHOULD | Total |
|----------|------|--------|-------|
| Type Extraction | 4 | 0 | 4 |
| Tool Execution | 7 | 0 | 7 |
| Parallel Batching | 5 | 0 | 5 |
| Response Formatting | 2 | 0 | 2 |
| Utilities | 1 | 1 | 2 |
| Backward Compatibility | 2 | 0 | 2 |
| State Management | 3 | 0 | 3 |
| Confirmation Flow | 3 | 0 | 3 |
| Lifecycle & Cleanup | 3 | 0 | 3 |
| Testing | 2 | 1 | 3 |
| Non-Functional | 2 | 2 | 4 |
| **TOTAL** | **34** | **4** | **38** |

---

**End of Requirements Specification**
** | **34** | **4** | **38** |

---

**End of Requirements Specification**
