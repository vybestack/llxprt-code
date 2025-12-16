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

### Phase 1 (RECOMMENDED): Extract Shared Module (`toolGovernance.ts`)

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

### Phase 2 (OPTIONAL, but prerequisite for any full unification): Parameterize tool context `interactiveMode`

**Goal:** Allow `CoreToolScheduler` to set `ContextAwareTool.context.interactiveMode` correctly when used outside interactive UI flows.

**Required change (minimal):**
- Add an option to `CoreToolSchedulerOptions`, e.g. `toolContextInteractiveMode?: boolean` (default `true`).
- Replace hard-coded `interactiveMode: true` assignments with the option value.
- Add a focused test proving that when the option is `false`, a context-aware tool observing `interactiveMode` sees `false`.

**Acceptance criteria (must all pass):**
- Existing scheduler tests still pass (default remains `true`)
- New test for `toolContextInteractiveMode: false` passes

### Phase 3 (DEFERRED / High risk): Full Executor Unification (route non-interactive through CoreToolScheduler)

**Goal:** Reduce duplication by making `nonInteractiveToolExecutor.ts` a thin wrapper around `CoreToolScheduler` *without* changing LLxprt semantics.

**Prerequisites (MANDATORY):**
1. Phase 1 is complete (shared governance module).
2. Phase 2 is complete (scheduler can set `interactiveMode: false`).
3. Decision recorded for each item below (no "TBD"):
   - Emoji filtering: where it runs and how to avoid double filtering.
   - Tool-call history: whether to record original args or filtered args in `functionCall` parts.
   - Confirmation handling: how to handle `PolicyDecision.ASK_USER` and `shouldConfirmExecute()` in non-interactive mode.

**Implementation outline (do not deviate):**
1. Update non-interactive call sites to provide a full scheduler-capable `Config`:
   - `packages/core/src/core/subagent.ts`: pass `this.createSchedulerConfig({ interactive: false })` into the non-interactive executor wrapper.
   - `packages/cli/src/nonInteractiveCli.ts`: already has a full `Config`.
2. Add a scheduler option to avoid user-confirmation waits in non-interactive mode:
   - MUST guarantee the scheduler never publishes confirmation requests or enters `awaiting_approval` for non-interactive execution.
3. Keep buffered parallel execution untouched (interactive path).
4. Resolve via `onAllToolCallsComplete`; do NOT add or rely on any `getCompletedCalls()` API.

### Phase 4 (OPTIONAL): Update Consumers (only if Phase 3 is implemented)

**Files:**
- `packages/cli/src/nonInteractiveCli.ts`
- `packages/core/src/core/subagent.ts`

**Changes:**
- Update return type handling
- Ensure tool governance applied correctly
- Preserve streaming/live output behavior

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
- Phase 3 (Full unification): 8-16+ hours (depends on emoji/approval/args decisions)
- Phase 4 (Update consumers): 1-2 hours
- Testing: 4-8 hours

**Total (Phase 1+2 only): 7-14 hours**  
**Total (Full unification): 16-28+ hours**

## Decision

This is a significant architectural change. Options:

1. **Full Unification** - Implement all phases, achieve upstream parity
2. **Partial Unification** - Extract shared modules only (governance), keep separate executors
3. **Defer** - Document divergence, continue with separate paths

Recommendation: **Partial Unification** (Option 2) as first step, then evaluate full unification.
