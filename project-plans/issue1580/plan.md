# Issue 1580: Decompose coreToolScheduler.ts

## 1. What Is Being Asked

Issue 1580 (child of umbrella issue 1568 "0.10.0 Code Improvement Plan") asks us to decompose `packages/core/src/core/coreToolScheduler.ts` (currently 1,833 lines) into focused, single-responsibility modules. The file is a "god object" — one monolithic class (`CoreToolScheduler`) that handles tool validation, policy evaluation, confirmation flows, result buffering/publishing, parallel execution coordination, and state management all in one place.

## 2. Acceptance Criteria

- [ ] No single file exceeds 800 lines
- [ ] No single function exceeds 80 lines
- [ ] All existing tests pass (9 test files, ~7,655 lines of tests total)
- [ ] Test coverage does not decrease

## 3. Current State Analysis

### File: `coreToolScheduler.ts` — 1,833 lines

**Already extracted prior to this issue:**
- `scheduler/types.ts` (157 lines) — ToolCall state machine types (DUPLICATED in coreToolScheduler.ts lines ~71-168)
- `scheduler/tool-executor.ts` (224 lines) — Single tool execution with hooks
- `policy/policy-helpers.ts` (130 lines) — Policy evaluation helpers (already uses callback pattern for `setStatus`)

**Methods exceeding 80 lines (the ones that MUST be broken up):**

| Method | Lines | Start | End |
|--------|-------|-------|-----|
| `setStatusInternal` | 158 | 413 | 570 |
| `_schedule` | 264 | 716 | 979 |
| `handleConfirmationResponse` | 166 | 981 | 1146 |
| `publishBufferedResults` | 128 | 1271 | 1398 |
| `launchToolExecution` | 91 | 1523 | 1613 |

**All consumers that import from coreToolScheduler.ts:**

Type-only imports (just need re-exports from coreToolScheduler.ts):
- `core/nonInteractiveToolExecutor.ts` — `CompletedToolCall`
- `core/ConversationManager.ts` — `CompletedToolCall`
- `core/geminiChat.ts` — `CompletedToolCall`
- `core/subagent.ts` — `CompletedToolCall`, `OutputUpdateHandler`
- `core/subagentScheduler.ts` — `CompletedToolCall`, `OutputUpdateHandler`, `ToolCallsUpdateHandler`
- `telemetry/types.ts` — `CompletedToolCall`

Value imports (need the class or runtime entities):
- `config/schedulerSingleton.ts` — `CoreToolScheduler` (class), `CoreToolSchedulerOptions`, `ToolCall`, `CompletedToolCall`

Barrel re-export:
- `index.ts` line 83: `export * from './core/coreToolScheduler.js'` — re-exports everything

Test files that import types (through barrel or directly):
- `coreToolScheduler.test.ts` lines 7-8: `import type { ToolCall, ... }` AND `import { CoreToolScheduler, ToolCall, WaitingToolCall }` — NOTE: the second line imports type aliases as values. This works today but is fragile with `isolatedModules`/`verbatimModuleSyntax`. We will ensure the re-exports from `coreToolScheduler.ts` preserve this.
- Plus 8 other test files and `telemetry/*.test.ts`, `hooks/*.test.ts`, `core/toolExecutorUnification.integration.test.ts`, `config/config.scheduler.test.ts`

**Test files (9 total, 7,655 lines):**
1. `coreToolScheduler.test.ts` (4,054 lines) — main test suite
2. `coreToolScheduler.cancellation.test.ts` (404 lines)
3. `coreToolScheduler.contextBudget.test.ts` (479 lines)
4. `coreToolScheduler.duplication.test.ts` (664 lines)
5. `coreToolScheduler.hooks.characterization.test.ts` (515 lines)
6. `coreToolScheduler.interactiveMode.test.ts` (423 lines)
7. `coreToolScheduler.publishingError.test.ts` (230 lines)
8. `coreToolScheduler.raceCondition.test.ts` (485 lines)
9. `coreToolScheduler.toolExecutor.characterization.test.ts` (401 lines)

## 4. State Ownership Matrix

| State Field | Post-Decomposition Owner | Access Pattern |
|---|---|---|
| `toolCalls[]` | **CoreToolScheduler** | Modules get live reference via `getToolCalls()` (NOT a snapshot) |
| `requestQueue[]` | **CoreToolScheduler** | Scheduler-only |
| `seenCallIds` | **CoreToolScheduler** | Scheduler-only (dedup at boundary) |
| `isScheduling`, `isFinalizingToolCalls` | **CoreToolScheduler** | Lifecycle flags |
| `toolRegistry` | **CoreToolScheduler** | Passed to ToolDispatcher constructor |
| `config` | **CoreToolScheduler** | Passed to ToolDispatcher, ToolExecutor constructors; passed to ResultAggregator via `getDefaultOutputConfig()` |
| `messageBus` | **ConfirmationCoordinator** | Subscription/publish owned by coordinator |
| `messageBusUnsubscribe` | **ConfirmationCoordinator** | Coordinator owns subscribe/dispose lifecycle |
| `pendingConfirmations` | **ConfirmationCoordinator** | Owned exclusively |
| `staleCorrelationIds` | **ConfirmationCoordinator** | Owned exclusively; timers cleared in `dispose()` and `reset()` |
| `processedConfirmations` | **ConfirmationCoordinator** | Owned exclusively |
| `callIdToSignal` | **ConfirmationCoordinator** | Populated via `registerSignal()`, consumed internally, cleared via `deleteSignal()` in completion |
| `toolExecutor` | **CoreToolScheduler** | Passed to execution orchestration |
| `pendingResults` | **ResultAggregator** | Owned exclusively |
| `nextPublishIndex` | **ResultAggregator** | Owned exclusively |
| `currentBatchSize` | **ResultAggregator** | Set via `beginBatch(size)`, not implicit state |
| `batchOutputConfig` | **ResultAggregator** | Owned exclusively |
| `isPublishingBufferedResults` | **ResultAggregator** | Owned exclusively |
| `pendingPublishRequest` | **ResultAggregator** | Owned exclusively |

**Single writer principle**: Each state field has exactly one writer. `toolCalls[]` stays on `CoreToolScheduler` and is mutated only through `setStatusInternal` and related methods.

**Lifecycle invariants:**
- Every `callIdToSignal` entry is inserted via `registerSignal()` and deleted exactly once on terminal completion/cancel via `deleteSignal()`.
- Every `staleCorrelationIds` timer is cleared in `dispose()`, `reset()`, and after its grace period expires.
- No leaked signal/timer entries after `cancelAll()` or `dispose()`.

## 5. Decomposition Plan

### Design Principles

1. **DRY**: Eliminate ~100 lines of duplicated type definitions, deduplicate `createErrorResponse`, deduplicate `ContextAwareTool` context-setting
2. **SoC**: Each extracted module owns one cohesive responsibility and its ancillary state
3. **Preserve public API**: `CoreToolScheduler`'s public interface unchanged. `handleConfirmationResponse` remains as a public delegating facade on `CoreToolScheduler`.
4. **Incremental extraction**: Each phase is independently testable. Extraction + call-site update always in same atomic commit.
5. **No import cycles**: Callback interfaces use standalone function signatures, never `typeof CoreToolScheduler.prototype.X`
6. **Type safety**: Callback interfaces preserve overloaded signatures from `setStatusInternal`

### Module Decomposition

We extract 3 focused modules into `packages/core/src/scheduler/`:

| New Module | Responsibility | Estimated Lines |
|------------|---------------|----------------|
| `confirmation-coordinator.ts` | All confirmation flow: MessageBus subscription, approval/cancel/modify/suggest-edit handling, stale correlation management, auto-approve compatible tools | ~350 |
| `result-aggregator.ts` | Result buffering, ordered publishing, batch output limits, reentrancy guard | ~300 |
| `tool-dispatcher.ts` | Tool resolution, governance checks, invocation building, typo suggestions, ContextAwareTool context-setting | ~200 |

Additionally, `launchToolExecution` + `attemptExecutionOfScheduledCalls` (~180 lines) move into the existing `scheduler/tool-executor.ts`, which becomes responsible for both single-tool and batch execution orchestration.

**Post-decomposition `coreToolScheduler.ts`**: Thin coordinator (~600 lines).

### Callback Interface Design

**Key design decision on `StatusMutator`:** The `setStatusInternal` method has 5 overloaded signatures. TypeScript does NOT preserve overloads when you `bind()` a method. Using a single `setStatus(callId, status, data?)` with `unknown` would lose compile-time safety. Instead, we use **discriminated methods** — one method per transition — which is a 1:1 mapping to the existing overloads and preserves type safety at the callback boundary.

```typescript
// Discriminated methods — preserves type safety at module boundaries
// Each extracted module only calls the 2-3 methods it actually needs
interface StatusMutator {
  setSuccess(callId: string, response: ToolCallResponseInfo): void;
  setError(callId: string, response: ToolCallResponseInfo): void;
  setCancelled(callId: string, reason: string): void;
  setAwaitingApproval(callId: string, details: ToolCallConfirmationDetails): void;
  setScheduled(callId: string): void;
  setExecuting(callId: string): void;
  setValidating(callId: string): void;
  setArgs(callId: string, args: unknown): void;
  setOutcome(callId: string, outcome: ToolConfirmationOutcome): void;
  approve(callId: string): void;
}

// Used by ConfirmationCoordinator — getter returns CURRENT array each call
// NOTE: CoreToolScheduler reassigns toolCalls[] via map() on every setStatusInternal
// call, so this MUST be a getter function, NOT a stored reference
interface SchedulerAccessor {
  attemptExecution(signal: AbortSignal): Promise<void>;
  getToolCalls(): readonly ToolCall[];  // Returns current array (readonly to prevent mutation)
}

// Used by ConfirmationCoordinator — callbacks it invokes
interface EditorCallbacks {
  getPreferredEditor(): EditorType | undefined;
  onEditorClose(): void;
  onEditorOpen?(): void;
}

// Used by ResultAggregator — only needs success/error transitions
interface ResultPublishCallbacks {
  setSuccess(callId: string, response: ToolCallResponseInfo): void;
  setError(callId: string, response: ToolCallResponseInfo): void;
  getFallbackOutputConfig(): ToolOutputSettingsProvider;  // Used when no batch-specific override active
}
```

**Adapter pattern in constructor:**
```typescript
// In CoreToolScheduler constructor — creates adapter objects for callbacks
const statusMutator: StatusMutator = {
  setSuccess: (callId, response) => this.setStatusInternal(callId, 'success', response),
  setError: (callId, response) => this.setStatusInternal(callId, 'error', response),
  setCancelled: (callId, reason) => this.setStatusInternal(callId, 'cancelled', reason),
  setAwaitingApproval: (callId, details) => this.setStatusInternal(callId, 'awaiting_approval', details),
  setScheduled: (callId) => this.setStatusInternal(callId, 'scheduled'),
  setExecuting: (callId) => this.setStatusInternal(callId, 'executing'),
  setValidating: (callId) => this.setStatusInternal(callId, 'validating'),
  setArgs: (callId, args) => this.setArgsInternal(callId, args),
  setOutcome: (callId, outcome) => this.setToolCallOutcome(callId, outcome),
  approve: (callId) => this.approveToolCall(callId),
};
const schedulerAccessor: SchedulerAccessor = {
  attemptExecution: (signal) => this.attemptExecutionOfScheduledCalls(signal),
  getToolCalls: () => this.toolCalls,  // Getter — returns current array each call
};
```

### Why NOT 5 Modules (CodeRabbit's plan)

CodeRabbit proposed 5 new modules including a `ParallelExecutionManager`. Our analysis shows `attemptExecutionOfScheduledCalls` is only 49 lines and `launchToolExecution` is 91 lines. Furthermore, `ToolExecutor` already exists — expanding it to handle batch orchestration is a natural extension. A separate `ParallelExecutionManager` with only 2 methods and tight coupling back to the scheduler would be an anemic abstraction. Post-refactor checkpoint: if coordinator still exceeds complexity targets, revisit in a follow-up issue.

### Post-Decomposition `_schedule` Method (Final Shape)

```typescript
private async _schedule(request, signal): Promise<void> {
  this.isScheduling = true;
  try {
    if (this.isRunning()) throw new Error('Cannot schedule while running');

    const requests = this.normalizeRequests(request);           // ~10 lines
    const freshRequests = this.deduplicateRequests(requests);   // ~10 lines
    if (freshRequests.length === 0) return;

    const governance = buildToolGovernance(this.config);
    const newToolCalls = this.toolDispatcher.resolveAndValidate(
      freshRequests, governance, this.toolContextInteractiveMode,
    );
    this.toolCalls = this.toolCalls.concat(newToolCalls);
    this.notifyToolCallsUpdate();

    for (const toolCall of newToolCalls.filter(tc => tc.status === 'validating')) {
      const callId = toolCall.request.callId;
      this.confirmationCoordinator.registerSignal(callId, signal);
      try {
        if (signal.aborted) {
          this.setStatusInternal(callId, 'cancelled', 'Tool call cancelled by user.');
          continue;
        }
        await this.confirmationCoordinator.evaluateAndRoute(toolCall, signal);
      } catch (error) {
        if (signal.aborted) {
          this.setStatusInternal(callId, 'cancelled', 'Tool call cancelled by user.');
        } else {
          this.setStatusInternal(callId, 'error', createErrorResponse(toolCall.request, error, undefined));
        }
      }
    }

    await this.attemptExecutionOfScheduledCalls(signal);
    void this.checkAndNotifyCompletion();
  } finally {
    this.isScheduling = false;
  }
}
```

---

## 6. Implementation Phases (Test-First)

### Phase -1: Characterization Baseline (prerequisite)

**Goal:** Establish a green bar before any code changes.

1. Run all 9 scheduler test suites and record pass count
2. Run `npx vitest run packages/core` and capture full pass/fail summary
3. Run `npx tsc --noEmit` — must pass
4. Capture coverage baseline: `npx vitest run --coverage packages/core/src/core/coreToolScheduler`
5. This baseline must stay green across ALL subsequent phases

### Phase 0: Type Consolidation + Shared Utilities (prerequisite)

**Goal:** Remove ~100 lines of duplicated types, deduplicate `createErrorResponse`, deduplicate `ContextAwareTool` context-setting.

**Steps:**
1. Field-by-field comparison of types in `coreToolScheduler.ts` (lines ~71-168) vs `scheduler/types.ts`. Verify structural identity. Script: `diff <(grep -A5 "export type ValidatingToolCall" scheduler/types.ts) <(grep -A5 "export type ValidatingToolCall" coreToolScheduler.ts)`
2. `QueuedRequest`: Keep as **private interface in `coreToolScheduler.ts`** (not exported). The export in `scheduler/types.ts` can be marked `@internal` or removed if nothing uses it externally.
3. Replace inline type definitions with imports: `import type { ValidatingToolCall, ... } from '../scheduler/types.js'`
4. **Re-export from `coreToolScheduler.ts`** (NOT from `index.ts`): This is critical for backward compatibility.
   ```typescript
   // In coreToolScheduler.ts — preserves all existing import paths
   // IMPORTANT: Use plain `export { ... }` WITHOUT `type` qualifier (neither
   // statement-level `export type` nor per-specifier `type` markers).
   // Reason: coreToolScheduler.test.ts line 16 imports ToolCall/WaitingToolCall
   // in value position: `import { CoreToolScheduler, ToolCall, WaitingToolCall }`
   // Both `export type { X }` and `export { type X }` would break this under
   // verbatimModuleSyntax. TypeScript correctly elides type-only re-exports
   // during emit even without the `type` qualifier.
   // Before applying: verify tsconfig.json for verbatimModuleSyntax/isolatedModules.
   export {
     ValidatingToolCall, ScheduledToolCall, ErroredToolCall,
     SuccessfulToolCall, ExecutingToolCall, CancelledToolCall,
     WaitingToolCall, ToolCall, CompletedToolCall, Status,
     ConfirmHandler, OutputUpdateHandler, AllToolCallsCompleteHandler,
     ToolCallsUpdateHandler,
   } from '../scheduler/types.js';
   ```
   `index.ts` does NOT change in Phase 0.
5. **`createErrorResponse` consolidation:** There are THREE copies of error response construction:
   - `coreToolScheduler.ts` line 170: file-scoped `createErrorResponse(request, error, errorType)`
   - `utils/generateContentResponseUtilities.ts`: exported `createErrorResponse` (character-for-character identical, already exported from barrel)
   - `policy/policy-helpers.ts` lines 81-99: inline construction in `handlePolicyDenial`
   
   **Action:** Delete the private `createErrorResponse` from `coreToolScheduler.ts` (~23 lines saved). Import from `../utils/generateContentResponseUtilities.js` (already imported on line 63). Update `policy-helpers.ts` to import from the same location instead of constructing inline. No new `scheduler/utils.ts` needed for this — only for `setToolContext` helper.
6. **`QueuedRequest` cleanup:** Delete the exported `QueuedRequest` from `scheduler/types.ts`. Verify no external consumers: `grep -r 'QueuedRequest' packages/core/src --include='*.ts' | grep -v coreToolScheduler | grep -v scheduler/types`. Keep as private interface in `coreToolScheduler.ts`.
7. Move `PolicyContext` from `scheduler/types.ts` to `policy/types.ts`. Update import in `policy-helpers.ts`. Verify no circular dependency: `npx madge --circular packages/core/src/policy/types.ts` (or manual inspection — `coreToolScheduler→policy/types` and `policy-helpers→policy/types` both point same direction, no cycle).
7. Extract `setToolContext(tool, config, agentId, interactiveMode)` helper to `scheduler/utils.ts` — used by both `_schedule` (line 784-792) and `setArgsInternal` (line 580-588).

**Verification after Phase 0:**
```bash
npx tsc --noEmit
npx vitest run packages/core/src/core/coreToolScheduler*.test.ts
npx vitest run packages/core/src/config/config.scheduler.test.ts
```

**Expected result:** `coreToolScheduler.ts` drops to ~1,700 lines. No behavioral change.

### Phase 1: Extract ToolDispatcher

**Goal:** Extract tool resolution, validation, governance, and suggestion logic.

**IMPORTANT:** Extraction of methods from `coreToolScheduler.ts` AND replacement of call sites in `_schedule`/`setArgsInternal` must be done in the SAME atomic commit. Never leave the codebase in a state where `this.buildInvocation()` is called but the method has been removed.

**Test changes first:**
- Add new unit tests in `scheduler/tool-dispatcher.test.ts`:
  - `resolveAndValidate()` — tool not found, tool blocked, invalid params, ContextAwareTool context setting, success
  - `getToolSuggestion()` — levenshtein matching
  - `buildInvocation()` — error handling
  - `setToolContext()` — context setting on ContextAwareTool
- Use mock `ToolRegistry` with `MockTool` pattern from existing tests

**Implementation:**
1. Create `packages/core/src/scheduler/tool-dispatcher.ts`
2. Constructor: `ToolDispatcher(toolRegistry: ToolRegistry, config: Config)`
3. Move: `buildInvocation`, `getToolSuggestion`, and the `requestsToProcessActual.map()` validation block from `_schedule` (lines 755-825)
4. Move `setToolContext` helper (extracted in Phase 0) into ToolDispatcher
5. Import `createErrorResponse` from `scheduler/utils.ts`
6. Update `setArgsInternal` to call `this.toolDispatcher.buildInvocation(...)` instead of `this.buildInvocation(...)`
7. Public API:
   ```typescript
   class ToolDispatcher {
     resolveAndValidate(
       requests: ToolCallRequestInfo[],
       governance: ToolGovernance,
       interactiveMode: boolean,
     ): ToolCall[]
     buildInvocation(tool: AnyDeclarativeTool, args: object): AnyToolInvocation | Error
     getToolSuggestion(unknownToolName: string, topN?: number): string
     setToolContext(tool: AnyDeclarativeTool, sessionId: string, agentId: string, interactiveMode: boolean): void
   }
   ```
8. Update `_schedule` to use `ToolDispatcher.resolveAndValidate()`

**Verification after Phase 1:**
```bash
npx tsc --noEmit
npx vitest run packages/core/src/core/coreToolScheduler*.test.ts
npx vitest run packages/core/src/scheduler/tool-dispatcher.test.ts
npx vitest run packages/core/src/config/config.scheduler.test.ts
```

**Expected result:** `coreToolScheduler.ts` drops by ~100 lines to ~1,600.

### Phase 2: Extract ResultAggregator

**Goal:** Extract result buffering, ordered publishing, and batch output limit logic.

**Test changes first:**
- Add new unit tests in `scheduler/result-aggregator.test.ts`:
  - `bufferResult/bufferError/bufferCancelled` — buffering behavior
  - `beginBatch(size)` — explicit batch initialization
  - `publishBufferedResults` — ordered publishing, reentrancy guard, batch size recovery race condition (characterization of comments at lines 1370-1379)
  - `applyBatchOutputLimits` — budget division, floor at 1000 tokens, single tool no reduction
  - `reset()` — state cleanup
  - Out-of-order completion still produces ordered publish
  - Race where publish request arrives after do-while check

**Implementation:**
1. Create `packages/core/src/scheduler/result-aggregator.ts`
2. Constructor: `ResultAggregator(callbacks: ResultPublishCallbacks)` with overloaded `setStatus`
3. Move state: `pendingResults`, `nextPublishIndex`, `currentBatchSize`, `batchOutputConfig`, `isPublishingBufferedResults`, `pendingPublishRequest`
4. Explicit batch start: `beginBatch(size: number)` replaces implicit `this.currentBatchSize = callsToExecute.length`
5. Move methods: `bufferResult`, `bufferError`, `bufferCancelled`, `publishBufferedResults`, `publishResult`, `applyBatchOutputLimits`
   - Import `convertToFunctionResponse` and `extractAgentIdFromMetadata` from `../utils/generateContentResponseUtilities.js` (stateless utilities, no circular dependency risk)
   - Import `createErrorResponse` from same utility
   - Create own `DebugLogger` instance: `DebugLogger.getLogger('llxprt:scheduler:result-aggregator')`
6. Break `publishBufferedResults` (128 lines) into:
   - `recoverBatchSizeIfNeeded()` (~20 lines)
   - `publishNextInOrder(signal)` (~30 lines)
   - `scheduleFollowUpIfNeeded(signal)` (~15 lines)
   - `publishBufferedResults(signal)` — thin loop orchestrator (~40 lines)
7. Expose `reset()` for `cancelAll`:
   ```typescript
   reset(): void {
     this.pendingResults.clear();
     this.nextPublishIndex = 0;
     this.currentBatchSize = 0;
     this.isPublishingBufferedResults = false;
     this.pendingPublishRequest = false;
     this.batchOutputConfig = undefined;
   }
   ```

**Verification after Phase 2:**
```bash
npx tsc --noEmit
npx vitest run packages/core/src/core/coreToolScheduler*.test.ts
npx vitest run packages/core/src/scheduler/result-aggregator.test.ts
npx vitest run packages/core/src/config/config.scheduler.test.ts
```

**Expected result:** `coreToolScheduler.ts` drops by ~300 lines to ~1,300.

### Phase 3: Extract ConfirmationCoordinator

**Goal:** Extract all confirmation flow logic including MessageBus interaction.

**Test changes first:**
- Add new unit tests in `scheduler/confirmation-coordinator.test.ts`:
  - `handleMessageBusResponse()` — stale correlation, unknown correlation, missing signal, normal flow
  - `handleConfirmationResponse()` — each outcome (ProceedOnce, ProceedAlways, Cancel, ModifyWithEditor, SuggestEdit, inline modify)
  - `autoApproveCompatiblePendingTools()` — approval cascade
  - Stale correlation ID grace period and timeout cleanup
  - Duplicate response before/after modify flow (processedConfirmations gate)
  - Non-interactive confirmation failure path
- Factory helper: `createPendingConfirmation()` to set up complex state for isolated tests

**Implementation:**
1. Create `packages/core/src/scheduler/confirmation-coordinator.ts`
2. Constructor receives focused interfaces plus `config` for policy access:
   ```typescript
   class ConfirmationCoordinator {
     constructor(
       private readonly messageBus: MessageBus,
       private readonly config: Config,  // For getPolicyEngine, getApprovalMode, getAllowedTools, isInteractive, getSessionId
       private readonly statusMutator: StatusMutator,
       private readonly schedulerAccessor: SchedulerAccessor,
       private readonly editorCallbacks: EditorCallbacks,
       private readonly onToolNotification: (details: ToolCallConfirmationDetails) => Promise<void>,  // fire-and-forget
     ) {}
   }
   ```
3. Move state: `pendingConfirmations`, `staleCorrelationIds`, `processedConfirmations`, `callIdToSignal`
4. Move ALL confirmation-related methods:
   - `handleMessageBusResponse` (lines 289-367) — MessageBus subscription handler. Uses `pendingConfirmations`, `staleCorrelationIds`, `callIdToSignal` (all owned by coordinator). Uses `getToolCalls()` getter for step 3 (find waiting tool call). Calls `handleConfirmationResponse`.
   - `handleConfirmationResponse` (lines 981-1146) — Main confirmation dispatcher. Calls `_applyInlineModify`, `autoApproveCompatiblePendingTools`. Imports: `Diff` (for createPatch), `modifyWithEditor`/`isModifiableDeclarativeTool` (for editor flow), `doesToolInvocationMatch` (for auto-approve).
   - `_applyInlineModify` (lines 1159-1194) — Applies inline tool parameter modifications. Uses `StatusMutator.setArgs` + `StatusMutator.setStatus` + `Diff.createPatch`. Only called from `handleConfirmationResponse`.
   - `autoApproveCompatiblePendingTools` (lines 1719-1748) — After approval, auto-approves other pending tools with matching signatures. Uses `SchedulerAccessor.getToolCalls()` + `StatusMutator.setOutcome` + `StatusMutator.approve`. Called from `handleConfirmationResponse` after ProceedAlways.
   - IDE confirmation promise handler (lines 891-912 in `_schedule`) — The `.then()` that captures `handleConfirmationResponse` for IDE-originated confirmations. Moves into `evaluateAndRoute()`.
   - `triggerToolNotificationHook` call (line 940-943 in `_schedule`) — Moves into `evaluateAndRoute()`. **Injected as callback** (not direct import) to avoid `scheduler/ → core/` circular dependency.
5. Move third-party imports: `import * as Diff from 'diff'`, `import { isModifiableDeclarativeTool, modifyWithEditor } from '../tools/modifiable-tool.js'`, `import { doesToolInvocationMatch } from '../utils/tool-utils.js'`
6. Constructor needs `config: Config` for policy engine/approval mode access. `triggerToolNotificationHook` injected as `onToolNotification: (details: ToolCallConfirmationDetails) => void` callback — NOT imported directly from `core/coreToolHookTriggers.ts` to avoid circular `scheduler/ → core/` dependency.
7. New methods:
   - `registerSignal(callId, signal)` — called by scheduler when setting up tool calls
   - `deleteSignal(callId)` — called by scheduler in `checkAndNotifyCompletion`
   - `evaluateAndRoute(toolCall, signal)` — encapsulates policy + confirmation setup from `_schedule` (lines 825-951). MUST be broken into sub-methods to stay under 80 lines:
     - `evaluatePolicy(toolCall)` (~20 lines) — policy engine evaluation
     - `checkAutoApproval(toolCall, signal)` (~15 lines) — YOLO mode, allowed tools
     - `setupConfirmationPrompt(toolCall, signal, policyContext)` (~50 lines) — IDE/CLI confirmation setup + `publishConfirmationRequest`
   - `subscribe()` — MessageBus subscription
   - **Sequencing invariant:** In `handleConfirmationResponse`, `statusMutator.setScheduled(callId)` MUST precede `schedulerAccessor.attemptExecution(signal)`. This ordering is preserved from the original code (lines 1124-1126).
6. Break `handleConfirmationResponse` (166 lines) into:
   - `handleApproval(callId, signal)` (~15 lines)
   - `handleCancellation(callId)` (~10 lines)
   - `handleModifyWithEditor(callId, waitingToolCall, signal)` (~50 lines)
   - `handleSuggestEdit(callId, waitingToolCall, payload)` (~15 lines)
   - `handleInlineModify(callId, waitingToolCall, payload, signal)` (~10 lines)
   - `publishConfirmationOutcome(...)` (~20 lines)
   - `handleConfirmationResponse()` — thin dispatcher (~40 lines)
7. `dispose()` — unsubscribes from MessageBus, clears all state, clears all timers:
   ```typescript
   dispose(): void {
     if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = undefined; }
     this.reset();
   }
   ```
8. `reset()` — for `cancelAll`:
   ```typescript
   reset(): void {
     this.pendingConfirmations.clear();
     this.processedConfirmations.clear();
     this.staleCorrelationIds.forEach(t => clearTimeout(t));
     this.staleCorrelationIds.clear();
     this.callIdToSignal.clear();
   }
   ```
9. `CoreToolScheduler.handleConfirmationResponse` remains as **public delegating facade** with explicit typed signature:
   ```typescript
   async handleConfirmationResponse(
     callId: string,
     originalOnConfirm: (outcome: ToolConfirmationOutcome, payload?: ToolConfirmationPayload) => Promise<void>,
     outcome: ToolConfirmationOutcome,
     signal: AbortSignal,
     payload?: ToolConfirmationPayload,
     skipBusPublish = false,
   ): Promise<void> {
     return this.confirmationCoordinator.handleConfirmationResponse(
       callId, originalOnConfirm, outcome, signal, payload, skipBusPublish,
     );
   }
   ```
10. `CoreToolScheduler.dispose()` delegates: `this.confirmationCoordinator.dispose()`

**Verification after Phase 3:**
```bash
npx tsc --noEmit
npx vitest run packages/core/src/core/coreToolScheduler*.test.ts
npx vitest run packages/core/src/scheduler/confirmation-coordinator.test.ts
npx vitest run packages/core/src/config/config.scheduler.test.ts
```

**Expected result:** `coreToolScheduler.ts` drops by ~350 lines to ~950.

### Phase 4: Expand ToolExecutor + Break Remaining Methods + Get Under 800

**Goal:** Move execution orchestration into `ToolExecutor`, break all remaining >80 line methods.

**Steps:**

1. **Keep `launchToolExecution` in `coreToolScheduler.ts`** as a thin wrapper:
   - `launchToolExecution` (91 lines) already delegates to `this.toolExecutor.execute()`. Moving it to `ToolExecutor` would require a very fat callback interface (setStatus, updateLiveOutput, notifyUpdate, bufferResult, bufferError, bufferCancelled, publishBufferedResults). Instead, keep it in the scheduler but break it into 3 helpers:
     - `handleExecutionSuccess(...)` (~25 lines) — calls `resultAggregator.bufferResult()` + `resultAggregator.publishBufferedResults()`
     - `handleExecutionError(...)` (~25 lines) — calls `resultAggregator.bufferError()` or `resultAggregator.bufferCancelled()`
     - `launchToolExecution()` — thin orchestrator (~40 lines, within 80-line limit)
   - `attemptExecutionOfScheduledCalls` (49 lines) stays in scheduler — it's scheduler coordination logic
   - No changes to `scheduler/tool-executor.ts` in this phase (remains single-tool execution only)

2. **Break `setStatusInternal` (158 lines)** into pure transition builder functions:
   ```typescript
   // In scheduler/status-transitions.ts (~120 lines, new file)
   function buildSuccessToolCall(call, response): SuccessfulToolCall { ... }      // ~15 lines
   function buildErrorToolCall(call, response): ErroredToolCall { ... }           // ~15 lines
   function buildCancelledToolCall(call, reason): CancelledToolCall { ... }       // ~30 lines
   function buildAwaitingApprovalToolCall(call, details): WaitingToolCall { ... } // ~10 lines
   function buildSimpleTransition(call, status): ToolCall { ... }                 // ~15 lines
   ```
   Then `setStatusInternal` becomes a thin dispatcher calling these pure functions (~40 lines).

3. **Wire all modules in constructor:**
   ```typescript
   constructor(options: CoreToolSchedulerOptions) {
     this.config = options.config;
     this.toolDispatcher = new ToolDispatcher(options.toolRegistry, options.config);
     this.resultAggregator = new ResultAggregator({ setStatus: ..., getDefaultOutputConfig: ... });
     this.confirmationCoordinator = new ConfirmationCoordinator(
       options.messageBus, statusMutator, executionTrigger, editorAccess,
     );
     this.toolExecutor = new ToolExecutor(options.config);
     this.setCallbacks(options);
     this.confirmationCoordinator.subscribe();
   }
   ```

4. **Update `cancelAll` to use `buildCancelledToolCall` and coordinate resets:**
   - The original `cancelAll` (lines 1796-1826) constructs `CancelledToolCall` objects inline — this duplicates logic with `setStatusInternal`'s `'cancelled'` case. Post Phase 4, use `buildCancelledToolCall` from `status-transitions.ts` instead. Note: `cancelAll`'s cancelled calls may not preserve `confirmationDetails.fileDiff` (unlike the `awaiting_approval` → `cancelled` path), so `buildCancelledToolCall` must handle the case where `currentCall` may not be `awaiting_approval`.
   - The original `cancelAll` selectively deletes correlationIds per-call then bulk-clears. Post-extraction, `confirmationCoordinator.reset()` bulk-clears upfront. Since `cancelAll` transitions all non-terminal calls to cancelled, the net effect is identical. The per-call deletion in the `map()` loop can be removed.
   ```typescript
   cancelAll(): void {
     // 1. Drain queued requests
     while (this.requestQueue.length > 0) { this.requestQueue.shift()!.reject(...); }
     // 2. Reset extracted modules
     this.resultAggregator.reset();
     this.confirmationCoordinator.reset();
     this.seenCallIds.clear();
     // 3. Cancel active tool calls (stays here — mutates toolCalls[])
     this.toolCalls = this.toolCalls.map(call => { ... });
     this.notifyToolCallsUpdate();
     void this.checkAndNotifyCompletion();
   }
   ```

5. **Update `dispose()` to delegate:**
   ```typescript
   dispose(): void {
     this.confirmationCoordinator.dispose();
     this.seenCallIds.clear();
   }
   ```

**Verification after Phase 4:**
```bash
npx tsc --noEmit
npx vitest run packages/core/src/core/coreToolScheduler*.test.ts
npx vitest run packages/core/src/scheduler/*.test.ts
npx vitest run packages/core/src/config/config.scheduler.test.ts
```

**Expected result:** `coreToolScheduler.ts` ~600 lines. All methods under 80 lines.

### Phase 5: Final Verification

1. **Full test suite:**
   ```bash
   npx vitest run packages/core
   ```
2. **Type checking:**
   ```bash
   npx tsc --noEmit
   ```
3. **File length verification:**
   ```bash
   wc -l packages/core/src/core/coreToolScheduler.ts \
        packages/core/src/scheduler/tool-dispatcher.ts \
        packages/core/src/scheduler/result-aggregator.ts \
        packages/core/src/scheduler/confirmation-coordinator.ts \
        packages/core/src/scheduler/tool-executor.ts \
        packages/core/src/scheduler/status-transitions.ts \
        packages/core/src/scheduler/utils.ts \
        packages/core/src/scheduler/types.ts
   # ALL must be < 800 lines
   ```
4. **Function length verification:**
   ```bash
   npx eslint --no-eslintrc --rule '{"max-lines-per-function": ["error", {"max": 80, "skipBlankLines": true, "skipComments": true}]}' \
     packages/core/src/core/coreToolScheduler.ts \
     packages/core/src/scheduler/*.ts
   # Must pass with zero errors
   ```
5. **Coverage comparison:**
   ```bash
   # Before starting: capture baseline
   npx vitest run --coverage packages/core/src/core/coreToolScheduler
   # After completion: compare
   npx vitest run --coverage packages/core/src/core/coreToolScheduler packages/core/src/scheduler
   # Coverage must not decrease for coreToolScheduler paths
   ```
6. **Verify barrel export:** `grep -n 'coreToolScheduler' packages/core/src/index.ts` — must still be `export * from './core/coreToolScheduler.js'`
7. **Verify all import sites compile:** `npx tsc --noEmit` (covers all 31 files)

## 7. Barrel Export Policy

New modules (`ToolDispatcher`, `ConfirmationCoordinator`, `ResultAggregator`, `status-transitions`, `utils`) are **implementation details** and should NOT be exported from `packages/core/src/index.ts`. Only `CoreToolScheduler` and its types remain in the public API. Add `@internal` JSDoc tags to new module exports for clarity.

## 8. File Inventory (Post-Completion)

| File | Role | Est. Lines |
|------|------|-----------|
| `core/coreToolScheduler.ts` | Thin coordinator + public API facade | ~600 |
| `scheduler/types.ts` | Shared type definitions | ~160 |
| `scheduler/utils.ts` | Shared utilities (createErrorResponse, setToolContext) | ~50 |
| `scheduler/status-transitions.ts` | Pure transition builder functions | ~120 |
| `scheduler/tool-executor.ts` | Single tool execution with hooks (unchanged) | ~224 |
| `scheduler/tool-dispatcher.ts` | Tool resolution + validation + suggestions | ~200 |
| `scheduler/result-aggregator.ts` | Result buffering + ordered publishing | ~300 |
| `scheduler/confirmation-coordinator.ts` | Confirmation flow + MessageBus | ~350 |
| `policy/policy-helpers.ts` | Policy evaluation | ~130 |

All files under 800 lines. Total: ~2,134 lines across 9 files (vs. original ~2,344 across 4 files). Net reduction: ~210 lines from deduplication.

## 9. Subagent Execution Strategy

Each phase will be implemented by `typescriptexpert` and verified by running tests:

- **Phase 0-1**: Type consolidation + ToolDispatcher extraction
- **Phase 2**: ResultAggregator extraction
- **Phase 3**: ConfirmationCoordinator extraction
- **Phase 4**: Expand ToolExecutor + status-transitions + slim coordinator
- **Phase 5**: Full verification pass

Between each phase, all tests are run to ensure incremental correctness.

## 10. Known Issues for Follow-Up

- `coreToolScheduler.test.ts` is 4,054 lines — should be split into per-concern integration tests in a follow-up issue after decomposition
- `processedConfirmations` Set grows unbounded over long sessions — add per-call cleanup when call reaches terminal state (in `checkAndNotifyCompletion` path)
- `_schedule` mutates request objects in-place (agentId defaulting at line 729-733) — clone before enrichment
- `ToolRegistry.getAllToolNames()` — verify availability on the TypeScript type (not just the concrete class) before using in `ToolDispatcher`

## 11. Risk Mitigation

1. **Backward compatibility**: All type re-exports use plain `export { X }` from `coreToolScheduler.ts` (NO `type` qualifier at either statement or specifier level) to preserve value-position imports in test files. Barrel `export *` in `index.ts` unchanged. `handleConfirmationResponse` remains as public delegating facade with explicit typed signature (not `...args` spread).
2. **No import cycles**: Callback interfaces use standalone function signatures. No extracted module imports `CoreToolScheduler`. Types flow one direction: `scheduler/types.ts` → consumed by all. `ConfirmationCoordinator` receives `config: Config` in constructor for `triggerToolNotificationHook` but does NOT import scheduler.
3. **State ownership**: `toolCalls[]` stays on `CoreToolScheduler` — all mutations go through scheduler-owned transition APIs (`setStatusInternal`, `setArgsInternal`, `setPidInternal`, `setToolCallOutcome`, direct `map()` in `cancelAll`). Extracted modules access current array via `getToolCalls()` getter, never stored reference.
4. **Timer lifecycle**: `dispose()` and `reset()` on ConfirmationCoordinator explicitly clear all `staleCorrelationIds` timers. `cancelAll` delegates to `confirmationCoordinator.reset()` which also clears timers. Add invariant test: after `cancelAll` and after completion, all maps/sets/timers empty.
5. **Signal lifecycle invariant**: Every `callIdToSignal` entry inserted via `registerSignal()`, deleted via `deleteSignal()` in `checkAndNotifyCompletion` and `cancelAll` → `reset()`. `processedConfirmations` entries cleared per-call in `checkAndNotifyCompletion` to prevent unbounded growth.
6. **Test stability**: Existing tests NOT rewritten. New focused unit tests ADDED for extracted modules. Each extracted module needs its own `DebugLogger` instance.
7. **Reentrancy**: `publishBufferedResults` reentrancy guard and `setImmediate` recovery path stays intact within `ResultAggregator`. The signal captured by deferred publish must be validated against current batch state.
8. **Atomic commits**: Each phase's extraction + call-site update happens in the same commit. Never leave the codebase in a state where a method is deleted but call sites haven't been updated.
9. **`getToolCalls()` contract**: Returns current array on each call (getter function). NOT a stored reference — since `setStatusInternal` reassigns `this.toolCalls` via `map()`, a stored reference would become stale immediately.
10. **Batch initialization**: Explicit `beginBatch(size)` method replaces implicit shared state write.
11. **Third-party imports**: `Diff` moves to `ConfirmationCoordinator`, `levenshtein` moves to `ToolDispatcher`, `modifiable-tool` imports move to `ConfirmationCoordinator`.
