# Hooks Integration Fix Plan — gmerge-0.20.2 PR #1407

**Date:** 2026-02-16
**Branch:** `remove-debug-keystroke-logging`
**Related:** [hooks-gap-analysis.md](./hooks-gap-analysis.md)
**Issue:** Hooks integration is notification-only; upstream is interceptor/modifier

---

## Problem Statement

Our hooks integration fires events but cannot act on them. All 5 trigger
functions return `Promise<void>`. All callers use `void triggerXxx(...)`. The
infrastructure layer (HookRegistry, HookPlanner, HookRunner, types.ts output
classes, hookAggregator, hookTranslator) is fully functional and already
implements all necessary output processing — the results are simply discarded at
the trigger layer.

This makes every hook use case beyond pure audit logging nonfunctional:
security blocking, request/response modification, tool filtering, context
injection, synthetic responses, and stop-execution signals.

---

## Migration Command Status

The upstream hooks migration command (`/hooks migrate --from-claude`) was added
in commit `b8c038f41` ("feat(hooks): Hooks Commands Panel, Enable/Disable, and
Migrate (#14225)"), which is **NOT an ancestor of v0.20.2**. It arrived later.

**Decision:** Defer the migration command to the cherry-pick batch that includes
`b8c038f41`. Our hookRunner already supports `$CLAUDE_PROJECT_DIR` as an
environment variable alongside `$LLXPRT_PROJECT_DIR` and `$GEMINI_PROJECT_DIR`,
so Claude Code hooks work at the execution level — the migration command just
handles settings.json conversion of event names and tool name mappings.

---

## Configuration Syntax

Our hooks configuration matches upstream v0.20.2 exactly:

```jsonc
// settings.json (project, user, or system level)
{
  "tools": {
    "enableHooks": true
  },
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "sequential": true,
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/security-scan.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "AfterTool": [ ... ],
    "BeforeModel": [ ... ],
    "AfterModel": [ ... ],
    "BeforeToolSelection": [ ... ]
  }
}
```

No syntax changes needed — only behavioral fixes.

---

## Architecture Decision: Direct Instantiation vs HookSystem/HookEventHandler

Upstream at v0.20.2 has two files we don't have:
- **hookSystem.ts** — Singleton coordinator: creates HookRegistry + Planner +
  Runner + Aggregator + HookEventHandler, initializes once
- **hookEventHandler.ts** (732 lines) — Routes all events through unified
  executeHooks(), creates base input, logs telemetry, processes common output
  fields, subscribes to MessageBus

Our triggers recreate HookRegistry + HookPlanner + HookRunner on every call.
This works but is wasteful (reinitializes registry each time).

**Decision:** Introduce `HookSystem` + `HookEventHandler` as reimplementations
of upstream. This gives us:
1. Single-initialization (create once in Config, reuse)
2. Centralized telemetry logging
3. Consistent base input creation (session_id, cwd, timestamp)
4. A clean place for MessageBus integration (we have MessageBus already)
5. Parity with upstream architecture, making future cherry-picks cleaner

The alternative (keeping direct instantiation but fixing return types) would
create more divergence from upstream over time.

---

## What Real People Actually Use Hooks For

### Claude Code Ecosystem (where hooks originated)

| Use Case | Hook Event | Prevalence | Source |
|----------|-----------|------------|--------|
| **Auto-format on write** (Prettier/ESLint) | AfterTool(write_file) | Very common | claudefa.st, karanbansal.in, datacamp |
| **Secret scanning** (block API keys in files) | BeforeTool(write_file) | Very common | paddo.dev ($30K incident story) |
| **Dangerous command blocking** (`rm -rf`, `DROP TABLE`) | BeforeTool(shell) | Very common | paddo.dev, karanbansal.in |
| **Auto-test after edit** | AfterTool(write_file) | Common | karanbansal.in, datacamp |
| **Git checkpoint before risky ops** | BeforeTool(write_file\|shell) | Common | karanbansal.in |
| **TDD enforcement** (block code without tests) | BeforeTool(write_file) | Moderate | karanbansal.in |
| **Slack/Discord notifications** | Notification | Common | datacamp |
| **File protection** (prevent .env writes) | BeforeTool(write_file) | Common | paddo.dev |
| **Auto-approve safe tools** (read-only) | BeforeTool | Moderate | claudefa.st |
| **Session context loading** | SessionStart | Moderate | claudefa.st |

### Gemini CLI Ecosystem (extends Claude Code patterns)

| Use Case | Hook Event | Source |
|----------|-----------|--------|
| **Context injection** (git log, Jira tickets) | BeforeModel | developers.googleblog.com |
| **Tool filtering** (restrict available tools) | BeforeToolSelection | geminicli.com/docs |
| **Response filtering** (PII, compliance) | AfterModel | geminicli.com/docs |
| **Model routing** (switch model per task) | BeforeModel | geminicli.com/docs |
| **Compliance logging** | All events | geminicli.com/docs, devops.com |
| **Cost control** (block expensive calls) | BeforeModel | geminicli.com/docs |
| **Synthetic caching** (return cached responses) | BeforeModel | geminicli.com/docs |

### Interactive vs Non-Interactive Considerations

| Mode | Behavior Difference |
|------|-------------------|
| **Interactive** (terminal) | BeforeTool blocking shows error in UI, user can retry. Notification hooks can trigger desktop alerts. AfterModel modifications are visible in streamed output. |
| **Non-interactive** (CI/scripts, `--prompt`) | BeforeTool blocking returns error ToolResult, logged to output. Security hooks are critical here — no human to catch mistakes. BeforeModel blocking returns synthetic or empty response. |
| **Headless** (`--headless`) | Same as non-interactive but no TTY. Hooks must work purely via stdout/stderr JSON protocol. |

Non-interactive mode is where hooks matter most — there's no human safety net.

---

## Implementation Plan

### Phase 0: Add HookSystem + HookEventHandler (Foundation)

**Files to create:**
- `packages/core/src/hooks/hookSystem.ts` — Reimplement from upstream
- `packages/core/src/hooks/hookEventHandler.ts` — Reimplement from upstream
- `packages/core/src/hooks/hookSystem.test.ts` — Tests
- `packages/core/src/hooks/hookEventHandler.test.ts` — Tests

**What these do:**
- `HookSystem`: Singleton that initializes HookRegistry once, creates
  HookEventHandler, exposes `getEventHandler()` for callers
- `HookEventHandler`: Centralized event routing — each `fire*Event()` method
  creates proper typed input, calls `executeHooks()`, aggregates results,
  logs telemetry, returns `AggregatedHookResult`
- Wire into Config: `Config` creates `HookSystem`, initializes it, exposes
  `getHookSystem()` method

**Integration with MessageBus:** The HookEventHandler subscribes to
`MessageBus.HOOK_EXECUTION_REQUEST` messages and publishes responses. This
enables callers to fire hooks either:
- Directly via `hookEventHandler.fire*Event()` (simpler)
- Via MessageBus publish/subscribe (needed when caller doesn't have direct
  reference to HookEventHandler)

**Why do this first:** Every subsequent phase depends on having a central hook
coordinator that returns results instead of discarding them.

### Phase 1: Tool Hooks — BeforeTool + AfterTool (Highest Impact)

Tool hooks are the #1 use case. Secret scanning, dangerous command blocking,
file protection, and context injection all depend on these working.

#### 1a. Rewrite `coreToolHookTriggers.ts`

**Delete the entire current implementation.** All existing `trigger*` functions
are removed — no shims, no backward-compat wrappers, no `@deprecated`. They
are internal functions with exactly two call sites. The old per-call
`new HookRegistry()` / `new HookPlanner()` / `new HookRunner()` instantiation
pattern is eliminated; `HookSystem` initializes once.

Replace with proper implementations that:
1. Accept `Config` (to get HookSystem) instead of recreating registry
2. Return typed results instead of `Promise<void>`
3. Use HookEventHandler for execution (not direct Runner calls)
4. Use upstream `fire*` naming convention (not `trigger*`)

**New signatures:**

```typescript
// BeforeTool — returns hook output so caller can check blocking
export async function fireBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined>

// AfterTool — returns hook output so caller can check stop + context
export async function fireAfterToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: { llmContent: ...; returnDisplay: ...; error: ... },
): Promise<DefaultHookOutput | undefined>

// executeToolWithHooks — lifecycle wrapper (new function)
export async function executeToolWithHooks(
  invocation: AnyToolInvocation,
  toolName: string,
  signal: AbortSignal,
  config: Config,
  liveOutputCallback?: ...,
  shellExecutionConfig?: ...,
  setPidCallback?: ...,
): Promise<ToolResult>
```

The `executeToolWithHooks()` wrapper is the upstream pattern — it wraps the
entire tool lifecycle:
1. Fire BeforeTool → if blocked, return error ToolResult
2. Execute tool
3. Fire AfterTool → if stop, return error ToolResult; if additionalContext,
   append to llmContent

#### 1b. Fix callers in `coreToolScheduler.ts`

Replace fire-and-forget calls in `launchToolExecution()`:

```typescript
// BEFORE (broken)
void triggerBeforeToolHook(this.config, toolName, args);
// ... execute tool ...
void triggerAfterToolHook(this.config, toolName, args, toolResult);

// AFTER (working)
// Use executeToolWithHooks() or inline equivalent
const toolResult = await executeToolWithHooks(
  invocation, toolName, signal, this.config,
  liveOutputCallback, undefined, setPidCallback,
);
```

#### 1c. Tests for tool hooks

Test scenarios (behavioral, not structural):

| Test | Hook Config | Expected Behavior |
|------|------------|-------------------|
| **Block write_file** | BeforeTool matcher=write_file, script echoes `{"decision":"block","reason":"Blocked by policy"}` | Tool NOT executed, ToolResult contains blocking message |
| **Allow write_file** | BeforeTool matcher=write_file, script echoes `{"decision":"allow"}` | Tool executes normally |
| **Block with exit code 2** | BeforeTool, script exits with code 2 | Tool NOT executed (exit code 2 = block) |
| **Hook failure doesn't block** | BeforeTool, script exits with code 1 | Tool STILL executes (error = warning only) |
| **AfterTool injects context** | AfterTool, script echoes `{"hookSpecificOutput":{"additionalContext":"scan clean"}}` | ToolResult.llmContent has "scan clean" appended |
| **AfterTool stop execution** | AfterTool, script echoes `{"continue":false,"stopReason":"budget exceeded"}` | ToolResult contains stop message |
| **Multiple hooks, one blocks** | Two BeforeTool hooks, one blocks | Tool blocked (OR logic — any block wins) |
| **Sequential execution order** | Two sequential hooks | Second hook receives chained input from first |
| **No hooks configured** | No BeforeTool config | Tool executes normally, no delay |
| **Hooks disabled** | `enableHooks: false` | Tool executes normally, hooks never fire |
| **Non-interactive blocking** | BeforeTool block in headless mode | Error returned in ToolResult, no TTY needed |

### Phase 2: Model Hooks — BeforeModel + AfterModel + BeforeToolSelection

#### 2a. Rewrite `geminiChatHookTriggers.ts`

**Same as Phase 1: delete the entire current implementation.** All three
`trigger*` functions are removed. The per-call registry/planner/runner
instantiation, the `{} as never` hacks, the hardcoded `finishReason: 'STOP'`,
the dead `_tools` parameter — all of it goes in the trash. Clean rewrite with
upstream `fire*` naming.

**New signatures:**

```typescript
// BeforeModel — returns blocking/modification result
export interface BeforeModelHookResult {
  blocked: boolean;
  reason?: string;
  syntheticResponse?: GenerateContentResponse;  // upstream type
  modifiedConfig?: GenerateContentConfig;
  modifiedContents?: ContentListUnion;
}

export async function fireBeforeModelHook(
  config: Config,
  request: { contents: IContent[]; tools?: unknown },
): Promise<BeforeModelHookResult>

// BeforeToolSelection — returns tool config modifications
export interface BeforeToolSelectionHookResult {
  toolConfig?: ToolConfig;
  tools?: ToolListUnion;
}

export async function fireBeforeToolSelectionHook(
  config: Config,
  request: { contents: IContent[]; tools?: unknown },
): Promise<BeforeToolSelectionHookResult>

// AfterModel — returns modified response
export interface AfterModelHookResult {
  response: IContent;  // modified or original
}

export async function fireAfterModelHook(
  config: Config,
  request: { contents: IContent[]; tools?: unknown },
  response: IContent,
): Promise<AfterModelHookResult>
```

**Data quality fixes in this phase:**
- `llm_request`: Use `hookTranslator.toHookLLMRequest()` with real IContent
  data (not `{} as never`)
- `llm_response`: Use `hookTranslator.toHookLLMResponse()` with real data
- `finishReason`: Extract from actual IContent metadata (not hardcoded `STOP`)
- `transcript_path`: Pull from Config if available, empty string otherwise
- Role mapping: Use hookTranslator's proper mapping instead of ad-hoc conversion

**AfterModel streaming decision:**
Our architecture processes IContent post-stream (after all chunks are
collected). Upstream processes per-chunk during streaming.

For v1, we use **post-stream** (our current architecture) because:
1. Our streaming layer processes IContent, not raw GenAI chunks
2. Per-chunk would require deep changes to the streaming pipeline
3. Post-stream still supports response modification, PII filtering, and stop
4. The main limitation is latency (hook runs after full response received)

Future optimization: If demand exists, add per-chunk processing later.

#### 2b. Fix callers in `geminiChat.ts`

Replace fire-and-forget calls in `streamGeneration()`:

```typescript
// BEFORE (broken)
void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);
void triggerBeforeModelHook(configForHooks, requestForHook);
void triggerAfterModelHook(configForHooks, lastResponse);

// AFTER (working)
// BeforeToolSelection — await and apply
const toolSelResult = await fireBeforeToolSelectionHook(configForHooks, requestForHook);
// Apply toolSelResult.toolConfig and toolSelResult.tools if present

// BeforeModel — await, check blocking, apply modifications
const beforeResult = await fireBeforeModelHook(configForHooks, requestForHook);
if (beforeResult.blocked) {
  // Return synthetic response or empty
}
// Apply beforeResult.modifiedConfig, modifiedContents

// AfterModel — await, use modified response
const afterResult = await fireAfterModelHook(configForHooks, requestForHook, lastResponse);
// Use afterResult.response instead of lastResponse
```

#### 2c. Tests for model hooks

| Test | Hook Config | Expected Behavior |
|------|------------|-------------------|
| **Block model call** | BeforeModel, script echoes `{"decision":"block","reason":"budget limit"}` | Model NOT called, synthetic/empty response returned |
| **Block with synthetic response** | BeforeModel, script echoes synthetic response JSON | Synthetic response returned as if model responded |
| **Modify request contents** | BeforeModel, script echoes modified messages | Modified contents sent to model |
| **Filter tools** | BeforeToolSelection, script echoes `{"hookSpecificOutput":{"toolConfig":{"mode":"ANY","allowedFunctionNames":["read_file"]}}}` | Only allowed tools available |
| **Disable all tools** | BeforeToolSelection, script echoes mode=NONE | No tools available for that call |
| **Modify response** | AfterModel, script echoes modified response | Modified response returned to caller |
| **PII redaction** | AfterModel, script replaces SSN patterns | Redacted response returned |
| **No modification pass-through** | Hooks return empty/no hookSpecificOutput | Original request/response unchanged |
| **Hook failure falls through** | BeforeModel hook fails | Model call proceeds normally |
| **Inject context** | BeforeModel, script adds system instruction | Context injected into request |
| **Non-interactive blocking** | BeforeModel block in `--prompt` mode | Empty/synthetic response, clean exit |

### Phase 3: Tests — Real-World Scenario Integration Tests

These tests simulate actual user workflows. They use real hook scripts (bash
or node) that demonstrate the patterns people actually deploy.

#### 3a. Secret Scanning Hook Test

```typescript
// Hook script: scans tool_input for patterns like AWS keys, passwords
// settings: BeforeTool matcher=write_file|replace, script=./scan-secrets.sh
// Test: Write a file containing "AKIAIOSFODNN7EXAMPLE" → BLOCKED
// Test: Write a file with normal code → ALLOWED
```

#### 3b. Dangerous Command Blocking Test

```typescript
// Hook script: blocks rm -rf /, DROP TABLE, git push --force
// settings: BeforeTool matcher=run_shell_command, script=./block-dangerous.sh
// Test: Shell command "rm -rf /" → BLOCKED
// Test: Shell command "ls -la" → ALLOWED
```

#### 3c. Auto-Format After Write Test

```typescript
// Hook script: AfterTool on write_file, injects "File auto-formatted" context
// Test: Write file → AfterTool fires → additionalContext appended to result
```

#### 3d. Context Injection Before Model Test

```typescript
// Hook script: BeforeModel, adds git log summary to request
// Test: Model call includes injected context in messages
```

#### 3e. Tool Filtering Test

```typescript
// Hook script: BeforeToolSelection, restricts to read_file only
// Test: Tool config modified to only allow read_file
```

#### 3f. Cost Control / Budget Blocking Test

```typescript
// Hook script: BeforeModel, blocks if session has exceeded N calls
// Test: First call → allowed; Nth+1 call → blocked with reason
```

#### 3g. Response Filtering Test

```typescript
// Hook script: AfterModel, redacts email addresses from response
// Test: Response containing emails → emails replaced with [REDACTED]
```

#### 3h. Non-Interactive Mode Tests

```typescript
// Same as above but run with headless/prompt mode config
// Verify: No TTY interactions, clean JSON protocol, proper exit codes
```

---

## Files Changed Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/core/src/hooks/hookSystem.ts` | CREATE | 0 |
| `packages/core/src/hooks/hookEventHandler.ts` | CREATE | 0 |
| `packages/core/src/hooks/hookSystem.test.ts` | CREATE | 0 |
| `packages/core/src/hooks/hookEventHandler.test.ts` | CREATE | 0 |
| `packages/core/src/hooks/index.ts` | UPDATE — export new classes | 0 |
| `packages/core/src/config/config.ts` | UPDATE — add getHookSystem() | 0 |
| `packages/core/src/core/coreToolHookTriggers.ts` | REWRITE — return typed results | 1 |
| `packages/core/src/core/coreToolScheduler.ts` | UPDATE — await hooks, apply results | 1 |
| `packages/core/src/core/coreToolHookTriggers.test.ts` | CREATE or UPDATE | 1 |
| `packages/core/src/core/geminiChatHookTriggers.ts` | REWRITE — return typed results | 2 |
| `packages/core/src/core/geminiChat.ts` | UPDATE — await hooks, apply results | 2 |
| `packages/core/src/core/geminiChatHookTriggers.test.ts` | CREATE or UPDATE | 2 |
| Integration test files | CREATE | 3 |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scheduler changes break tool execution | HIGH | Extensive test coverage, run full verification suite |
| `await` hooks adds latency to every call | MEDIUM | Hooks are only fired when `enableHooks: true` AND hooks are configured. Default is false. |
| AfterModel post-stream modification misses streaming use cases | LOW | Documented as v1 limitation. Per-chunk can be added later. |
| Hook script errors block execution | LOW | All hook failures are non-blocking (try/catch with fallthrough). Exit code 1 = warning, not block. Only exit code 2 = intentional block. |
| Breaking existing hook configurations | LOW | We only ADD capabilities (return values). Existing fire-and-forget audit hooks continue to work identically. |
| Test mock complexity with HookSystem | MEDIUM | Follow upstream's test patterns — mock HookPlanner/Runner/Aggregator at boundary |

---

## Execution Order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3
  ↓          ↓          ↓          ↓
Foundation  Tools     Model     Integration
(HookSystem) (block)  (modify)   (real-world)
```

Each phase is independently committable and testable. Phase 0 is pure
infrastructure (no behavioral change). Phase 1 enables the most important
use cases. Phase 2 enables advanced use cases. Phase 3 proves everything
works end-to-end with realistic scenarios.

---

## Deferred Items

| Item | Reason | When |
|------|--------|------|
| Migration command (`/hooks migrate --from-claude`) | Not in v0.20.2 (commit b8c038f41) | Cherry-pick batch that includes b8c038f41 |
| Per-chunk AfterModel processing | Architecture difference, post-stream sufficient for v1 | Future if demand |
| BeforeAgent / AfterAgent hooks | Separate event lifecycle, not in scope of 558c8ece/5bed9706 | Separate gmerge batch |
| SessionStart / SessionEnd / PreCompress hooks | Separate events, already in types.ts | Separate gmerge batch |
| Notification hooks (ToolPermission) | Partially fire-and-forget by design, needs UI integration | Separate gmerge batch |
| Plugin hooks (npm packages) | Still WIP upstream | Track upstream |
| hookTranslator response-to-IContent reverse mapping | Needed for AfterModel when hook modifies response in GenAI format | Phase 2 implementation detail |
