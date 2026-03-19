# CoreToolScheduler Refactoring Design Specification

**Version:** 1.1  
**Date:** 2026-03-02  
**Status:** Draft (Revised)

---

## 1. Problem Statement

### 1.1 Current State
`packages/core/src/core/coreToolScheduler.ts` is **2,139 lines of code** — a significant maintenance burden that violates the Single Responsibility Principle and makes the codebase difficult to:

- **Test:** Monolithic file requires complex mocking and makes unit testing specific behaviors difficult
- **Understand:** New contributors face a steep learning curve to understand tool execution flow
- **Modify:** Changes to one concern (e.g., validation) risk breaking unrelated concerns (e.g., execution)
- **Review:** Pull requests touching this file are hard to review due to the sheer size
- **Debug:** Tracing execution flow through 2,139 lines is time-consuming and error-prone

### 1.2 Specific Issues

1. **Type pollution:** ToolCall state types, handler types, and request/response types are all defined inline
2. **Mixed concerns:** Validation, scheduling, execution, completion tracking, and confirmation handling are all in one file
3. **Hidden dependencies:** Helper functions are private methods that could be pure utility functions
4. **Test complexity:** The test file had 579 lines removed in upstream's first refactoring alone
5. **Code duplication:** Functions like `convertToFunctionResponse` and `truncateAndSaveToFile` were duplicated in tests

### 1.3 Impact on Development
- **Merge conflicts:** Multiple developers working on tool execution features frequently conflict
- **Regression risk:** Changes to one area can inadvertently break another
- **Onboarding friction:** New team members struggle to understand the tool execution lifecycle
- **Technical debt:** The file has grown organically without clear architectural boundaries

---

## 2. Current Architecture Analysis

### 2.1 Type and Interface Inventory

**Exported Types (ToolCall State Machine):**
- `ValidatingToolCall` — Tool in validation phase
- `ScheduledToolCall` — Tool ready for execution
- `ExecutingToolCall` — Tool currently executing (with optional PID for shell tools)
- `SuccessfulToolCall` — Tool completed successfully
- `ErroredToolCall` — Tool failed with error
- `CancelledToolCall` — Tool execution cancelled
- `WaitingToolCall` — Tool awaiting user confirmation
- `ToolCall` — Union of all above states
- `CompletedToolCall` — Union of terminal states (success/error/cancelled)
- `Status` — Discriminated union tag for ToolCall

**Exported Handler Types:**
- `ConfirmHandler` — Callback for confirmation requests
- `OutputUpdateHandler` — Callback for live output updates
- `AllToolCallsCompleteHandler` — Callback when batch completes
- `ToolCallsUpdateHandler` — Callback when any tool state changes

**Request/Response Types (currently in coreToolScheduler.ts, NOT turn.ts):**
- `ToolCallRequestInfo` — Inbound tool call from LLM (actually defined in turn.ts)
- `ToolCallResponseInfo` — Outbound tool result to LLM (actually defined in turn.ts)

**Internal Types:**
- `QueuedRequest` — Scheduling queue entry
- `PolicyContext` — Policy engine context (inline, not exported)

**Configuration:**
- `CoreToolSchedulerOptions` — Constructor options interface

### 2.2 Function Catalog (by Responsibility)

#### **A. Type Conversion & Response Formatting**
- `createFunctionResponsePart(callId, toolName, output): Part` — Build Gemini FunctionResponse (pure)
- `toParts(input: PartListUnion): Part[]` — Normalize part input to array (pure)
- `convertToFunctionResponse(toolName, callId, llmContent, config): Part[]` — **COMPLEX:** Handles text, inlineData, fileData, multimodal, and Gemini version differences (pure with config dependency)
- `limitStringOutput(text, toolName, config): string` — Apply per-tool token limits (pure)
- `limitFunctionResponsePart(part, toolName, config): Part` — Apply limits to Part (pure)
- `extractAgentIdFromMetadata(metadata): string | undefined` — Extract agent ID from tool metadata (**NOT PURE** - used in `setStatusInternal` for agent attribution fallback, coupled to state machine)
- `createErrorResponse(request, error, errorType): ToolCallResponseInfo` — Build error response (pure)

#### **B. Tool Validation & Invocation Building**
- `buildInvocation(tool, args): AnyToolInvocation | Error` — Create tool invocation from args (instance method, sets ContextAwareTool context)
- `getToolSuggestion(unknownToolName): string` — Levenshtein-based tool name suggestions (instance method, accesses registry)

#### **C. Policy & Confirmation**
- `getPolicyContextFromInvocation(invocation, request): PolicyContext` — Build policy context (pure)
- `evaluatePolicyDecision(invocation, request): { decision, context }` — Evaluate policy for tool (uses config.policyEngine)
- `handlePolicyDenial(request, context): void` — Handle denied tools (mutates state via setStatusInternal)
- `publishConfirmationRequest(correlationId, context): void` — Publish to message bus (side effect)
- `handleConfirmationResponse(callId, originalOnConfirm, outcome, signal, payload?, skipBusPublish?): Promise<void>` — **COMPLEX:** Handle confirmation flow, including modify/retry (state machine transitions)
- `handleMessageBusResponse(response): void` — Message bus subscriber callback (state machine transitions)
- `approveToolCall(callId): void` — Force-approve a tool (state machine transition)

#### **D. Inline Modification (Edit-Before-Execute)**
- `_applyInlineModify(toolCall, newContent, signal): Promise<void>` — Apply editor changes to tool args (async state mutation)

#### **E. State Management**
- `setStatusInternal(targetCallId, newStatus, auxiliaryData?): void` — **CRITICAL:** State machine transitions (complex overloaded method, applies agent ID fallback using `extractAgentIdFromMetadata` from request metadata)
- `setArgsInternal(targetCallId, args): void` — Update tool call args (applies ContextAwareTool.context injection, calls buildInvocation)
- `setPidInternal(targetCallId, pid): void` — Set PID for shell tools (state mutation)
- `setToolCallOutcome(callId, outcome): void` — Set confirmation outcome (state mutation)
- `notifyToolCallsUpdate(): void` — Trigger update callback (side effect)

#### **F. Scheduling & Queue Management**
- `schedule(request | request[], signal): Promise<void>` — Public entry point (queue management with abort handler cleanup)
- `_schedule(request | request[], signal): Promise<void>` — **COMPLEX:** Main scheduling loop with:
  - Duplicate call filtering via `seenCallIds`
  - Tool governance blocklist checks via `buildToolGovernance` + `isToolBlocked`
  - Tool registry lookup
  - ContextAwareTool context injection
  - Invocation building
  - Policy evaluation
  - `startTime` initialization
  - Signal storage in `callIdToSignal` map
- `autoApproveCompatiblePendingTools(signal, triggeringCallId): Promise<void>` — Auto-approve tools after allowlist update

#### **G. Parallel Batch Execution (LLxprt-Specific)**
- `applyBatchOutputLimits(batchSize): void` — Divide token budget across batch (mutates `batchOutputConfig`)
- `bufferResult(callId, toolName, result, scheduledCall, executionIndex): void` — Buffer result for ordered publishing (mutates `pendingResults`)
- `bufferError(callId, error, scheduledCall, executionIndex): void` — Buffer error (mutates `pendingResults`)
- `bufferCancelled(callId, scheduledCall, executionIndex): void` — Buffer cancelled placeholder (mutates `pendingResults`)
- `publishBufferedResults(signal): Promise<void>` — **CRITICAL:** Ordered result publishing with reentrancy guard (`isPublishingBufferedResults`, `pendingPublishRequest` flags), resets `nextPublishIndex` and `pendingResults` when batch complete
- `publishResult(buffered, signal): Promise<void>` — Publish single result (calls `setStatusInternal`, triggers hooks)

#### **H. Tool Execution**
- `launchToolExecution(scheduledCall, executionIndex, signal): Promise<void>` — **CRITICAL:** Execute single tool with hooks, PID tracking, output updates, result buffering
- `attemptExecutionOfScheduledCalls(signal): Promise<void>` — **CRITICAL:** Launch parallel batch execution via `Promise.all`

#### **I. Completion Detection**
- `checkAndNotifyCompletion(): Promise<void>` — Detect batch completion and notify (checks all terminal states, clears `toolCalls`)
- `isRunning(): boolean` — Check if any tools are in-flight (executing or awaiting_approval)

#### **J. Lifecycle & Cleanup**
- `constructor(options)` — Initialize and subscribe to message bus
- `setCallbacks(options): void` — Update callbacks
- `dispose(): void` — Clean up subscriptions, clear `pendingConfirmations`, `processedConfirmations`, `seenCallIds`, `staleCorrelationIds` (with timeout cleanup)
- `cancelAll(): void` — Cancel all in-flight tools (clears queue, resets batch state: `pendingResults`, `nextPublishIndex`, `currentBatchSize`, `isPublishingBufferedResults`, `pendingPublishRequest`, `batchOutputConfig`)

**Stale Correlation ID Lifecycle (previously omitted):**
- `staleCorrelationIds: Map<string, NodeJS.Timeout>` — Tracks old correlationIds after ModifyWithEditor creates new ones, with timer-based cleanup

**Queue Abort Semantics (previously omitted):**
- `schedule()` registers abort handler that removes request from queue and rejects promise

### 2.3 Dependency Map

**What CoreToolScheduler Depends On:**
- `Config` — All configuration accessors, policy engine, message bus, tool registry
- `ToolRegistry` — Tool lookup and discovery
- `MessageBus` — Confirmation request/response pub/sub
- `PolicyEngine` (via Config) — Policy decisions
- `HookSystem` (via triggerBeforeToolHook, triggerAfterToolHook, triggerToolNotificationHook) — Hook execution
- `ModifiableTool` — Inline modification support
- `toolOutputLimiter` — Token limiting
- `toolGovernance` — Tool allowlist/blocklist
- `fast-levenshtein` — Tool name similarity
- `diff` — Diff generation for modified tools
- `terminalSerializer` — AnsiOutput type
- `@google/genai` — Part types
- `executeToolWithHooks` from `coreToolHookTriggers` — Wrapper for tool execution

**What Depends on CoreToolScheduler:**
- `GeminiChat` — Main chat loop schedules tool calls
- `Turn` — Uses ToolCallRequestInfo and ToolCallResponseInfo (defined in turn.ts)
- `nonInteractiveToolExecutor` — Shares tool execution logic (could use ToolExecutor)
- CLI components — Subscribe to output updates and completion handlers

### 2.4 Natural Seam Lines

Based on **cohesion** (things that change together) and **coupling** (minimizing dependencies):

1. **Type Definitions** — All ToolCall state types and handler types are pure data definitions
2. **Tool Execution** — Single-tool execution with hooks, PID tracking, and output streaming
3. **Response Formatting** — Converting tool results to Gemini Parts (pure functions)
4. **Pure Utilities** — Tool suggestions (Levenshtein), error response creation
5. **Parallel Batch Orchestration** — Buffering, ordering, and publishing results (LLxprt-specific)

**NOT Natural Seams (tightly coupled to scheduler state):**
- Validation & Invocation Building — Applies governance, context injection, startTime
- `extractAgentIdFromMetadata` — Used in state transitions for fallback behavior
- Completion Tracking — Directly manipulates `toolCalls` array

---

## 3. Upstream Refactoring Analysis

### 3.1 First Commit (5566292cc83f): Extract Static Concerns

**What Moved:**
- All ToolCall state types → `packages/core/src/scheduler/types.ts`
- `ToolCallRequestInfo` and `ToolCallResponseInfo` → `scheduler/types.ts` (moved from turn.ts)
- `truncateAndSaveToFile` → `packages/core/src/utils/fileUtils.ts` with tests
- `convertToFunctionResponse` → `packages/core/src/utils/generateContentResponseUtilities.ts` with tests
- `getToolSuggestion` → `packages/core/src/utils/tool-utils.ts` with tests

**Why These Boundaries:**
- **Types:** Pure data definitions, no logic, imported everywhere
- **File utils:** Pure I/O operation, reusable beyond tool execution
- **Response utilities:** Pure transformation, model-specific logic encapsulated
- **Tool utils:** Pure string matching, reusable across tool system

**Outcome:**
- CoreToolScheduler: -404 lines
- Test file: -579 lines (moved to new test files)
- **Re-exported types from CoreToolScheduler for backward compatibility**

### 3.2 Second Commit (b4b49e7029d3): Extract ToolExecutor

**What Moved:**
- Created `packages/core/src/scheduler/tool-executor.ts` (310 lines)
- Extracted single-tool execution logic from `launchToolExecution`
- `ToolExecutor` class with `execute(context): Promise<CompletedToolCall>` method
- `ToolExecutionContext` interface for passing callbacks

**Interface:**
```typescript
export interface ToolExecutionContext {
  call: ToolCall;
  signal: AbortSignal;
  outputUpdateHandler?: (callId: string, output: string | AnsiOutput) => void;
  onUpdateToolCall: (updatedCall: ToolCall) => void;
}

export class ToolExecutor {
  constructor(private readonly config: Config) {}
  async execute(context: ToolExecutionContext): Promise<CompletedToolCall>
}
```

**Why This Boundary:**
- Single-tool execution is a **cohesive unit**: hooks, truncation, PID tracking, error handling
- Scheduler becomes an **orchestrator**, not an executor
- Enables reuse in `nonInteractiveToolExecutor`
- Testable in isolation with mock tools

**Outcome:**
- CoreToolScheduler: -232 lines (down to ~1500 after both commits)
- New ToolExecutor: +310 lines with comprehensive tests (+299 test lines)

### 3.3 What Upstream DOESN'T Address

1. **No parallel batch logic** — Upstream executes tools sequentially
2. **No buffering/ordering system** — `publishBufferedResults`, `bufferResult`, etc. remain in scheduler
3. **No batch output limits** — `applyBatchOutputLimits` is LLxprt-specific
4. **Validation remains inline** — `buildInvocation` and policy evaluation could NOT be easily extracted (see section 4.3 below)
5. **No completion tracking extraction** — `checkAndNotifyCompletion` is trivial and tightly coupled to state array

**Key Insight:** Upstream's refactoring is a **subset** of what LLxprt needs because LLxprt has parallel execution.

---

## 4. Proposed Extraction Design

### 4.1 Module: `packages/core/src/scheduler/types.ts`

**Purpose:** Centralize all ToolCall state types and handler types.

**What Moves:**
```typescript
// All ToolCall state types
export type ValidatingToolCall = { ... }
export type ScheduledToolCall = { ... }
export type ExecutingToolCall = { ... }
export type SuccessfulToolCall = { ... }
export type ErroredToolCall = { ... }
export type CancelledToolCall = { ... }
export type WaitingToolCall = { ... }
export type ToolCall = ValidatingToolCall | ScheduledToolCall | ...
export type CompletedToolCall = SuccessfulToolCall | CancelledToolCall | ErroredToolCall
export type Status = ToolCall['status']

// Handler types
export type ConfirmHandler = (toolCall: WaitingToolCall) => Promise<ToolConfirmationOutcome>
export type OutputUpdateHandler = (callId: string, output: string | AnsiOutput) => void
export type AllToolCallsCompleteHandler = (completedToolCalls: CompletedToolCall[]) => Promise<void>
export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void

// Request/Response types (already in turn.ts, do NOT move)
// export interface ToolCallRequestInfo { ... }
// export interface ToolCallResponseInfo { ... }
```

**Circular Dependency Avoidance:**
- **CRITICAL:** `scheduler/types.ts` MUST import types from leaf modules directly (e.g., `from '../tools/tool.js'`, `from '../policy/types.js'`), NEVER from `../index.js` barrel export
- Use `import type { ... }` syntax to avoid runtime dependencies
- Example correct import: `import type { AnyDeclarativeTool } from '../tools/tool.js'`
- Example incorrect import: `import type { AnyDeclarativeTool } from '../index.js'` [ERROR] (creates cycle)

**Interface with Remaining Scheduler:**
- Scheduler imports these types from `'../scheduler/types.js'`
- Re-export from `coreToolScheduler.ts` for backward compatibility

**Rationale:**
- Types are **pure data definitions** with no dependencies
- Imported by multiple modules (scheduler, executor, tests, CLI)
- Upstream did exactly this — proven approach
- **~130 lines extracted**

---

### 4.2 Module: `packages/core/src/scheduler/tool-executor.ts`

**Purpose:** Execute a single tool with hooks, PID tracking, truncation, and error handling.

**What Moves:**
```typescript
export interface ToolExecutionContext {
  call: ToolCall;  // Must be ScheduledToolCall or ExecutingToolCall
  signal: AbortSignal;
  onLiveOutput?: (callId: string, chunk: string | AnsiOutput) => void; // Narrowed callback
  onPid?: (callId: string, pid: number) => void; // Narrowed callback
}

export class ToolExecutor {
  constructor(private readonly config: Config) {}
  
  /**
   * Execute a single tool call from scheduled to completed state.
   * Handles:
   * - Hooks (before/after/notification via executeToolWithHooks)
   * - PID tracking for shell tools (via onPid callback)
   * - Live output streaming (via onLiveOutput callback)
   * - Output truncation (for shell tools via saveTruncatedContent)
   * - Error handling and cancellation
   * - Result transformation (via convertToFunctionResponse)
   */
  async execute(context: ToolExecutionContext): Promise<CompletedToolCall>
  
  private createSuccessResult(call, toolResult): Promise<SuccessfulToolCall>
  private createErrorResult(call, error, errorType?): ErroredToolCall
  private createCancelledResult(call, reason): CancelledToolCall
}
```

**Callback Contract Narrowing (addresses review finding #5):**
- **OLD (too generic):** `onUpdateToolCall(updatedCall: ToolCall)` — Forces ToolExecutor to know about full state machine
- **NEW (specific):**
  - `onPid(callId: string, pid: number)` — Targeted PID updates
  - `onLiveOutput(callId: string, chunk: string | AnsiOutput)` — Targeted live output
- **Rationale:** Executor should not manage state transitions (that's scheduler's job), only report execution events

**What Does NOT Move:**
- Parallel execution logic (stays in scheduler)
- Buffering and ordering logic (stays in scheduler)
- Batch output limits (stays in scheduler)
- Agent ID fallback logic (stays in scheduler via `setStatusInternal`)

**Interface with Scheduler:**
```typescript
// In CoreToolScheduler.launchToolExecution
const executingCall = { ...scheduledCall, status: 'executing' }
const completedCall = await this.toolExecutor.execute({
  call: executingCall,
  signal,
  onLiveOutput: (callId, chunk) => {
    if (this.outputUpdateHandler) this.outputUpdateHandler(callId, chunk)
    this.toolCalls = this.toolCalls.map(tc => 
      tc.request.callId === callId ? { ...tc, liveOutput: chunk } : tc
    )
  },
  onPid: (callId, pid) => {
    this.setPidInternal(callId, pid)
  }
})
```

**Rationale:**
- **Cohesive unit:** Everything needed to execute one tool
- **Testable in isolation:** Mock tools, config, hooks
- **Reusable:** `nonInteractiveToolExecutor` can use this
- Upstream proved this works
- **~300 lines extracted**

---

### 4.3 NO Extraction: Tool Validation & Invocation Building

**Decision:** Do NOT extract `ToolValidator` class.

**Rationale (addresses review finding #3):**
Current `_schedule` does MORE than registry lookup + `buildInvocation`:
1. **Governance blocklist check** (`buildToolGovernance` + `isToolBlocked`) — Happens BEFORE invocation building
2. **ContextAwareTool context injection** (sessionId, agentId, interactiveMode) — Happens during `buildInvocation` and `setArgsInternal`
3. **startTime initialization** — Happens when creating ValidatingToolCall
4. **Agent ID defaulting** — Applied to requests before processing
5. **Signal storage** (`callIdToSignal` map) — Needed for message bus responses

Extracting "validation" would require either:
- **A. Moving all side effects into validator** → Makes validator a "god object" with too many responsibilities
- **B. Splitting validation from side effects** → Creates unclear boundaries and multiple passes over requests

**Conclusion:** Validation logic is so tightly coupled to scheduling state that extracting it provides no value. Keep it inline in `_schedule`.

**Lines Saved by NOT Extracting:** 0 (would cost ~100 lines in interface overhead)

---

### 4.4 NO Extraction: Completion Tracking

**Decision:** Do NOT extract `CompletionTracker` class (addresses review finding #10).

**Rationale:**
Current `checkAndNotifyCompletion()` is ~15 lines and does:
1. Check if all calls are in terminal state
2. Extract completed calls
3. **Clear `toolCalls` array** (state mutation)
4. Call `onAllToolCallsComplete` handler

Extracting this to a separate class would:
- Require passing `toolCalls` array and mutation callback
- Add ~50 lines for class definition, tests, imports
- Provide minimal clarity gain (the logic is already clear)

**Conclusion:** Completion detection is trivial and tightly coupled to state array. Extracting adds indirection without benefit.

**Lines Saved by NOT Extracting:** 0 (would cost ~30 lines overhead for minimal 15-line extraction)

---

### 4.5 Module: `packages/core/src/utils/generateContentResponseUtilities.ts` (**Partially exists**)

**What Exists:**
- `getResponseText`, `getFunctionCalls`, etc. — Query utilities for GenerateContentResponse

**What to Add (from CoreToolScheduler):**
```typescript
export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  config?: ToolOutputSettingsProvider,
): Part[]

function createFunctionResponsePart(...)
function toParts(...)
function limitStringOutput(...)
function limitFunctionResponsePart(...)
```

**What to NOT Add (addresses review finding #1):**
- ~~`extractAgentIdFromMetadata`~~ — This is NOT a pure utility. It's used in `setStatusInternal` for agent attribution fallback when creating success/error responses. If the request has no agentId and no metadata with agentId, it falls back to `DEFAULT_AGENT_ID`. This logic is coupled to the state machine and should remain in `coreToolScheduler.ts`.

**Rationale:**
- Pure transformation functions (no state dependencies)
- Model-specific logic (Gemini multimodal support)
- Upstream already did this
- **~150 lines extracted**

---

### 4.6 Module: `packages/core/src/utils/fileUtils.ts` (**Currently does NOT contain truncation logic**)

**What Currently Exists:**
- `readFileWithEncoding`, `detectBOM`, `isBinaryFile`, `detectFileType`, `processSingleFileContent`, `fileExists`, `readWasmBinaryFromDisk`
- **NO truncation or saving functions** (addresses review finding #7)

**What to Add:**
```typescript
/**
 * Truncate shell tool output and save to temp file if needed.
 * @param content - Full shell output
 * @param callId - Tool call ID for filename
 * @param projectTempDir - Temp directory path
 * @param threshold - Character threshold for truncation
 * @param truncateLines - Number of lines to keep in truncated output
 * @returns Object with truncated content string and optional output file path
 */
export async function saveTruncatedContent(
  content: string,
  callId: string,
  projectTempDir: string,
  threshold: number,
  truncateLines: number,
): Promise<{ content: string; outputFile?: string }>
```

**Rationale:**
- Pure I/O function, reusable
- Upstream did this (as `truncateAndSaveToFile`)
- **~70 lines added**

---

### 4.7 Module: `packages/core/src/utils/tool-utils.ts` (**Partially exists**)

**What Currently Exists:**
- `doesToolInvocationMatch` — Already extracted

**What to Add:**
```typescript
/**
 * Generate Levenshtein-based tool name suggestions for unknown tool.
 * @param unknownToolName - Tool name that wasn't found
 * @param allToolNames - All available tool names from registry
 * @param topN - Number of suggestions to return
 * @returns Formatted suggestion string or empty string if no close matches
 */
export function getToolSuggestion(
  unknownToolName: string,
  allToolNames: string[],
  topN = 3,
): string

/**
 * Create standardized error response for failed tool calls.
 * @param request - Original tool call request
 * @param error - Error that occurred
 * @param errorType - Structured error type for categorization
 * @returns ToolCallResponseInfo with error details
 */
export function createErrorResponse(
  request: ToolCallRequestInfo,
  error: Error,
  errorType?: ToolErrorType,
): ToolCallResponseInfo
```

**Rationale:**
- Pure utility functions
- Upstream extracted `getToolSuggestion` (but as static method, we make it standalone)
- `createErrorResponse` is used in 6+ places in scheduler
- **~80 lines added**

---

### 4.8 What Stays in CoreToolScheduler

**Core Responsibilities:**
1. **Scheduling Queue Management** — `schedule`, `_schedule`, request queueing with abort handlers
2. **State Machine Management** — `setStatusInternal` (with agent ID fallback), `setArgsInternal`, `setPidInternal`
3. **Confirmation Flow Orchestration** — `handleConfirmationResponse`, `handleMessageBusResponse`, `publishConfirmationRequest`, stale correlation ID tracking
4. **Policy Evaluation** — `evaluatePolicyDecision`, `getPolicyContextFromInvocation`, `handlePolicyDenial`
5. **Tool Governance** — Blocklist checking via `buildToolGovernance` + `isToolBlocked` in `_schedule`
6. **Parallel Batch Orchestration (LLxprt-Specific):**
   - `applyBatchOutputLimits` — Divides token budget across batch
   - `bufferResult`, `bufferError`, `bufferCancelled` — Store results with execution index
   - `publishBufferedResults` — **CRITICAL: ordered publishing with reentrancy guard**, resets batch state
   - `publishResult` — Single result publishing with hooks
   - `attemptExecutionOfScheduledCalls` — **CRITICAL: parallel execution via Promise.all**
   - `launchToolExecution` — Delegates to ToolExecutor but manages buffering
7. **Validation & Context Injection** — `buildInvocation` (applies ContextAwareTool context), tool registry lookup, agent ID defaulting, startTime initialization
8. **Inline Modification** — `_applyInlineModify` with stale correlation ID management
9. **Auto-Approval Logic** — `autoApproveCompatiblePendingTools`
10. **Lifecycle** — `constructor`, `dispose` (with stale timeout cleanup), `cancelAll` (with comprehensive state reset), `isRunning`
11. **Completion Detection** — `checkAndNotifyCompletion` (trivial, no extraction value)
12. **Notification** — `notifyToolCallsUpdate`, `setToolCallOutcome`

**Why These Stay:**
- **Stateful orchestration** — Manage `toolCalls`, `pendingResults`, `nextPublishIndex`, `seenCallIds`, `staleCorrelationIds`, `pendingConfirmations`, `callIdToSignal`
- **Coordination logic** — Coordinate between multiple subsystems (policy, confirmation, execution, completion, governance)
- **Parallel batching** — LLxprt's competitive advantage, tightly coupled to state management
- **No clean seams** — Validation, completion, and confirmation logic are too intertwined with state to extract

**Expected Line Count After Refactoring:**
- Current: 2,139 lines
- Types: -130 lines
- ToolExecutor: -300 lines
- Response utilities: -150 lines (convertToFunctionResponse + helpers)
- File utils: 0 lines (saveTruncatedContent doesn't exist yet, will be added to fileUtils)
- Tool utils: 0 lines (getToolSuggestion doesn't exist yet, createErrorResponse stays inline)
- **Remaining: ~1,559 lines** (27% reduction)

**Revised Line Count Estimates (addresses review finding #7):**
- `fileUtils.ts` currently: ~500 lines (adding ~70 for saveTruncatedContent)
- `generateContentResponseUtilities.ts` currently: ~150 lines (adding ~150 for convertToFunctionResponse)
- `tool-utils.ts` currently: ~50 lines (adding ~80 for getToolSuggestion + createErrorResponse)

---

## 5. Parallel Batching Preservation (LLxprt's Competitive Advantage)

### 5.1 Current Parallel Batching Flow

1. **Batch Execution** (`attemptExecutionOfScheduledCalls`):
   - Find all `scheduled` tools
   - Set `currentBatchSize` to count of scheduled tools (BEFORE execution starts)
   - Assign execution indices (0, 1, 2, ...)
   - Apply batch output limits (divide token budget)
   - Launch all tools in parallel via `Promise.all`

2. **Buffering** (in `launchToolExecution`):
   - Each tool completes asynchronously
   - Results buffered in `pendingResults` Map with executionIndex
   - Allows tools to finish out-of-order
   - For cancelled tools: buffer with `isCancelled: true` flag to skip publish

3. **Ordered Publishing** (`publishBufferedResults`):
   - Publishes results in execution order (index 0, then 1, then 2, ...)
   - Reentrancy guard (`isPublishingBufferedResults` + `pendingPublishRequest`) prevents race conditions
   - Waits for missing indices (e.g., if tool 2 finishes before tool 1)
   - **nextPublishIndex advances:** After each result published (success/error) OR skipped (cancelled with isCancelled flag)
   - **Batch completion detection:** When `nextPublishIndex === currentBatchSize`
   - Resets batch state (`nextPublishIndex = 0`, `currentBatchSize = 0`, `pendingResults.clear()`) when all published

**Critical Timing Constraints (addresses review finding #3):**

1. **`nextPublishIndex` Advancement:**
   - Advances by 1 AFTER `publishResult()` completes OR after skipping cancelled placeholder
   - Advances BEFORE triggering `checkAndNotifyCompletion` (happens in calling context, not inside publish loop)
   - NEVER advances inside reentrancy-protected section without publishing/skipping corresponding result

2. **`checkAndNotifyCompletion` Interleaving:**
   - MAY be called concurrently with `publishBufferedResults` (e.g., from state transitions)
   - Checks terminal state of `toolCalls` array (independent of `pendingResults` buffer)
   - Completion callback fires when ALL tools in `toolCalls` are terminal (success/error/cancelled)
   - **Guarantee:** If batch completes during publish, completion callback fires AFTER all results published (via `await publishBufferedResults` in `launchToolExecution`)

3. **Completion Callback Single-Fire Guarantee:**
   - `onAllToolCallsComplete` fires EXACTLY ONCE per batch under concurrent completions
   - Enforced by `isFinalizingToolCalls` flag in `checkAndNotifyCompletion`
   - If multiple tools complete simultaneously, first to enter completion check sets flag, others skip
   - Batch state cleared after completion callback finishes (toolCalls array emptied)

**Edge Case Handling:**
- **Issue #987 Fix:** If tools complete before `currentBatchSize` is set (race condition), `publishBufferedResults` recovers batch size from `pendingResults` max executionIndex
- **Cancelled tools:** Buffered with placeholder, `nextPublishIndex` advances when placeholder reached, but NO actual publish occurs (avoids duplicate state transition)

### 5.2 Which Boundaries Are Safe

**SAFE to extract:**
- [OK] Types (no logic)
- [OK] Single-tool execution (ToolExecutor) — **scheduler controls parallelism**
- [OK] Response formatting (pure functions)
- [OK] Utilities (pure functions)

**UNSAFE to extract (stay in scheduler):**
- [ERROR] Validation & invocation building — Too many side effects (governance, context, startTime, agentId)
- [ERROR] Completion tracking — Trivial and tightly coupled to state array
- [ERROR] `applyBatchOutputLimits` — Batch-aware
- [ERROR] `bufferResult` / `publishBufferedResults` — Ordered publishing logic
- [ERROR] `attemptExecutionOfScheduledCalls` — Parallel launch logic
- [ERROR] `launchToolExecution` — Bridges execution and buffering

### 5.3 How ToolExecutor Interacts with Parallel Batching

**Scheduler's Role:**
```typescript
async launchToolExecution(
  scheduledCall: ScheduledToolCall,
  executionIndex: number,
  signal: AbortSignal,
): Promise<void> {
  // 1. Transition to executing
  this.setStatusInternal(scheduledCall.request.callId, 'executing')
  
  // 2. Delegate to ToolExecutor with narrowed callbacks
  const completedCall = await this.toolExecutor.execute({
    call: this.toolCalls.find(c => c.request.callId === scheduledCall.request.callId)!,
    signal,
    onLiveOutput: (callId, chunk) => {
      if (this.outputUpdateHandler) this.outputUpdateHandler(callId, chunk)
      this.toolCalls = this.toolCalls.map(tc => 
        tc.request.callId === callId ? { ...tc, liveOutput: chunk } : tc
      )
    },
    onPid: (callId, pid) => {
      this.setPidInternal(callId, pid) // Maintains state + notifies
    }
  })
  
  // 3. Buffer result with execution index
  if (completedCall.status === 'success') {
    this.bufferResult(
      completedCall.request.callId,
      completedCall.request.name,
      { llmContent: ... },
      scheduledCall,
      executionIndex  // <-- CRITICAL for ordered publishing
    )
  }
  
  // 4. Trigger ordered publishing
  await this.publishBufferedResults(signal)
}
```

**Key Insight:** ToolExecutor is **stateless** — it doesn't know about batches or ordering. The **scheduler** maintains the batch state and orchestrates ordered publishing.

### 5.4 Parallel Batching Preservation Guarantee

The refactoring **preserves parallelism** because:
1. `attemptExecutionOfScheduledCalls` still launches all tools via `Promise.all`
2. `launchToolExecution` still buffers results with execution indices
3. `publishBufferedResults` still publishes in order with reentrancy guards
4. ToolExecutor is **synchronous from the scheduler's perspective** — it returns a `Promise<CompletedToolCall>` that the scheduler awaits

**No behavioral change** — only code organization improves.

---

## 6. Component Diagram

### 6.1 Before Refactoring

```
┌────────────────────────────────────────────────────────────────┐
│                    CoreToolScheduler (2139 lines)              │
│                                                                │
│  Types + Validation + Execution + Batching + Completion +     │
│  Utilities + Confirmation + Policy + State Management         │
│                                                                │
│  Everything in one monolithic class                           │
└────────────────────────────────────────────────────────────────┘
         │
         ├─> Config
         ├─> ToolRegistry
         ├─> MessageBus
         ├─> HookSystem
         └─> PolicyEngine
```

### 6.2 After Refactoring

```
┌─────────────────────────────────────────────────────────────────────┐
│                CoreToolScheduler (~1559 lines)                      │
│                                                                     │
│  Core Responsibilities:                                             │
│  • Scheduling & queueing (with abort handler cleanup)               │
│  • State machine (setStatusInternal with agent fallback, etc.)      │
│  • Confirmation orchestration (with stale correlation tracking)     │
│  • Policy evaluation                                                │
│  • Tool governance (blocklist checks)                               │
│  • Parallel batch orchestration (LLxprt-specific)                   │
│    - applyBatchOutputLimits                                         │
│    - bufferResult, publishBufferedResults (with reentrancy guard)   │
│    - attemptExecutionOfScheduledCalls                               │
│  • Validation & context injection (ContextAwareTool, agent ID)      │
│  • Inline modification (with stale correlation management)          │
│  • Auto-approval                                                    │
│  • Lifecycle & notifications                                        │
│  • Completion detection (trivial, not extracted)                    │
└─────────────────────────────────────────────────────────────────────┘
         │
         ├─> scheduler/types.ts (130 lines)
         │   • All ToolCall state types
         │   • Handler types
         │   • NO circular deps (import from leaf modules, not index.js)
         │
         ├─> scheduler/tool-executor.ts (300 lines)
         │   • Single-tool execution
         │   • Hooks, PID tracking (via onPid callback), truncation
         │   • Error handling, cancellation
         │   • Live output (via onLiveOutput callback)
         │
         ├─> utils/generateContentResponseUtilities.ts (+150 lines)
         │   • convertToFunctionResponse
         │   • Part manipulation
         │   • Limit helpers
         │   • NOT extractAgentIdFromMetadata (coupled to state machine)
         │
         ├─> utils/fileUtils.ts (+70 lines)
         │   • saveTruncatedContent (NEW)
         │
         └─> utils/tool-utils.ts (+80 lines)
             • getToolSuggestion (NEW)
             • createErrorResponse (NEW)
```

---

## 7. Key Design Decisions

### 7.1 Why Extract Types First

**Decision:** Create `scheduler/types.ts` as the first step.

**Rationale:**
- Types have **zero runtime dependencies** — safe to move first
- Imported by **all other modules** — establishes foundation
- Upstream did this first — proven approach
- Enables incremental refactoring (move types, then consumers update imports)

**Critical Constraint:** MUST avoid circular dependencies by importing from leaf modules, NOT `../index.js`

### 7.2 Why Extract ToolExecutor with Narrowed Callbacks

**Decision:** Single-tool execution logic moves to dedicated class with `onPid` and `onLiveOutput` callbacks.

**Rationale:**
- **Cohesive unit:** Everything needed to execute one tool (hooks, truncation, PID, errors)
- **Testable in isolation:** Mock tool invocations without scheduler complexity
- **Reusable:** `nonInteractiveToolExecutor` can use this (currently duplicates logic)
- **Narrowed contract:** Executor doesn't manage state machine, only reports events (fixes review finding #5)
- Upstream proved this boundary works

### 7.3 Why Keep Parallel Batching in Scheduler

**Decision:** Buffering, ordering, and batch output limits stay in CoreToolScheduler.

**Rationale:**
- **Stateful orchestration:** Requires access to `toolCalls`, `pendingResults`, `nextPublishIndex`, reentrancy flags
- **LLxprt-specific:** Upstream doesn't have this, no proven extraction pattern
- **Tightly coupled:** Buffering logic interacts with state machine transitions
- **Low ROI:** Only ~200 lines, high complexity to extract, risk of breaking parallelism

**Alternative Considered:** Extract `ParallelBatchExecutor` class.
**Rejected Because:** Would need to pass all scheduler state, making it a "god object" — no real separation of concerns.

### 7.4 Why NOT Extract Validation

**Decision:** Tool validation stays in `_schedule` (addresses review finding #3).

**Rationale:**
- Validation is NOT just "registry lookup + buildInvocation"
- It includes: governance blocklist, ContextAwareTool context injection, startTime init, agent ID defaulting, signal storage
- These side effects are tightly coupled to scheduling state
- Extracting would require either a "god validator" or unclear multi-pass boundaries
- **No value gained** from extraction — would cost ~100 lines in interface overhead

### 7.5 Why NOT Extract Completion Tracking

**Decision:** Completion detection stays in scheduler (addresses review finding #10).

**Rationale:**
- Current logic is ~15 lines
- Tightly coupled to `toolCalls` array mutation
- Extracting would add ~50 lines overhead for minimal clarity gain
- **No value gained** from extraction — indirection without benefit

### 7.6 Why NOT Extract extractAgentIdFromMetadata

**Decision:** `extractAgentIdFromMetadata` stays in scheduler (addresses review finding #1).

**Rationale:**
- NOT a pure utility — used in `setStatusInternal` for agent attribution fallback
- Agent ID resolution logic: `request.agentId` → `metadata.agentId` → `DEFAULT_AGENT_ID`
- This fallback behavior is spread through state transitions
- Moving it without call site verification creates silent agent attribution drift
- **Conclusion:** Keep it as private method in scheduler

### 7.7 Re-Export Strategy for Backward Compatibility

**Decision:** Re-export all moved types from `coreToolScheduler.ts`.

**Example:**
```typescript
// packages/core/src/core/coreToolScheduler.ts
export type {
  ToolCall,
  ValidatingToolCall,
  ScheduledToolCall,
  ExecutingToolCall,
  SuccessfulToolCall,
  ErroredToolCall,
  CancelledToolCall,
  WaitingToolCall,
  Status,
  CompletedToolCall,
  ConfirmHandler,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '../scheduler/types.js';

export { ToolExecutor } from '../scheduler/tool-executor.js';
```

**Rationale:**
- **Zero breaking changes** — existing imports continue to work
- Gradual migration path — consumers can update imports over time
- Upstream did this — proven approach

### 7.8 Test Strategy

**Decision:** Move tests with extracted code, keep integration tests in coreToolScheduler.test.ts.

**Test Organization:**
- `scheduler/types.test.ts` — Type assertions (minimal, mostly type-checking)
- `scheduler/tool-executor.test.ts` — Comprehensive tests for single-tool execution
- `utils/generateContentResponseUtilities.test.ts` — Multimodal response formatting
- `utils/fileUtils.test.ts` — Truncation tests (NEW tests for saveTruncatedContent)
- `utils/tool-utils.test.ts` — Tool suggestion and error response tests (NEW)
- `core/coreToolScheduler.test.ts` — **Integration tests** for full flow, parallel batching, confirmation flow

**Rationale:**
- Unit tests move with extracted modules (better locality)
- Integration tests stay to verify scheduler orchestration
- Upstream removed 579 test lines from scheduler test file — follow that pattern

---

## 8. Risk Analysis

### 8.1 Breaking Changes

**Risk:** Moving types breaks existing imports.

**Mitigation:**
- Re-export all types from `coreToolScheduler.ts`
- Run full test suite after each extraction step
- Use TypeScript compiler to find all import errors

### 8.2 Parallel Batching Regression

**Risk:** Extracting execution logic breaks ordered publishing.

**Mitigation:**
- ToolExecutor is **stateless** — scheduler controls batching
- Keep buffering and ordering logic in scheduler
- Add integration tests specifically for parallel execution order (see requirements.md)
- Manually test multi-tool scenarios (e.g., 5 read_file calls in parallel)

### 8.3 Hidden State Dependencies

**Risk:** Functions that look pure actually depend on scheduler state.

**Example:** `extractAgentIdFromMetadata` is used in state transitions, not pure.

**Mitigation:**
- Make all dependencies **explicit parameters**
- Review each extracted function for hidden state access (DONE in this design)
- Run tests to catch runtime errors

### 8.4 Circular Dependencies

**Risk:** `scheduler/types.ts` imports from `../index.js`, which imports from `scheduler/types.ts`.

**Mitigation:**
- Types module MUST import directly from leaf modules (e.g., `from '../tools/tool.js'`)
- NEVER import from `../index.js` in types file
- Use `import type` where possible
- Verify with build to catch cycles early

### 8.5 Test Coverage Regression

**Risk:** Moving tests causes some code to become untested.

**Mitigation:**
- Run code coverage report before and after refactoring
- Ensure all extracted modules have dedicated test files
- Keep integration tests to catch orchestration bugs

### 8.6 Git History Loss

**Risk:** Moving code to new files loses `git blame` history.

**Mitigation:**
- Use `git mv` where possible (doesn't work for partial extractions)
- Document in commit messages which code came from which lines
- Accept that this is the cost of refactoring — cleaner code is worth it

---

## 9. Expected Outcome

### 9.1 Line Count Targets

| Module | Lines | Purpose |
|--------|-------|---------|
| **scheduler/types.ts** | 130 | All ToolCall state types, handlers |
| **scheduler/tool-executor.ts** | 300 | Single-tool execution with hooks, PID, truncation |
| **utils/generateContentResponseUtilities.ts** | +150 | Response formatting (convertToFunctionResponse + helpers) |
| **utils/fileUtils.ts** | +70 | saveTruncatedContent (NEW) |
| **utils/tool-utils.ts** | +80 | getToolSuggestion, createErrorResponse (NEW) |
| **core/coreToolScheduler.ts** | **~1,559** | Orchestration, batching, state machine, confirmation, validation, completion |

**Total:** 2,139 lines refactored into 6 modules with clear responsibilities (27% reduction in scheduler, others gain utility functions).

### 9.2 Improved Testability

**Before:**
- One 2,139-line file
- Tests require full scheduler setup
- Hard to isolate specific behaviors

**After:**
- ToolExecutor testable in isolation (mock tools, no scheduler state)
- Response formatting testable with mock Parts
- Utilities testable as pure functions
- Scheduler tests focus on orchestration logic

### 9.3 Improved Maintainability

**Before:**
- 2,139 lines in one file
- 9 different responsibilities mixed together
- Hard to understand execution flow

**After:**
- Scheduler: ~1,559 lines focused on orchestration
- ToolExecutor: 300 lines focused on single-tool execution
- Utilities: Small, focused, reusable functions
- Clear separation of concerns

### 9.4 Success Metrics

**Must Have:**
- All existing tests pass without modification (except moved tests)
- Zero breaking changes to public API
- Parallel batching still works (order preserved, reentrancy guard intact)
- Code coverage maintained or improved

**Should Have:**
- Scheduler file under 1,600 lines
- ToolExecutor reused in nonInteractiveToolExecutor
- New utilities reused in other parts of codebase

**Could Have:**
- Improved build times (fewer dependencies per file)
- Easier onboarding for new contributors

---

## Appendix A: Function Movement Checklist

### Functions Moving to `scheduler/types.ts` (Pure Types)
- [x] All ToolCall state type definitions
- [x] All handler type definitions
- [ ] ~~ToolCallRequestInfo~~ (stays in turn.ts)
- [ ] ~~ToolCallResponseInfo~~ (stays in turn.ts)

### Functions Moving to `scheduler/tool-executor.ts`
- [x] Single-tool execution logic from `launchToolExecution`
- [x] Hook invocation (via executeToolWithHooks)
- [x] PID tracking (via `onPid` callback)
- [x] Live output streaming (via `onLiveOutput` callback)
- [x] Output truncation (via saveTruncatedContent from fileUtils)
- [x] Result transformation (via convertToFunctionResponse from utils)
- [x] Error handling and cancellation

### Functions Moving to `utils/generateContentResponseUtilities.ts`
- [x] `convertToFunctionResponse`
- [x] `createFunctionResponsePart`
- [x] `toParts`
- [x] `limitStringOutput`
- [x] `limitFunctionResponsePart`
- [ ] ~~`extractAgentIdFromMetadata`~~ (stays in scheduler, coupled to state machine)

### Functions Moving to `utils/fileUtils.ts`
- [x] `saveTruncatedContent` (NEW, replacing inline truncation logic, with telemetry emission)

### Functions Moving to `utils/tool-utils.ts`
- [x] `getToolSuggestion` (NEW, extracted from inline logic)
- [ ] ~~`createErrorResponse`~~ (stays inline in scheduler, used in 6+ call sites)

### Functions Staying in CoreToolScheduler
- [x] `setStatusInternal` (state machine with agent fallback via `extractAgentIdFromMetadata`)
- [x] `setArgsInternal` (ContextAwareTool injection)
- [x] `setPidInternal` (state mutation)
- [x] `buildInvocation` (side effects: context injection)
- [x] `_schedule` (governance, validation, startTime, agentId, signal storage)
- [x] `schedule` (queue management with abort handlers)
- [x] `handleConfirmationResponse` (state machine transitions)
- [x] `handleMessageBusResponse` (state machine transitions)
- [x] `publishConfirmationRequest` (message bus side effect)
- [x] `approveToolCall` (state transition)
- [x] `evaluatePolicyDecision` (uses config.policyEngine)
- [x] `getPolicyContextFromInvocation` (pure but internal)
- [x] `handlePolicyDenial` (state transition)
- [x] `_applyInlineModify` (async state mutation)
- [x] `applyBatchOutputLimits` (batch state mutation)
- [x] `bufferResult`, `bufferError`, `bufferCancelled` (batch state mutation)
- [x] `publishBufferedResults` (reentrancy guard, batch state reset)
- [x] `publishResult` (hooks + state transition)
- [x] `attemptExecutionOfScheduledCalls` (parallel launch)
- [x] `launchToolExecution` (bridges executor and buffering)
- [x] `checkAndNotifyCompletion` (trivial, state coupled)
- [x] `isRunning` (state query)
- [x] `notifyToolCallsUpdate` (callback invocation)
- [x] `setToolCallOutcome` (state mutation)
- [x] `autoApproveCompatiblePendingTools` (async state evaluation)
- [x] `cancelAll` (comprehensive state reset)
- [x] `dispose` (cleanup with timeout handling)
- [x] `extractAgentIdFromMetadata` (fallback logic in state machine)
- [x] `createErrorResponse` (inline utility, used in 6+ call sites for consistent error formatting)

---

## Appendix B: Terminology Reference

**Exact Enum Names from Source:**
- `ToolErrorType` enum: `INVALID_TOOL`, `INVALID_TOOL_PARAMS` (not `INVALID_PARAMETERS`), `UNHANDLED_EXCEPTION`, `FILE_NOT_FOUND`, `TARGET_IS_DIRECTORY`, `FILE_TOO_LARGE`, `READ_CONTENT_FAILURE`, `TOOL_NOT_REGISTERED`, `TOOL_DISABLED`
- `ToolConfirmationOutcome` enum: `ProceedOnce`, `ProceedAlways`, `Cancel`, `ModifyWithEditor`
- `PolicyDecision` enum: `ALLOW`, `DENY`, `ASK_USER`
- `ApprovalMode` enum: `YOLO`, ...

**State Names:**
- `'validating'`, `'scheduled'`, `'executing'`, `'awaiting_approval'`, `'success'`, `'error'`, `'cancelled'`

---

**End of Design Specification**
ference

**Exact Enum Names from Source:**
- `ToolErrorType` enum: `INVALID_TOOL`, `INVALID_TOOL_PARAMS` (not `INVALID_PARAMETERS`), `UNHANDLED_EXCEPTION`, `FILE_NOT_FOUND`, `TARGET_IS_DIRECTORY`, `FILE_TOO_LARGE`, `READ_CONTENT_FAILURE`, `TOOL_NOT_REGISTERED`, `TOOL_DISABLED`
- `ToolConfirmationOutcome` enum: `ProceedOnce`, `ProceedAlways`, `Cancel`, `ModifyWithEditor`
- `PolicyDecision` enum: `ALLOW`, `DENY`, `ASK_USER`
- `ApprovalMode` enum: `YOLO`, ...

**State Names:**
- `'validating'`, `'scheduled'`, `'executing'`, `'awaiting_approval'`, `'success'`, `'error'`, `'cancelled'`

---

**End of Design Specification**
