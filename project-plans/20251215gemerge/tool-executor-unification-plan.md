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
# Identify every call site that must change when executeToolCall() returns CompletedToolCall.
rg -n "executeToolCall\\(" packages/{cli,core}/src

# Identify tests that assert the current ToolCallResponseInfo return shape.
rg -n "executeToolCall\\(" packages/core/src/core/nonInteractiveToolExecutor.test.ts packages/core/src/core/subagent.test.ts packages/core/src/agents/executor.test.ts packages/cli/src/nonInteractiveCli.test.ts || true

# Confirm current duplication + normalization differences
rg -n "function buildToolGovernance\\(|function isToolBlocked\\(" packages/core/src/core/coreToolScheduler.ts packages/core/src/core/nonInteractiveToolExecutor.ts
rg -n "normalizeToolName\\(" packages/core/src/core/coreToolScheduler.ts

# Confirm CoreToolScheduler hardcodes interactiveMode: true
rg -n "interactiveMode: true" packages/core/src/core/coreToolScheduler.ts

# Confirm CoreToolScheduler has a message-bus subscription (unification MUST dispose()).
rg -n "dispose\\(\\)" packages/core/src/core/coreToolScheduler.ts

# Show the exact Config surface CoreToolScheduler consumes (helps build correct wrappers).
rg -o "this\\.config\\.get[A-Za-z0-9_]+" -n packages/core/src/core/coreToolScheduler.ts | sort -u
rg -n "getEphemeralSettings\\?\\(\\)|getExcludeTools\\?\\(\\)" packages/core/src/core/coreToolScheduler.ts

# Confirm SubAgent non-interactive currently calls executeToolCall() with a minimal shim (will need to switch to a scheduler-style wrapper).
rg -n "executeToolCall\\(\\s*this\\.toolExecutorContext" packages/core/src/core/subagent.ts
```

### Locked Decisions (do not revisit during implementation)

1. **Unification is the goal.** All non-interactive tool execution routes through `CoreToolScheduler`. `nonInteractiveToolExecutor.ts` becomes a thin wrapper (no direct tool invocation).
2. **Return type change is allowed/required.** `executeToolCall(...)` returns a `CompletedToolCall` (upstream shape from `9e8c7676`), not a bare `ToolCallResponseInfo`.
3. **Non-interactive must preserve gating (do NOT force YOLO).**
   - `getApprovalMode()` MUST reflect the real configured mode (DEFAULT / AUTO_EDIT / YOLO) so LLxprt’s existing `--approval-mode` / `--yolo` behavior is preserved.
   - This matches upstream gemini-cli behavior: in non-interactive runs it excludes Shell/Edit/WriteFile in DEFAULT, excludes only Shell in AUTO_EDIT, and excludes nothing in YOLO (see `15c62bade` config logic).
   - Non-interactive determinism comes from policy, not YOLO: ensure the scheduler never publishes confirmation requests by using a non-interactive `PolicyEngine` (Locked Decision #4), which converts any `ASK_USER` outcome into a deterministic `DENY`.
   - `getAllowedTools()` MUST be preserved so `--allowed-tools` continues to permit specific invocations in non-interactive mode without prompting.
4. **Non-interactive policy is enforced.** The scheduler config used for non-interactive execution MUST use a `PolicyEngine` with `nonInteractive: true` so `ASK_USER` becomes `DENY` deterministically (and the scheduler cannot reach `awaiting_approval`).
5. **Emoji filtering happens before scheduling (non-interactive only).**
   - Apply the same emoji-filtering semantics currently implemented in `packages/core/src/core/nonInteractiveToolExecutor.ts`.
   - Replace `ToolCallRequestInfo.args` with the filtered args before scheduling so history + telemetry reflect the executed args.
   - Preserve exact-match fields: never filter `old_string`, never filter file paths.
6. **Emoji system reminders are preserved.** When filtering produces `systemFeedback` (warn mode), append it to the *function response output string* (do not add extra parts).
7. **Atomic tool call/response pairing stays intact.** Keep the invariant restored by `9696e92d0` (tool call part immediately followed by its response parts).
8. **No double telemetry logging.** Once Phase 3 is complete, rely on scheduler-emitted `ToolCallEvent` telemetry (do not also call `logToolCall` from the non-interactive wrapper).
9. **No new backward-compat shims.** Do not add new tool aliases or legacy settings beyond the already-supported `disabled-tools` key.
10. **No non-interactive hangs.** The unified non-interactive path must never reach `awaiting_approval`. If it does, treat it as a bug and fail fast.

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
1. Update the executor config type to cover what the scheduler needs.
   - Today `ToolExecutionConfig` (in `nonInteractiveToolExecutor.ts`) is a narrow `Pick<Config, ...>`.
   - Expand it (or introduce a new `NonInteractiveSchedulerConfig`) so it includes *at minimum*:
     - `getToolRegistry()`
     - `getSessionId()`
     - `getEphemeralSettings()` (optional but used by governance)
     - `getExcludeTools()` (optional but used by governance)
     - `getAllowedTools()`
     - `getApprovalMode()` (preserve config semantics; do NOT force YOLO)
     - `getMessageBus()` (scheduler subscribes; wrapper MUST call `dispose()`)
     - `getPolicyEngine()` (must be non-interactive)
     - `getTelemetryLogPromptsEnabled()` (only if telemetry logging remains in the wrapper before Phase 3 finishes)
   - IMPORTANT: the SubAgent’s `ToolExecutionConfig` shim does *not* satisfy this; SubAgent must pass a scheduler-style wrapper (see Step 4).
2. Rewrite `packages/core/src/core/nonInteractiveToolExecutor.ts`:
   - Signature: `executeToolCall(config: Config, toolCallRequest: ToolCallRequestInfo, abortSignal: AbortSignal): Promise<CompletedToolCall>`
   - Behavior:
     - Do NOT re-implement tool governance checks here. `CoreToolScheduler.schedule(...)` already enforces governance (and after Phase 1 it uses the shared module).
     - Apply emoji filtering to `toolCallRequest.args` (Locked Decision #5).
     - Build a scheduler config wrapper that forces:
       - `getPolicyEngine(): PolicyEngine(nonInteractive: true)` (Locked Decision #4).
         - If `config.getPolicyEngine().isNonInteractive() === false`, create a cloned engine:
           - `rules = config.getPolicyEngine().getRules()`
           - `defaultDecision = config.getPolicyEngine().getDefaultDecision()`
           - `nonInteractive = true`
       - DO NOT override `getApprovalMode()` (Locked Decision #3). Delegate to the incoming `config.getApprovalMode()`.
       - Ensure the wrapper provides at least: `getToolRegistry`, `getSessionId`, `getEphemeralSettings`, `getExcludeTools`, `getAllowedTools`, `getApprovalMode`, `getMessageBus`, `getPolicyEngine` (and telemetry if still needed).
     - Instantiate `CoreToolScheduler` with:
       - `toolContextInteractiveMode: false`
       - `onAllToolCallsComplete` resolves the first completed call
       - `onToolCallsUpdate` FAILS FAST if any tool call reaches `awaiting_approval` (Locked Decision #10). This prevents hangs if policy config is wrong.
     - Schedule the (filtered) request and return the `CompletedToolCall`:
       - If `completedToolCalls.length !== 1`, throw (this wrapper is single-call only).
     - Always call `scheduler.dispose()` in a `finally` block (CoreToolScheduler subscribes to the message bus).
     - After completion, if emoji filtering produced `systemFeedback`, mutate the returned call’s `response.responseParts` to append the reminder to the function response output string (Locked Decision #6).
3. Update consumers to the new return type (mechanical refactor):
   - Pattern:
     - `const completed = await executeToolCall(...);`
     - `const toolResponse = completed.response;`
   - Required call sites:
     - `packages/cli/src/nonInteractiveCli.ts`
     - `packages/core/src/agents/executor.ts`
     - `packages/core/src/core/subagent.ts`
   - Update mocks/expectations in `packages/core/src/core/subagent.test.ts` and `packages/core/src/core/nonInteractiveToolExecutor.test.ts` accordingly.
4. Fix the SubAgent non-interactive config mismatch (required):
   - Current: `executeToolCall(this.toolExecutorContext, ...)` where `toolExecutorContext` is a minimal shim.
   - Change to: `executeToolCall(this.createSchedulerConfig({ interactive: false }), ...)`
     - Reason: scheduler-based execution requires `getMessageBus`, `getPolicyEngine`, `getApprovalMode`, `getAllowedTools`, etc.
     - This also preserves SubAgent tool whitelisting (createSchedulerConfig already computes `allowedTools` for non-interactive runs).
5. Keep buffered parallel execution untouched (interactive path).
6. Resolve via `onAllToolCallsComplete`; do NOT add or rely on any `getCompletedCalls()` API.

### Phase 4 (MANDATORY): Tests and Verification for Unification

**Required test updates (minimum set):**
- `packages/core/src/core/nonInteractiveToolExecutor.test.ts` (expects `CompletedToolCall` now)
- `packages/core/src/core/subagent.test.ts` (mocks + assertions)
- `packages/cli/src/nonInteractiveCli.test.ts` (if it asserts tool call recording/shape)
- `packages/core/src/agents/executor.test.ts` (if it asserts tool response shape)

**New focused test (required):**
- Add a scheduler unit test proving `toolContextInteractiveMode: false` reaches a context-aware tool that branches on `interactiveMode`.
- Add a non-interactive determinism test:
  - Construct a scheduler config with `PolicyEngine({ nonInteractive: true, defaultDecision: ASK_USER })`.
  - Schedule a tool call that would normally require confirmation.
  - Assert the run terminates deterministically (success or error) and never enters `awaiting_approval`.

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
| Return type churn (`ToolCallResponseInfo` → `CompletedToolCall`) | High | Update 3 call sites + tests in one batch; enforce via typecheck |
| Non-interactive gating/approval semantics drift | High | Preserve governance-first blocking + enforce `PolicyEngine(nonInteractive: true)`; add “never awaiting_approval” test |
| Scheduler config wrapper completeness | Medium | Enumerate required config methods in Phase 0; keep wrapper minimal + typed; always `dispose()` |
| Regression to sequential | High | Preserve forEach pattern, add benchmarks |
| Emoji filtering double-pass surprises | Medium | Preserve current “pre-filter args, tool sees filtered content” behavior; add a regression test ensuring a single `<system-reminder>` appears |
| Tool governance bypass | High | Add governance tests for both paths |
| Breaking subagent | High | Switch subagent non-interactive to `createSchedulerConfig({ interactive: false })`; test both execution modes |
| Test mock migration | Medium | Update mocks to return CompletedToolCall shape; use `completed.response` to keep old assertions mostly unchanged |

## Estimated Effort

- Phase 1 (Governance): 3-6 hours
- Phase 2 (Tool context interactiveMode): 2-4 hours
- Phase 3 (Full unification): 6-12 hours
- Phase 4 (Tests + verification): 4-10 hours
- Testing/debugging (real-world): 5-10 hours

**Total (Full unification): 20-40 hours**

## Decision

Implement Phases 1-4 in order. Do not ship a "partial" result where non-interactive execution remains on a separate executor.
