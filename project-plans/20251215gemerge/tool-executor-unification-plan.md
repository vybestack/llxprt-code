# Tool Executor Unification Plan

## Background

- Upstream gemini-cli attempted to unify interactive + non-interactive tool execution by routing non-interactive calls through `CoreToolScheduler` (`15c62bade` - "Reuse CoreToolScheduler for nonInteractiveToolExecutor (#6714)").
- `15c62bade` exists in LLxprt history (it was not "skipped"), but LLxprt later re-expanded `packages/core/src/core/nonInteractiveToolExecutor.ts` to preserve LLxprt-specific requirements (emoji filtering semantics, telemetry, tool governance, and tool-call/response pairing) that are not supported by `CoreToolScheduler` as-is.
- A later upstream follow-up (`9e8c7676` - "record tool calls in non-interactive mode (#10951)") assumes the scheduler-based shape and changes types/consumers. It cannot be applied cleanly on top of LLxprt's current executor without explicit design decisions.

Additionally, Batch 44 (`9e8c7676` - "fix(cli): record tool calls in non-interactive mode #10951") was explicitly skipped due to conflicts with 7 core files.

## Current Architecture

### LLxprt's nonInteractiveToolExecutor.ts (~540 lines)

Location: `packages/core/src/core/nonInteractiveToolExecutor.ts`

**LLxprt-Specific Features:**
- **Emoji Filtering**: Full integration with EmojiFilter class
  - `getOrCreateFilter()` - Creates/retrieves filter based on ephemeral settings
  - `filterFileModificationArgs()` - Special handling for edit_file, write_file
  - Bypass for search tools (grep, glob, read_file)
- **Tool Governance**:
  - `buildToolGovernance()` - Builds allowed/disabled/excluded sets
  - `isToolBlocked()` - Checks if tool is blocked by policy
  - `tools.allowed`, `tools.disabled`, `disabled-tools` settings
- **Telemetry Integration**:
  - `logToolCall()` with detailed event data
  - Duration tracking, error classification
  - MCP vs native tool type detection
- **Response Parts Generation**:
  - Paired tool call and response Parts for history
  - Uses `convertToFunctionResponse()` from coreToolScheduler

### LLxprt's CoreToolScheduler.ts (~1726 lines)

Location: `packages/core/src/core/coreToolScheduler.ts`

**Key Features:**
- **Buffered Parallel Execution** (CRITICAL - must preserve):
  - `pendingResults: Map` for buffering completed results
  - `nextPublishIndex` for ordered result publishing
  - Execute tools in parallel, publish in request order
- **Interactive Features**:
  - Approval workflow (WaitingToolCall, confirmation handlers)
  - Editor integration (ModifyWithEditor)
  - Policy engine integration
- **Duplicated Tool Governance** (same as nonInteractiveToolExecutor)

### Important Divergences / Gotchas (MUST understand before attempting unification)

1. **Tool governance normalization differs today**
   - `coreToolScheduler.ts` canonicalizes via `normalizeToolName(...)` (see `packages/core/src/tools/toolNameUtils.ts`).
   - `nonInteractiveToolExecutor.ts` canonicalizes via `trim().toLowerCase()`.
   - Any unification MUST pick one canonicalization strategy and apply it consistently to:
     - Ephemeral lists (`tools.allowed`, `tools.disabled`, legacy `disabled-tools`)
     - Excluded tools (`getExcludeTools()`)
     - Runtime tool call names.

2. **`CoreToolScheduler` currently hardcodes "interactive mode" tool context**
   - When the scheduler sets `ContextAwareTool.context`, it always sets `interactiveMode: true`.
   - This is observable behavior (e.g. `todo-write` only emits interactive events when `interactiveMode` is true).
   - If `CoreToolScheduler` is ever used for non-interactive execution, it MUST be able to set `interactiveMode: false`.

3. **Emoji filtering can double-apply**
   - LLxprt file-modification tools (e.g. `edit`, `write_file`) already apply emoji filtering inside the tool implementation.
   - `nonInteractiveToolExecutor.ts` also filters tool args and may inject `<system-reminder>` text.
   - Moving emoji filtering into the scheduler without a clear rule risks double-filtering and/or changing warn/auto semantics.

4. **Non-interactive confirmation flow must be deterministic**
   - `CoreToolScheduler` can publish confirmation requests over the message bus and wait for user approval.
   - Non-interactive execution MUST NOT end in `awaiting_approval` (there is no user to respond).

### Execution Paths in subagent.ts

1. **runInteractive()**: Uses `CoreToolScheduler` with approval workflow
2. **runNonInteractive()**: Uses `executeToolCall()` from nonInteractiveToolExecutor directly

## What Upstream Did

Upstream's scheduler-based approach (conceptually):

```typescript
// IMPORTANT: Resolve via onAllToolCallsComplete; do NOT assume getCompletedCalls().
return new Promise((resolve, reject) => {
  new CoreToolScheduler({
    config,
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
    onAllToolCallsComplete: async (completedToolCalls) => {
      resolve(completedToolCalls[0]);
    },
  })
    .schedule(toolCallRequest, abortSignal)
    .catch(reject);
});
```

## Why a Straight Cherry-Pick Does Not Work (LLxprt-specific)

1. **`CoreToolScheduler` currently assumes "interactive mode"** (see "Important Divergences" above).
2. **LLxprt needs emoji filtering + tool governance + telemetry** that the upstream thin-wrapper does not provide.
3. **Type/contract drift**: upstream evolves return types (e.g. returning `CompletedToolCall` vs `ToolCallResponseInfo`) and updates consumers accordingly.

## Related Upstream Commits / Decisions

| Commit | Date | Subject | Relationship |
|--------|------|---------|--------------|
| `15c62bade` | 2025-08-21 | Reuse CoreToolScheduler for nonInteractiveToolExecutor | Scheduler-based non-interactive (exists in LLxprt history) |
| `9e8c7676` | 2025-10-14 | Record tool calls in non-interactive mode | Batch 44, explicitly skipped |
| `ada179f5` | 2025-10-16 | Process function calls sequentially | LLxprt implemented buffered parallel instead |

## Implementation Strategy

### Phase 0: Pre-checks (run before any implementation)

```bash
# Confirm current duplication + normalization differences
rg -n "function buildToolGovernance\\(|function isToolBlocked\\(" packages/core/src/core/coreToolScheduler.ts packages/core/src/core/nonInteractiveToolExecutor.ts
rg -n "normalizeToolName\\(" packages/core/src/core/coreToolScheduler.ts

# Confirm CoreToolScheduler hardcodes interactiveMode: true
rg -n "interactiveMode: true" packages/core/src/core/coreToolScheduler.ts
```

### Locked Decisions (do not revisit during implementation)

1. **Unification is the goal.** All non-interactive tool execution routes through `CoreToolScheduler`. `nonInteractiveToolExecutor.ts` becomes a thin wrapper (no direct tool invocation).
2. **Return type change is allowed/required.** `executeToolCall(...)` returns a `CompletedToolCall` (upstream shape from `9e8c7676`), not a bare `ToolCallResponseInfo`.
3. **Non-interactive approvals are forced to YOLO.** The scheduler config used for non-interactive execution MUST return `ApprovalMode.YOLO` so `shouldConfirmExecute()` short-circuits and the scheduler never publishes confirmation requests.
4. **Non-interactive policy is enforced.** The scheduler config used for non-interactive execution MUST use a `PolicyEngine` with `nonInteractive: true` so `ASK_USER` becomes `DENY` deterministically.
5. **Emoji filtering happens before scheduling (non-interactive only).**
   - Apply the same emoji-filtering semantics currently implemented in `packages/core/src/core/nonInteractiveToolExecutor.ts`.
   - Replace `ToolCallRequestInfo.args` with the filtered args before scheduling so history + telemetry reflect the executed args.
   - Preserve exact-match fields: never filter `old_string`, never filter file paths.
6. **Emoji system reminders are preserved.** When filtering produces `systemFeedback` (warn mode), append it to the *function response output string* (do not add extra parts).
7. **Atomic tool call/response pairing stays intact.** Keep the invariant restored by `9696e92d0` (tool call part immediately followed by its response parts).
8. **No double telemetry logging.** Once Phase 3 is complete, rely on scheduler-emitted `ToolCallEvent` telemetry (do not also call `logToolCall` from the non-interactive wrapper).
9. **No new backward-compat shims.** Do not add new tool aliases or legacy settings beyond the already-supported `disabled-tools` key.

### Phase 1 (MANDATORY): Extract Shared Module (`toolGovernance.ts`)

**Goal:** Single source of truth for tool governance logic.

**New File:** `packages/core/src/core/toolGovernance.ts`

```typescript
// NOTE: Use the same canonicalization as CoreToolScheduler today:
// canonical = normalizeToolName(raw) ?? raw.trim().toLowerCase()
```

**Changes:**
- Extract the *effective* behavior from:
  - `packages/core/src/core/coreToolScheduler.ts` (normalization via `normalizeToolName`)
  - `packages/core/src/core/nonInteractiveToolExecutor.ts` (same settings keys, plus excluded tools)
- Update both callers to import from the shared module.
- Add a unit test that ensures:
  - legacy `disabled-tools` still works
  - `tools.allowed` and `tools.disabled` override correctly
  - normalization treats `WriteFileTool` / `writeFile` / `write_file` consistently (via `normalizeToolName`)

**Acceptance criteria (must all pass):**
- Existing `packages/core/src/core/coreToolScheduler.test.ts` passes
- Existing `packages/core/src/core/nonInteractiveToolExecutor.test.ts` passes

### Phase 2 (MANDATORY): Parameterize tool context `interactiveMode`

**Goal:** Allow `CoreToolScheduler` to set `ContextAwareTool.context.interactiveMode` correctly when used outside interactive UI flows.

**Required change (minimal):**
- Add an option to `CoreToolSchedulerOptions`, e.g. `toolContextInteractiveMode?: boolean` (default `true`).
- Replace hard-coded `interactiveMode: true` assignments with the option value.
- Add a focused test proving that when the option is `false`, a context-aware tool observing `interactiveMode` sees `false`.

**Acceptance criteria (must all pass):**
- Existing scheduler tests still pass (default remains `true`)
- New test for `toolContextInteractiveMode: false` passes

### Phase 3 (MANDATORY): Full Executor Unification (route non-interactive through CoreToolScheduler)

**Goal:** Reduce duplication by making `nonInteractiveToolExecutor.ts` a thin wrapper around `CoreToolScheduler` *without* changing LLxprt semantics.

**Prerequisites (MANDATORY):**
1. Phase 1 is complete (shared governance module).
2. Phase 2 is complete (scheduler can set `interactiveMode: false`).
3. All "Locked Decisions" above are implemented as written (no deviations).

**Implementation outline (do not deviate):**
1. Rewrite `packages/core/src/core/nonInteractiveToolExecutor.ts`:
   - Signature: `executeToolCall(config: Config, toolCallRequest: ToolCallRequestInfo, abortSignal: AbortSignal): Promise<CompletedToolCall>`
   - Behavior:
     - Do NOT re-implement tool governance checks here. `CoreToolScheduler.schedule(...)` already enforces governance (and after Phase 1 it uses the shared module).
     - Apply emoji filtering to `toolCallRequest.args` (Locked Decision #5).
     - Build a scheduler config wrapper that forces:
       - `getApprovalMode(): ApprovalMode.YOLO` (Locked Decision #3)
       - `getPolicyEngine(): PolicyEngine(nonInteractive: true)` (Locked Decision #4)
       - Ensure the wrapper provides at least: `getToolRegistry`, `getSessionId`, `getTelemetryLogPromptsEnabled`, `getEphemeralSettings`, `getExcludeTools`, `getAllowedTools`, `getApprovalMode`, `getMessageBus`, `getPolicyEngine`.
     - Instantiate `CoreToolScheduler` with:
       - `toolContextInteractiveMode: false`
       - `onAllToolCallsComplete` resolves the first completed call
     - Schedule the (filtered) request and return the `CompletedToolCall`.
     - After completion, if emoji filtering produced `systemFeedback`, mutate the returned call's `response.responseParts` to append the reminder to the function response output string (Locked Decision #6).
2. Update consumers to the new return type:
   - `packages/core/src/core/subagent.ts` non-interactive path: use `(await executeToolCall(...)).response` or `call.response.responseParts`.
   - `packages/cli/src/nonInteractiveCli.ts`: same update.
   - `packages/core/src/agents/executor.ts`: same update.
   - Update mocks in `packages/core/src/core/subagent.test.ts` accordingly.
3. Keep buffered parallel execution untouched (interactive path).
4. Resolve via `onAllToolCallsComplete`; do NOT add or rely on any `getCompletedCalls()` API.

### Phase 4 (MANDATORY): Tests and Verification for Unification

**Required test updates (minimum set):**
- `packages/core/src/core/nonInteractiveToolExecutor.test.ts` (expects `CompletedToolCall` now)
- `packages/core/src/core/subagent.test.ts` (mocks + assertions)
- `packages/cli/src/nonInteractiveCli.test.ts` (if it asserts tool call recording/shape)
- `packages/core/src/agents/executor.test.ts` (if it asserts tool response shape)

**New focused test (required):**
- Add a scheduler unit test proving `toolContextInteractiveMode: false` reaches a context-aware tool that branches on `interactiveMode`.

## Constraints (MUST Preserve)

1. **Emoji Filtering** - All tool execution paths
2. **Tool Governance** - allowed/disabled/excluded
3. **Buffered Parallel Execution** - Execute parallel, publish ordered (ada179f5)
4. **Multi-Provider Architecture** - LLxprt's provider abstraction
5. **Telemetry Integration** - Logging and metrics
6. **Response Parts Pairing** - For chat history
7. **No new backward-compat shims** - do not add new aliases beyond existing `disabled-tools` handling

## Testing Strategy

1. **Unit Tests:**
   - nonInteractiveToolExecutor.test.ts - All existing
   - coreToolScheduler.test.ts - Buffered parallel
   - New toolGovernance.test.ts

2. **Integration Tests:**
   - Non-interactive CLI execution
   - Subagent runNonInteractive path
   - Subagent runInteractive path

3. **Feature Tests:**
   - Emoji filtering in tool output
   - Tool governance blocking
   - Parallel execution with ordered results

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression to sequential | High | Preserve forEach pattern, add benchmarks |
| Loss of emoji filtering | Medium | Add filter path tests |
| Tool governance bypass | High | Add governance tests for both paths |
| Breaking subagent | High | Test both execution modes |

## Estimated Effort

- Phase 1 (Governance): 2-4 hours
- Phase 2 (Tool context interactiveMode): 1-2 hours
- Phase 3 (Full unification): 4-8 hours
- Phase 4 (Tests + verification): 2-6 hours
- Testing: 4-8 hours

**Total (Full unification): 13-28 hours**

## Decision

Implement Phases 1-4 in order. Do not ship a "partial" result where non-interactive execution remains on a separate executor.
