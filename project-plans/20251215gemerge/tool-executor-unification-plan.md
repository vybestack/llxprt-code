# Tool Executor Unification Plan

## Background

In August 2025, gemini-cli unified `CoreToolScheduler` and `nonInteractiveToolExecutor` (commit `15c62bade` - "Reuse CoreToolScheduler for nonInteractiveToolExecutor #6714"). This was silently skipped during LLxprt cherry-picking.

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

### Execution Paths in subagent.ts

1. **runInteractive()**: Uses `CoreToolScheduler` with approval workflow
2. **runNonInteractive()**: Uses `executeToolCall()` from nonInteractiveToolExecutor directly

## What Upstream Did

Upstream simplified `nonInteractiveToolExecutor.ts` to ~45 lines:

```typescript
export async function executeToolCall(
  config: Config,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal: AbortSignal,
): Promise<CompletedToolCall> {
  return new Promise<CompletedToolCall>((resolve, reject) => {
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
}
```

## Why This Was Skipped

1. **Batch 44 conflicts** in 7 core files
2. **LLxprt-specific features** not in upstream (emoji filtering, governance)
3. **Architectural divergence** - LLxprt's nonInteractiveToolExecutor is 540 lines vs upstream's 45

## Related Skipped Commits

| Commit | Date | Subject | Relationship |
|--------|------|---------|--------------|
| `15c62bade` | 2025-08-21 | Reuse CoreToolScheduler for nonInteractiveToolExecutor | Original unification |
| `9e8c7676` | 2025-10-18 | Record tool calls in non-interactive mode | Batch 44, explicitly skipped |
| `ada179f5` | 2025-10-16 | Process function calls sequentially | LLxprt implemented buffered parallel instead |

## Implementation Strategy

### Phase 1: Extract Shared Module (toolGovernance.ts)

**Goal:** Single source of truth for tool governance logic.

**New File:** `packages/core/src/core/toolGovernance.ts`

```typescript
export interface ToolGovernance {
  allowed: Set<string>;
  disabled: Set<string>;
  excluded: Set<string>;
}

export function buildToolGovernance(
  ephemeralSettings: Partial<EphemeralSettings>,
  toolNames: string[],
): ToolGovernance { ... }

export function isToolBlocked(
  toolName: string,
  governance: ToolGovernance,
): boolean { ... }
```

**Changes:**
- Extract from nonInteractiveToolExecutor.ts
- Update coreToolScheduler.ts to use shared module
- Update nonInteractiveToolExecutor.ts to use shared module

### Phase 2: Add Emoji Filtering to CoreToolScheduler

**Goal:** Bring LLxprt emoji filtering into the scheduler.

**Changes to coreToolScheduler.ts:**
- Import EmojiFilter
- Add `enableEmojiFilter` option to constructor config
- Implement filter in `attemptExecutionOfScheduledCalls()`
- Handle file modification tools specially
- Bypass for search tools

### Phase 3: Add Non-Interactive Mode to CoreToolScheduler

**Goal:** Support non-interactive execution without approvals.

**Changes to coreToolScheduler.ts:**
- Add `skipApproval: boolean` to config
- When true, auto-approve all tool calls
- Preserve telemetry/logging

### Phase 4: Simplify nonInteractiveToolExecutor.ts

**Goal:** Make it a thin wrapper like upstream, preserving LLxprt features.

```typescript
export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
): Promise<ToolCallResponseInfo> {
  const scheduler = new CoreToolScheduler({
    config: config as Config,
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
    onAllToolCallsComplete: async () => {},
    skipApproval: true,
    enableEmojiFilter: true,
  });

  return new Promise((resolve, reject) => {
    scheduler
      .schedule(toolCallRequest, abortSignal ?? new AbortController().signal)
      .then(() => {
        const completed = scheduler.getCompletedCalls();
        resolve(convertToToolCallResponseInfo(completed[0]));
      })
      .catch(reject);
  });
}
```

### Phase 5: Update Consumers

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
- Phase 2 (Emoji Filter): 4-6 hours
- Phase 3 (Non-Interactive Mode): 2-4 hours
- Phase 4 (Simplify Executor): 4-6 hours
- Phase 5 (Update Consumers): 2-4 hours
- Testing: 4-8 hours

**Total: 18-32 hours**

## Decision

This is a significant architectural change. Options:

1. **Full Unification** - Implement all phases, achieve upstream parity
2. **Partial Unification** - Extract shared modules only (governance), keep separate executors
3. **Defer** - Document divergence, continue with separate paths

Recommendation: **Partial Unification** (Option 2) as first step, then evaluate full unification.
