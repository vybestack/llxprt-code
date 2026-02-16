# Hooks System Gap Analysis — gmerge-0.20.2 PR #1407

**Date:** 2026-02-15
**Branch:** `remove-debug-keystroke-logging`
**Upstream SHAs:** `558c8ece` (tool hooks) + `5bed9706` (model hooks)
**Our Commit:** `0c876702d` (Batch 8 reimplement)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Origins: It's a Claude Code Knockoff](#origins)
3. [What Upstream Hooks Are Supposed To Do](#upstream-design)
4. [What Our Implementation Does](#our-implementation)
5. [Gap Analysis: Event-by-Event](#gap-analysis)
6. [Real-World Use Cases](#use-cases)
7. [Infrastructure Assessment](#infrastructure)
8. [Verdict](#verdict)
9. [Fix Plan](#fix-plan)

---

## Executive Summary <a name="executive-summary"></a>

Our hooks integration layer is **notification-only**. All five trigger functions return
`Promise<void>` and all callers use `void triggerXxx(...)` (fire-and-forget). The upstream
system is a full **interceptor/modifier** pattern where hooks can block, modify, and replace
both model calls and tool executions. Our infrastructure layer (HookRegistry, HookPlanner,
HookRunner, types, hookTranslator) is mostly correct and capable of producing structured
hook outputs. The gap is entirely in the **trigger functions and their callers**.

**The result:** External hook scripts can receive events and log them, but cannot:
- Block a model call or tool execution
- Modify request parameters (temperature, contents, model)
- Return a synthetic response instead of calling the LLM
- Modify tool selection (the `_tools` parameter is literal dead code)
- Modify or redact model responses
- Block tool execution based on security policy
- Inject additional context into tool results
- Override tool inputs before execution

This makes the hooks system essentially decorative for anything beyond pure
audit/logging — and even for that purpose, several input fields contain
fake/placeholder data.

---

## Origins: It's a Claude Code Knockoff <a name="origins"></a>

The Gemini CLI hooks system was explicitly designed as a Claude Code clone. From the
[upstream feature epic (#9070)](https://github.com/google-gemini/gemini-cli/issues/9070):

> "It mirrors the JSON‑over‑stdin contract, exit code semantics and matcher syntax
> used by Claude Code [...] Configuration can live at project, user, system and
> extension levels [...] Migration tooling converts existing Claude Code hooks into
> the new format, converting environment variables like `CLAUDE_PROJECT_DIR` into
> `GEMINI_PROJECT_DIR` for compatibility."

Both systems share the same architecture:
- **Communication**: JSON over stdin/stdout with external scripts
- **Exit codes**: 0 = success (parse stdout JSON), 2 = block, other = warning
- **Event lifecycle**: Before/After for tools, model calls, and sessions
- **Matchers**: Regex patterns to filter which tools trigger hooks
- **Configuration**: Hierarchical settings (project > user > system)

But Gemini CLI then **extended** Claude Code's pattern with:
- `BeforeModel` / `AfterModel` — intercept LLM requests/responses (Claude Code doesn't have this yet; [there's an open feature request](https://github.com/anthropics/claude-code/issues/21531))
- `BeforeToolSelection` — modify the tool config before the LLM decides which tools to call
- `PreCompress` — hook before context compaction
- Plugin hooks (npm packages, not just shell commands) — though this is still WIP upstream

Our hookRunner already supports `CLAUDE_PROJECT_DIR` as an environment variable alongside
`LLXPRT_PROJECT_DIR` and `GEMINI_PROJECT_DIR`, confirming the lineage.

---

## What Upstream Hooks Are Supposed To Do <a name="upstream-design"></a>

### Architecture

Upstream uses a **MessageBus** (typed request/response pattern) for hook communication.
The flow is:

1. Caller (geminiChat.ts or coreToolScheduler.ts) **awaits** a hook fire function
2. Fire function sends `HookExecutionRequest` via MessageBus
3. MessageBus routes to HookRunner, which executes external scripts
4. HookRunner collects stdout JSON, parses into `HookOutput`
5. Fire function creates typed output class (`BeforeModelHookOutput`, etc.)
6. Fire function returns a **typed result struct** to the caller
7. Caller applies modifications, handles blocking, or uses synthetic responses

### Return Types (upstream)

| Function | Returns | Key Fields |
|----------|---------|------------|
| `fireBeforeModelHook()` | `BeforeModelHookResult` | `blocked`, `reason`, `syntheticResponse`, `modifiedConfig`, `modifiedContents` |
| `fireBeforeToolSelectionHook()` | `BeforeToolSelectionHookResult` | `toolConfig`, `tools` |
| `fireAfterModelHook()` | `AfterModelHookResult` | `response` (original or modified) |
| `fireBeforeToolHook()` | `DefaultHookOutput \| undefined` | `isBlockingDecision()`, `shouldStopExecution()`, `getBlockingError()` |
| `fireAfterToolHook()` | `DefaultHookOutput \| undefined` | `shouldStopExecution()`, `getAdditionalContext()` |

### Caller Patterns (upstream)

**geminiChat.ts** (model hooks):
```typescript
// BeforeModel — AWAITED, result applied
const beforeModelResult = await fireBeforeModelHook(messageBus, { model, config, contents });
if (beforeModelResult.blocked) {
  // Return synthetic response or empty generator
  if (syntheticResponse) return (async function*() { yield syntheticResponse; })();
  return (async function*() {})();
}
if (beforeModelResult.modifiedConfig) Object.assign(config, beforeModelResult.modifiedConfig);
if (beforeModelResult.modifiedContents) contentsToUse = beforeModelResult.modifiedContents;

// BeforeToolSelection — AWAITED, result applied
const toolSelectionResult = await fireBeforeToolSelectionHook(messageBus, { model, config, contents });
if (toolSelectionResult.toolConfig) config.toolConfig = toolSelectionResult.toolConfig;
if (toolSelectionResult.tools) config.tools = toolSelectionResult.tools;

// AfterModel — AWAITED per chunk in processStreamResponse
const hookResult = await fireAfterModelHook(messageBus, originalRequest, chunk);
yield hookResult.response; // yields modified or original chunk
```

**coreToolScheduler.ts** (tool hooks):
```typescript
// Uses executeToolWithHooks() wrapper that:
// 1. Fires BeforeTool, checks blocking → returns error ToolResult if blocked
// 2. Executes tool
// 3. Fires AfterTool, checks stop execution, appends additionalContext
const toolResult = await executeToolWithHooks(invocation, toolName, signal, messageBus, hooksEnabled, ...);
```

---

## What Our Implementation Does <a name="our-implementation"></a>

### Architecture

We use **direct instantiation** of HookRegistry → HookPlanner → HookRunner
(no MessageBus). Each trigger function:
1. Creates new HookRegistry + HookPlanner + HookRunner instances
2. Gets an execution plan
3. Runs hooks (parallel or sequential)
4. **Discards all results** — returns `Promise<void>`

### Return Types (ours)

| Function | Returns | Consequence |
|----------|---------|-------------|
| `triggerBeforeModelHook()` | `Promise<void>` | Cannot block, modify, or return synthetic response |
| `triggerBeforeToolSelectionHook()` | `Promise<void>` | Cannot modify tool config; `_tools` param is dead code |
| `triggerAfterModelHook()` | `Promise<void>` | Cannot modify or redact response |
| `triggerBeforeToolHook()` | `Promise<void>` | Cannot block tool execution |
| `triggerAfterToolHook()` | `Promise<void>` | Cannot inject additional context |

### Caller Patterns (ours)

```typescript
// geminiChat.ts — ALL fire-and-forget
void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);
void triggerBeforeModelHook(configForHooks, requestForHook);
void triggerAfterModelHook(configForHooks, lastResponse);

// coreToolScheduler.ts — ALL fire-and-forget
void triggerBeforeToolHook(this.config, toolName, args);
void triggerAfterToolHook(this.config, toolName, args, toolResult);
```

### Data Quality Issues

| Field | Expected | Actual | Impact |
|-------|----------|--------|--------|
| `llm_request` in AfterModel | Full request that was sent | `{} as never` | Hook scripts get empty object |
| `llm_request` in BeforeToolSelection | Full request | `{} as never` | Hook scripts get empty object |
| `finishReason` in AfterModel | Actual finish reason from LLM | `'STOP' as const` hardcoded | Hook scripts always see STOP |
| `transcript_path` | Path to session transcript | `''` (empty string TODO) | Hook scripts can't access transcript |
| Role mapping | Upstream handles complex role mapping | `'tool'` speaker mapped to `'user'` | Lossy conversion |
| `model` field | Model name | `config.getModel()` | Correct (fixed in CodeRabbit remediation) |

---

## Gap Analysis: Event-by-Event <a name="gap-analysis"></a>

### BeforeModel

| Capability | Upstream | Ours | Status |
|------------|----------|------|--------|
| Notify hook scripts of LLM request | [OK] Full GenerateContentParameters | WARNING: Simplified IContent[] conversion | Partial |
| Block model call | [OK] `blocked: true` → return synthetic/empty | [ERROR] void return, not awaited | BROKEN |
| Return synthetic response | [OK] `syntheticResponse` field | [ERROR] void return | BROKEN |
| Modify generation config (temperature, etc.) | [OK] `modifiedConfig` applied | [ERROR] void return | BROKEN |
| Modify request contents | [OK] `modifiedContents` applied | [ERROR] void return | BROKEN |
| Non-blocking on hook failure | [OK] Returns `{ blocked: false }` | [OK] try/catch with warn | OK |

### BeforeToolSelection

| Capability | Upstream | Ours | Status |
|------------|----------|------|--------|
| Notify hook scripts | [OK] Full request passed | [ERROR] `llm_request: {} as never` | BROKEN (fake data) |
| Modify toolConfig (mode: AUTO/ANY/NONE) | [OK] Applied to config | [ERROR] void return | BROKEN |
| Filter allowed function names | [OK] `allowedFunctionNames` applied | [ERROR] void return | BROKEN |
| Modify available tools | [OK] `tools` list replaced | [ERROR] `_tools` param is dead code | BROKEN |

### AfterModel

| Capability | Upstream | Ours | Status |
|------------|----------|------|--------|
| Notify hook scripts of response | [OK] Per-chunk, full request + response | WARNING: Post-stream, fake request, hardcoded finishReason | Partial (lossy) |
| Modify/redact response chunks | [OK] `hookResult.response` yielded | [ERROR] void return | BROKEN |
| Stop agent execution | [OK] Synthetic stop response | [ERROR] void return | BROKEN |
| PII filtering | [OK] Modify each chunk | [ERROR] Not possible | BROKEN |
| Streaming granularity | [OK] Per-chunk (real-time) | [ERROR] Post-stream (after all chunks) | DEGRADED |

### BeforeTool

| Capability | Upstream | Ours | Status |
|------------|----------|------|--------|
| Notify hook scripts | [OK] tool_name + tool_input | [OK] tool_name + tool_input | OK |
| Block tool execution | [OK] Returns error ToolResult | [ERROR] void return | BROKEN |
| Stop entire agent | [OK] `shouldStopExecution()` | [ERROR] void return | BROKEN |
| Modify tool input | [OK] `hookSpecificOutput.tool_input` merges | [ERROR] void return | BROKEN |
| Security policy enforcement | [OK] deny decision → blocked | [ERROR] Not possible | BROKEN |

### AfterTool

| Capability | Upstream | Ours | Status |
|------------|----------|------|--------|
| Notify hook scripts | [OK] tool_name + input + response | [OK] tool_name + input + response | OK |
| Stop entire agent | [OK] `shouldStopExecution()` | [ERROR] void return | BROKEN |
| Inject additional context | [OK] Appended to llmContent | [ERROR] void return | BROKEN |
| Hide/replace tool output | [OK] deny → reason replaces output | [ERROR] void return | BROKEN |
| Audit logging | [OK] Full data | [OK] Full data (tool data is accurate) | OK |

---

## Real-World Use Cases <a name="use-cases"></a>

These are documented use cases from the Claude Code and Gemini CLI ecosystems.
For each, we note whether our implementation supports it.

### Security & Safety

| Use Case | Description | Ours? |
|----------|-------------|-------|
| **Secret scanning** | BeforeTool on write_file/replace — scan content for API keys, passwords, AWS credentials. Deny if found. | [ERROR] Can't block |
| **Dangerous command blocking** | BeforeTool on shell — block `rm -rf /`, `DROP TABLE`, `git push --force`. | [ERROR] Can't block |
| **File protection** | BeforeTool on write_file — prevent writes to .env, config files, production configs. | [ERROR] Can't block |
| **PII redaction** | AfterModel — redact SSNs, credit cards, personal data from model responses before display. | [ERROR] Can't modify |
| **Cost control** | BeforeModel — block expensive model calls when token budget exceeded. | [ERROR] Can't block |

### Workflow Automation

| Use Case | Description | Ours? |
|----------|-------------|-------|
| **Auto-formatting** | AfterTool on write_file — run Prettier/ESLint after every file write. | [ERROR] Can't inject context |
| **Auto-testing** | AfterTool on write_file — run tests after code changes, inject results as context. | [ERROR] Can't inject context |
| **TDD enforcement** | BeforeTool on write_file — check if test exists before allowing implementation writes. | [ERROR] Can't block |
| **Git checkpointing** | BeforeTool — create git stash before risky operations. | WARNING: Script runs but can't gate the operation |
| **Slack/Discord notifications** | Notification — alert when tool needs confirmation, agent is idle. | WARNING: Notification hooks are fire-and-forget by design, so partial |

### Context & Intelligence

| Use Case | Description | Ours? |
|----------|-------------|-------|
| **Dynamic context injection** | BeforeModel — inject recent git log, Jira tickets, local docs into request. | [ERROR] Can't modify request |
| **Model routing** | BeforeModel — dynamically switch to cheaper model for simple tasks. | [ERROR] Can't modify config |
| **Tool filtering** | BeforeToolSelection — disable tools not relevant to current task. | [ERROR] Can't modify tools |
| **Response validation** | AfterModel — validate response format, retry if malformed. | [ERROR] Can't modify response |
| **Synthetic responses (caching)** | BeforeModel — return cached response for repeated queries. | [ERROR] Can't return synthetic |

### Compliance & Audit

| Use Case | Description | Ours? |
|----------|-------------|-------|
| **Audit logging** | All events — log every LLM call and tool execution. | WARNING: Works for tool events; model event data is partially fake |
| **Usage tracking** | AfterModel — track token usage per session. | WARNING: No usageMetadata in our response format |
| **Policy enforcement** | BeforeTool — enforce org-wide security policies. | [ERROR] Can't block |

### Advanced Patterns

| Use Case | Description | Ours? |
|----------|-------------|-------|
| **"Ralph loop"** | AfterAgent — force continuous iterative execution until task is done. | N/A (AfterAgent is a separate event) |
| **Stop hook** | AfterAgent — decide whether to continue autonomous looping. | N/A (AfterAgent) |
| **Session context loading** | SessionStart — inject project-specific context at startup. | N/A (SessionStart is separate) |

---

## Infrastructure Assessment <a name="infrastructure"></a>

### What's Solid (Keep As-Is)

1. **HookRegistry** — Correct multi-source loading (project, user, system, extensions),
   precedence ordering, matcher support, enable/disable per-hook.

2. **HookPlanner** — Correct execution plan creation with sequential/parallel modes,
   matcher-based filtering for tool events.

3. **HookRunner** — Correct command execution via child_process.spawn, JSON stdin/stdout
   protocol, exit code semantics (0/2/other), timeout handling, EPIPE resilience,
   sequential input chaining, environment variable expansion
   (`$LLXPRT_PROJECT_DIR`, `$GEMINI_PROJECT_DIR`, `$CLAUDE_PROJECT_DIR`).

4. **types.ts** — Correct event names, input/output type definitions, output classes
   (`DefaultHookOutput`, `BeforeModelHookOutput`, `BeforeToolSelectionHookOutput`,
   `AfterModelHookOutput`, `BeforeToolHookOutput`) with proper methods
   (`isBlockingDecision()`, `shouldStopExecution()`, `getSyntheticResponse()`,
   `applyLLMRequestModifications()`, `applyToolConfigModifications()`,
   `getModifiedResponse()`, `getAdditionalContext()`, `getBlockingError()`).

5. **hookTranslator.ts** — Correct bidirectional translation between GenAI SDK types
   and stable hook API types (LLMRequest, LLMResponse, HookToolConfig).

### What's Broken (Trigger + Caller Layer)

1. **All trigger functions return `Promise<void>`** — They execute hooks but discard results.

2. **All callers use `void triggerXxx()`** — Fire-and-forget, no awaiting.

3. **No `executeToolWithHooks()` wrapper** — Upstream wraps the entire tool execution
   lifecycle in a function that handles BeforeTool blocking → execute → AfterTool
   context injection. We call hooks separately before and after, without using results.

4. **Fake/placeholder data** in hook inputs:
   - `llm_request: {} as never` in AfterModel and BeforeToolSelection
   - `finishReason: 'STOP' as const` hardcoded
   - `transcript_path: ''` empty string

5. **No MessageBus** — We use direct instantiation. This is an architectural choice, not
   necessarily broken, but it means we re-create HookRegistry/Planner/Runner on every
   call. Could be optimized with caching or a singleton, but functionally OK.

---

## Verdict <a name="verdict"></a>

### Is our hooks system useful at all?

**For pure audit logging of tool events: marginally yes.** BeforeTool and AfterTool
pass accurate `tool_name`, `tool_input`, and `tool_response` data. An external script
could log these to a file. But it cannot act on them.

**For model event logging: no.** The data passed to model hooks contains `{} as never`
for request fields and hardcoded `'STOP'` for finish reasons.

**For anything beyond logging: no.** Every single interception, modification, blocking,
and security use case is broken.

### Is it a "fake implementation"?

**The infrastructure is real. The integration is fake.**

- The hook output classes (`BeforeModelHookOutput`, etc.) have fully implemented methods
  for `getSyntheticResponse()`, `applyLLMRequestModifications()`, `getBlockingError()`,
  etc. These methods work correctly — they're just never called.

- The HookRunner correctly executes scripts, parses JSON output, handles exit codes,
  and returns `HookExecutionResult` with `output` fields. The results are just discarded.

- The hookTranslator correctly converts between SDK and hook API formats. It's just
  never used at the trigger layer (triggers manually construct simplified inputs instead).

### What's the minimum fix?

1. **Change trigger function signatures** to return typed results (matching upstream's
   `BeforeModelHookResult`, `BeforeToolSelectionHookResult`, `AfterModelHookResult`,
   `DefaultHookOutput | undefined`).

2. **Change callers** to `await` the trigger functions and apply results (blocking,
   modifications, context injection).

3. **Fix data quality** — pass real `llm_request`, real `finishReason`, populate
   `transcript_path`.

4. **Create `executeToolWithHooks()` wrapper** or inline the equivalent logic to
   handle BeforeTool blocking and AfterTool context injection.

5. **Wire `_tools` parameter** in BeforeToolSelection to actually pass tools data.

---

## Fix Plan <a name="fix-plan"></a>

### Scope

This fix belongs in PR #1407 since the hooks integration was part of the gmerge-0.20.2
sync. The current state is an incomplete reimplement of upstream commits 558c8ece + 5bed9706.

### Phase 1: Tool Hooks (BeforeTool + AfterTool) — Highest Impact

Tool hooks are the most valuable because they enable the #1 use case for hooks
across both Claude Code and Gemini CLI: **security policy enforcement**.

#### 1a. Fix `triggerBeforeToolHook()` → return `DefaultHookOutput | undefined`

```typescript
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined> {
  // ... existing setup ...
  // Execute hooks, collect results, merge outputs
  // Return the merged DefaultHookOutput (or undefined if no hooks)
}
```

#### 1b. Fix `triggerAfterToolHook()` → return `DefaultHookOutput | undefined`

Same pattern — return the output so callers can check `shouldStopExecution()` and
`getAdditionalContext()`.

#### 1c. Fix callers in `coreToolScheduler.ts`

Replace:
```typescript
void triggerBeforeToolHook(this.config, toolName, args);
// ... execute tool ...
void triggerAfterToolHook(this.config, toolName, args, toolResult);
```

With either:
- An `executeToolWithHooks()` wrapper (upstream pattern), OR
- Inline logic that awaits BeforeTool, checks blocking, executes, awaits AfterTool,
  applies context injection.

### Phase 2: Model Hooks (BeforeModel + AfterModel + BeforeToolSelection)

#### 2a. Fix `triggerBeforeModelHook()` → return a result with blocking/modification

Return type should include `blocked`, `syntheticResponse`, `modifiedRequest`.
Use `hookTranslator` to convert between IContent and hook API formats.

#### 2b. Fix `triggerBeforeToolSelectionHook()` → return tool config modifications

Wire the `_tools` parameter, pass real `llm_request` data, return
`{ toolConfig?, tools? }`.

#### 2c. Fix `triggerAfterModelHook()` → return modified response

This is the hardest because our stream processing is different from upstream.
Upstream processes per-chunk in `processStreamResponse`. We process post-stream.
Options:
- Keep post-stream but return modification result for the final response
- Move to per-chunk processing (bigger change, more upstream-compatible)

#### 2d. Fix callers in `geminiChat.ts`

Replace all `void trigger*()` with `await trigger*()` and apply results.

### Phase 3: Data Quality

1. Pass real `llm_request` to AfterModel and BeforeToolSelection (use hookTranslator)
2. Pass actual `finishReason` to AfterModel (from the IContent or stream data)
3. Populate `transcript_path` from Config (if available) or leave empty with a comment

### Phase 4: Tests

1. Update existing tests to verify return types
2. Add tests for blocking scenarios (BeforeTool blocks → ToolResult with error)
3. Add tests for modification scenarios (BeforeModel modifies config)
4. Add tests for context injection (AfterTool appends to llmContent)
5. Integration test: hook script that returns deny → tool blocked

### Estimated Effort

| Phase | Files Changed | Complexity | Risk |
|-------|--------------|------------|------|
| 1 (Tool hooks) | 3 (coreToolHookTriggers.ts, coreToolScheduler.ts, test) | Medium | Medium — scheduler changes |
| 2 (Model hooks) | 3 (geminiChatHookTriggers.ts, geminiChat.ts, test) | High | High — stream processing |
| 3 (Data quality) | 2 (both trigger files) | Low | Low |
| 4 (Tests) | 2 (both test files) | Medium | Low |

### Key Decisions Needed

1. **Do we implement `executeToolWithHooks()` as a wrapper (upstream pattern) or inline?**
   Upstream wraps the entire tool lifecycle in one function. We currently call hooks
   separately. Wrapper is cleaner but requires more scheduler refactoring.

2. **AfterModel: per-chunk or post-stream?**
   Our architecture processes post-stream. Moving to per-chunk is a significant change.
   Post-stream modification of the final response may be sufficient for v1.

3. **Do we need MessageBus or is direct instantiation fine?**
   Direct instantiation works. The re-creation overhead per call could be optimized with
   a cached singleton, but it's not a correctness issue.
