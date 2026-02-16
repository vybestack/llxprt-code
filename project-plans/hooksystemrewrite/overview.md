# LLxprt Code Hook System — Functional Specification

## 1. Purpose

The hook system allows users to run external scripts at specific lifecycle events during an LLxprt Code session. Scripts can observe events, block operations, modify data flowing through the agent pipeline, inject context, and stop execution. This spec defines the complete observable behavior from two perspectives: the **hook script author** writing scripts that respond to events, and the **user** configuring which scripts run and when.

---

## 2. Audience & Roles

### Hook Script Author

Writes executable programs (shell scripts, Python, Node.js, compiled binaries, etc.) that receive a JSON object on stdin, perform logic, and communicate decisions back via stdout JSON and exit codes. A script author needs to know: what data arrives for each event, what outputs are honored, and what exit code semantics apply.

### User (Hook Configurator)

Edits `settings.json` (at project, user, or system level) to register scripts against lifecycle events. A configurator needs to know: the configuration schema, how matching works, how multiple hooks compose, and how to enable/disable the system.

---

## 3. Lifecycle Events

The hook system fires at five lifecycle points. Each event has a defined trigger moment, a defined input payload, and a defined set of actions the script can take.

> **Current State vs. Target Behavior:** In the current codebase, all hook trigger functions in `coreToolHookTriggers.ts` and `geminiChatHookTriggers.ts` are called with `void` (fire-and-forget). This means:
> - **[Current]** Hook scripts can observe events and their stdin data is correct for BeforeTool/AfterTool. However, all hook outputs (blocking decisions, modified requests, injected context, synthetic responses, systemMessages) are **discarded by the callers**. No hook can actually block, modify, or inject anything.
> - **[Current]** Model hooks (`BeforeModel`, `AfterModel`, `BeforeToolSelection`) additionally suffer from fake/missing data: `geminiChatHookTriggers.ts` passes `{} as never` for `llm_request` in AfterModel and BeforeToolSelection, and manually converts `IContent` instead of using `hookTranslator` for BeforeModel.
> - **[Target]** After the rewrite, all callers `await` hook results and apply them. The action tables below describe **target behavior after the rewrite**.

### 3.1 BeforeTool

**When it fires:** Immediately before any tool executes (e.g., `write_file`, `replace`, `run_shell_command`, `read_file`).

**What the script receives (stdin):**

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current session identifier |
| `cwd` | string | Working directory |
| `timestamp` | string | ISO 8601 timestamp |
| `hook_event_name` | string | Always `"BeforeTool"` |
| `transcript_path` | string | Path to session transcript |
| `tool_name` | string | Name of the tool about to execute |
| `tool_input` | object | The arguments the tool will receive |

**What the script can do:**

| Action | How to express it | Effect on the system |
|---|---|---|
| **Block execution** | Exit code 2, OR `decision` = `"block"` or `"deny"` | The tool does NOT execute. The caller receives an error result containing the blocking `reason`. The model sees the block reason as the tool's output. |
| **Allow execution** | Exit code 0 with `decision` = `"allow"` or `"approve"`, or exit 0 with no decision field | The tool executes normally with original (or modified) inputs. |
| **Modify tool input** | Return modified `tool_input` in `hookSpecificOutput` | **[Target]** The tool executes with the modified arguments instead of the originals. **Note:** The current `HookRunner.applyHookOutputToInput()` does not implement BeforeTool input chaining — it only chains `BeforeAgent` (prompt) and `BeforeModel` (llm_request). The rewrite must add a `BeforeTool` case to `applyHookOutputToInput()` that merges `hookSpecificOutput.tool_input` into the next hook's `tool_input` field for sequential execution, and the `executeToolWithHooks` wrapper must apply the final `tool_input` modifications before calling `executeFn()`. |
| **Stop the agent** | `continue` = `false` with optional `stopReason` | The entire agent loop terminates after processing this event. The stop reason is surfaced to the user. |

**Error behavior:** If the script crashes, times out, or exits with any code other than 0 or 2, the tool executes normally (fail-open). A warning is logged.

**Matching:** Only scripts whose `matcher` regex matches the `tool_name` are invoked. Scripts with no `matcher` fire for all tools.

### 3.2 AfterTool

**When it fires:** Immediately after a tool finishes executing, before its result is sent to the model.

**What the script receives (stdin):**

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current session identifier |
| `cwd` | string | Working directory |
| `timestamp` | string | ISO 8601 timestamp |
| `hook_event_name` | string | Always `"AfterTool"` |
| `transcript_path` | string | Path to session transcript |
| `tool_name` | string | Name of the tool that executed |
| `tool_input` | object | The arguments the tool received |
| `tool_response` | object | The tool's result (content, metadata, errors) |

**What the script can do:**

| Action | How to express it | Effect on the system |
|---|---|---|
| **Inject context** | `additionalContext` field in `hookSpecificOutput` | The additional text is appended to the tool result's LLM-facing content. The model sees the original result plus the injected context. |
| **Stop the agent** | `continue` = `false` with optional `stopReason` | The agent loop terminates. The stop reason is surfaced to the user. |
| **Suppress output** | `suppressOutput` = `true` | The tool result is not displayed to the user (the model still sees it). |
| **Add system message** | `systemMessage` field | A system-level message is injected into the conversation. |

**Error behavior:** Fail-open. Script errors do not affect the tool result.

**Matching:** Same regex-against-`tool_name` logic as BeforeTool.

### 3.3 BeforeModel

**When it fires:** Before an LLM API call is made, after the request is fully assembled.

**What the script receives (stdin):**

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current session identifier |
| `cwd` | string | Working directory |
| `timestamp` | string | ISO 8601 timestamp |
| `hook_event_name` | string | Always `"BeforeModel"` |
| `transcript_path` | string | Path to session transcript |
| `llm_request` | object | The full LLM request in stable hook API format (see §5) |

**What the script can do:**

| Action | How to express it | Effect on the system |
|---|---|---|
| **Block with synthetic response** | `decision` = `"block"` or `"deny"`, AND return `llm_response` in `hookSpecificOutput` | The model is NOT called. The synthetic response is used as if the model had responded. |
| **Block without response** | `decision` = `"block"` or `"deny"`, no `llm_response` | The model is NOT called. An empty/no-op response is returned. |
| **Modify the request** | Return modified `llm_request` in `hookSpecificOutput` | The modified request is sent to the model instead of the original. This can change messages, temperature, max tokens, or other config. |
| **Inject context** | Add messages to the `llm_request.messages` array | Additional context messages are included in the model call. |
| **Stop the agent** | `continue` = `false` with optional `stopReason` | The agent loop terminates. |

**Error behavior:** Fail-open. Script errors do not prevent the model call.

**Matching:** No matcher — BeforeModel hooks fire on every model call (no tool_name to match against).

### 3.4 AfterModel

**When it fires:** After the model responds, before the response is processed by the agent.

**What the script receives (stdin):**

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current session identifier |
| `cwd` | string | Working directory |
| `timestamp` | string | ISO 8601 timestamp |
| `hook_event_name` | string | Always `"AfterModel"` |
| `transcript_path` | string | Path to session transcript |
| `llm_request` | object | The original request that was sent (stable hook API format) |
| `llm_response` | object | The model's response (stable hook API format, see §5) |

**What the script can do:**

| Action | How to express it | Effect on the system |
|---|---|---|
| **Modify the response** | Return modified `llm_response` in `hookSpecificOutput` | The modified response is used downstream instead of the original (e.g., redact PII, reformat text, alter tool calls). |
| **Replace the response** | Return a completely new `llm_response` | The replacement is used as if the model had produced it. |
| **Stop the agent** | `continue` = `false` with optional `stopReason` | The agent loop terminates. A synthetic stop response is generated containing the stop reason. |
| **Suppress output** | `suppressOutput` = `true` | The response is not displayed to the user. |

**Error behavior:** Fail-open. Script errors do not affect the model response.

**Matching:** No matcher.

### 3.5 BeforeToolSelection

**When it fires:** Before the model decides which tools to call — specifically, before the LLM request that includes tool definitions is sent.

**What the script receives (stdin):**

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Current session identifier |
| `cwd` | string | Working directory |
| `timestamp` | string | ISO 8601 timestamp |
| `hook_event_name` | string | Always `"BeforeToolSelection"` |
| `transcript_path` | string | Path to session transcript |
| `llm_request` | object | The LLM request in stable hook API format |

**What the script can do:**

| Action | How to express it | Effect on the system |
|---|---|---|
| **Restrict available tools** | Return `toolConfig` with `allowedFunctionNames` list in `hookSpecificOutput` | The model only sees the specified tools. |
| **Change tool calling mode** | Return `toolConfig` with `mode` = `"AUTO"`, `"ANY"`, or `"NONE"` | Controls whether the model must call a tool (`ANY`), may call a tool (`AUTO`), or cannot call tools (`NONE`). |
| **Disable all tools** | Return `toolConfig` with `mode` = `"NONE"` | The model cannot call any tools for this request. |
| **Stop the agent** | `continue` = `false` with optional `stopReason` | The agent loop terminates. |

**Error behavior:** Fail-open. Script errors do not affect tool selection.

**Matching:** No matcher.

---

## 4. Communication Protocol

### 4.1 Input (stdin)

Every hook script receives a single JSON object on stdin. The object always contains the base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) plus event-specific fields as documented in §3.

The JSON is written to the script's stdin in a single write, followed by EOF (stdin is closed after writing).

### 4.2 Output (stdout)

Scripts that want to influence behavior write a single JSON object to stdout. The object may contain any combination of the following common fields:

| Field | Type | Description |
|---|---|---|
| `decision` | string or null | `"block"`, `"deny"`, `"allow"`, `"approve"`, or `"ask"`. Absence or null means no decision (treated as allow). |
| `reason` | string | Human-readable reason for the decision. Shown to user and/or model when blocking. |
| `continue` | boolean | `false` to stop the agent. Default is `true` (continue). |
| `stopReason` | string | Reason for stopping (when `continue` = `false`). |
| `suppressOutput` | boolean | `true` to hide output from the user. |
| `systemMessage` | string | A system message to inject into the conversation. |
| `hookSpecificOutput` | object | Event-specific data (modified tool_input, llm_request, llm_response, toolConfig, additionalContext, etc.). |

Scripts that exit 0 with no stdout, or with non-JSON stdout, are treated as "allow with no modifications." Non-JSON stdout on exit 0 is converted to a `systemMessage` by the `HookRunner.convertPlainTextToHookOutput()` method.

Scripts that produce no output are valid — silence means "proceed normally."

> **[Current]** The `HookRunner` correctly parses stdout and converts non-JSON text to `systemMessage` in the `HookOutput`. However, because callers use `void` (fire-and-forget), the resulting `systemMessage` is never surfaced to the user or injected into the conversation. **[Target]** After the rewrite, callers consume all hook outputs including `systemMessage`, making this conversion visible end-to-end.

### 4.3 Exit Codes

| Exit Code | Meaning | System Behavior |
|---|---|---|
| **0** | Success | Parse stdout for decisions and modifications. Apply them. |
| **2** | Block / Deny | The associated operation is blocked. `stderr` content becomes the block reason if no `reason` in stdout. |
| **Any other** | Error | The hook is treated as failed. A warning is logged. The operation proceeds normally (fail-open). |

### 4.4 Stderr

Stderr output is captured for logging and diagnostics. It is never parsed for decisions. When a script exits with code 2 and provides no `reason` in stdout, stderr content is used as the blocking reason.

---

## 5. Stable Hook API Data Formats

Hook scripts receive and return LLM data in a stable, version-independent format that is decoupled from any specific SDK. This insulates scripts from SDK version changes.

> **Lossy translation caveat:** The translator (`HookTranslatorGenAIv1`) intentionally extracts only **text content** from message parts. Non-text parts (images, function calls, function responses, inline data, file data) are **filtered out** during `toHookLLMRequest()` and `toHookLLMResponse()`. Messages with no text content are dropped entirely. Additionally, safety ratings are simplified (the `blocked` field is stripped), and metadata fields beyond `usageMetadata` are not preserved. This means:
> - Hook scripts cannot inspect or modify multimodal content, function calls, or function responses.
> - If a hook returns a modified `llm_request` or `llm_response`, the round-trip through the translator will lose any non-text parts that were in the original. The `fromHookLLMRequest()` method accepts a `baseRequest` parameter to preserve non-translated fields from the original SDK request.
> - This is a deliberate v1 design decision for simplicity. Future translator versions may expose additional content types.

### 5.1 LLM Request Format

```
{
  "model": "model-name",
  "messages": [
    {
      "role": "user" | "model" | "system",
      "content": "text content or stringified structured content"
    }
  ],
  "config": {
    "temperature": number,
    "maxOutputTokens": number,
    "topP": number,
    "topK": number,
    "stopSequences": [string],
    "candidateCount": number,
    "presencePenalty": number,
    "frequencyPenalty": number
  },
  "toolConfig": {
    "mode": "AUTO" | "ANY" | "NONE",
    "allowedFunctionNames": [string]
  }
}
```

### 5.2 LLM Response Format

```
{
  "text": "convenience field with full text response",
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": ["text content"]
      },
      "finishReason": "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER",
      "index": number,
      "safetyRatings": [
        {
          "category": string,
          "probability": string
        }
      ]
    }
  ],
  "usageMetadata": {
    "promptTokenCount": number,
    "candidatesTokenCount": number,
    "totalTokenCount": number
  }
}
```

### 5.3 Tool Config Format

```
{
  "mode": "AUTO" | "ANY" | "NONE",
  "allowedFunctionNames": ["tool_name_1", "tool_name_2"]
}
```

---

## 6. Configuration

### 6.1 Enabling the Hook System

The setting `tools.enableHooks` must be set to `true`. When `false` (the default), the entire hook system is inert — no processes are spawned, no hooks are evaluated, and no latency is added to any operation.

### 6.2 Hook Configuration Schema

Hooks are configured under the `hooks` key in `settings.json`. The `hooks` object maps event names to arrays of hook groups:

```
{
  "tools": {
    "enableHooks": true
  },
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<regex>",        // optional, for tool events only
        "sequential": true,           // optional, default false
        "hooks": [
          {
            "type": "command",
            "command": "path/to/script.sh",
            "timeout": 30000          // optional, milliseconds
          }
        ]
      }
    ]
  }
}
```

**Event names:** `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`.

**Fields:**

| Field | Required | Description |
|---|---|---|
| `matcher` | No | Regex pattern tested against `tool_name`. Only meaningful for `BeforeTool` and `AfterTool`. If absent, the hook fires for all tools. |
| `sequential` | No | When `true`, hooks in this group execute one after another, with each hook's output feeding into the next hook's input. Default is `false` (parallel execution). |
| `hooks` | Yes | Array of command configurations to execute for this group. |
| `hooks[].type` | Yes | Must be `"command"` or `"plugin"`. The registry validator accepts both types (`hookRegistry.ts` validates against `['command', 'plugin']`). Plugin hooks are upstream work-in-progress — this spec focuses on `"command"` hooks. |
| `hooks[].command` | Yes | The command to execute. Receives the project directory via `$LLXPRT_PROJECT_DIR` expansion. |
| `hooks[].timeout` | No | Maximum execution time in milliseconds. Default is 60,000 (60 seconds). |

### 6.3 Configuration Precedence

Hook definitions reach the hook system from two channels:

1. **Config-provided hooks** — `config.getHooks()` returns the merged hooks from all settings levels (project, user, system). The `Config` object is responsible for merging these levels before the hook system sees them. The hook registry tags all hooks from `config.getHooks()` as `ConfigSource.Project`.
2. **Extension hooks** — Active extensions that define a `hooks` property contribute hooks at `ConfigSource.Extensions` (lowest priority).

**[Current]** The hook registry (`HookRegistry.processHooksFromConfig()`) does not distinguish project/user/system sources within `config.getHooks()` — it receives already-merged data. The `ConfigSource.User` and `ConfigSource.System` enum values exist in the registry but are not currently assigned to any entries.

**[Target]** The rewrite preserves this architecture. Source-level precedence between project/user/system is the responsibility of the `Config` layer, not the hook registry. The hook registry applies ordering by `ConfigSource` priority (Project > User > System > Extensions) when returning hooks for an event, and uses this ordering for deduplication (highest-priority instance is kept).

All matching hooks from all sources execute. Priority affects ordering and deduplication.

### 6.4 Settings Scope

The `hooks` configuration key is supported at project (`<project>/.llxprt/settings.json`), user (`~/.llxprt/settings.json`), and system scope. These are merged by the `Config` layer before reaching the hook system. Extensions contribute hooks separately at the lowest priority.

> **Implementation note:** Because `Config.getHooks()` returns pre-merged data, the hook system cannot distinguish which settings level a given hook originally came from. If per-source ordering becomes necessary, the `Config` API would need to expose per-level hook data separately.

---

## 7. Behavioral Requirements

### 7.1 Zero Overhead When Disabled

**[Target Requirement]** When `tools.enableHooks` is `false`, or when no hooks are configured, or when no hooks match the current event, the system MUST NOT:
- Spawn any child processes
- Allocate hook infrastructure objects on the hot path
- Add measurable latency to tool execution or model calls

The check for "are hooks relevant?" must be a fast-path boolean check, not an initialization sequence.

**[Current Behavior]** The current trigger implementations in `coreToolHookTriggers.ts` and `geminiChatHookTriggers.ts` violate this requirement: every hook trigger call constructs a new `HookRegistry`, calls `await hookRegistry.initialize()`, creates a new `HookPlanner`, and creates a new `HookRunner` — even when no hooks match. The rewrite addresses this by introducing `HookSystem` as a lazy singleton on `Config` that initializes infrastructure once and reuses it across calls (see technical-overview.md §3.1 and §4).

### 7.2 Fail-Open by Default

Hook script failures MUST NEVER block normal agent operation. Specifically:

- Script exits with code 1 (or any code except 0 and 2): operation proceeds, warning logged
- Script times out: process is killed, operation proceeds, warning logged
- Script crashes (signal): operation proceeds, warning logged
- Script writes invalid JSON to stdout on exit 0: treated as "allow with no modifications," stdout treated as system message
- Script writes nothing to stdout on exit 0: treated as "allow with no modifications"

The ONLY way to block an operation is an explicit block decision: exit code 2, or exit code 0 with `decision` = `"block"` or `"deny"`.

> **Exit code 2 and success semantics:** The `HookRunner` marks `success: true` only for exit code 0. Exit code 2 (intentional policy block) is marked `success: false` in the `HookExecutionResult`. The `HookAggregator` therefore reports `AggregatedHookResult.success = false` for events where a hook intentionally blocked, even though the block is desired behavior. **[Target]** Callers must not use `AggregatedHookResult.success` to determine whether to proceed — they must check `finalOutput.isBlockingDecision()` instead. The `success` field reflects hook execution health, not policy outcome. Monitoring/alerting systems should account for this: a `success: false` with `decision: 'block'|'deny'` is normal operation, not an error.

### 7.3 Multiple Hook Composition

When multiple hooks match the same event, their outputs are aggregated using event-specific strategies:

**For BeforeTool, AfterTool (OR-decision logic):**
- Any single block decision wins — if one hook blocks, the operation is blocked
- Reasons are concatenated (newline-separated) from all hooks
- System messages are concatenated
- Additional context strings are concatenated
- `suppressOutput` uses OR logic — any `true` wins
- `continue` = `false` from any hook stops the agent

> **Implementation caveat:** During OR-decision merging, the aggregator uses `DefaultHookOutput.isBlockingDecision()` which only checks the top-level `decision` field. The `BeforeToolHookOutput` compatibility fields (`hookSpecificOutput.permissionDecision`) are only checked **after** aggregation, when the merged result is wrapped via `createSpecificHookOutput()`. This means a BeforeTool hook that uses only the compatibility field `permissionDecision: "block"` (without a top-level `decision`) will be correctly detected in single-hook scenarios but may be missed during multi-hook OR merging. **[Target]** The rewrite preserves this behavior; hook scripts should use the top-level `decision` field for reliable blocking.
>
> **Best practice:** Hook scripts should **always set the top-level `decision` field** (e.g., `"block"`, `"allow"`) rather than relying on compatibility-only fields like `hookSpecificOutput.permissionDecision`. The top-level `decision` is the only field checked during multi-hook OR-merge aggregation, and is the canonical way to communicate blocking intent. The cookbook recipes in `usecaseexamples.md` all follow this pattern.

**For BeforeModel, AfterModel (field-replacement logic):**
- Later hook outputs override earlier ones for the same fields
- `hookSpecificOutput` is shallow-merged across hooks

**For BeforeToolSelection (union logic):**
- `allowedFunctionNames` from all hooks are unioned (combined)
- Mode is resolved by most-restrictive-wins: `NONE` > `ANY` > `AUTO`
- If any hook specifies `NONE`, no tools are available
- Function name lists are sorted for deterministic behavior

### 7.4 Sequential Hook Chaining

When a hook group has `sequential: true`:

1. Hooks execute in array order, one at a time
2. Each hook's output is applied to the input before passing it to the next hook
3. For BeforeTool: **[Target]** modified `tool_input` from one hook replaces the `tool_input` for the next hook (requires new case in `applyHookOutputToInput()`)
4. For BeforeModel: modified `llm_request` from one hook becomes the `llm_request` for the next hook (already implemented in `HookRunner.applyHookOutputToInput()`)
5. If any hook in the chain blocks, remaining hooks in the chain do NOT execute

> **Note:** The `HookRunner.applyHookOutputToInput()` also supports `BeforeAgent` chaining (appending `additionalContext` to the `prompt` field), but BeforeAgent is out of scope for this rewrite (see §10).

When `sequential` is `false` (the default), all hooks execute concurrently and their outputs are aggregated after all complete.

If ANY hook group for an event has `sequential: true`, all hooks for that event execute sequentially.

### 7.5 Mode Independence

All hook behaviors MUST work identically regardless of how LLxprt Code was invoked:

- Interactive mode (default TTY session)
- Non-interactive mode (`--prompt "do something"`)
- Headless mode (`--headless`)
- Piped input/output

No hook behavior may depend on TTY availability or user interaction.

### 7.6 Environment Variables

Every hook script's process environment includes:

| Variable | Value |
|---|---|
| `LLXPRT_PROJECT_DIR` | The project working directory |
| `GEMINI_PROJECT_DIR` | Same value (Gemini CLI compatibility) |
| `CLAUDE_PROJECT_DIR` | Same value (Claude Code hook compatibility) |

These are also available for `$VARIABLE` expansion in the `command` string itself.

### 7.7 Timeout Enforcement

When a script exceeds its configured timeout:

1. `SIGTERM` is sent to the script process
2. After a 5-second grace period, `SIGKILL` is sent if the process has not exited
3. The hook is treated as an error (fail-open — operation proceeds)
4. A warning is logged including the timeout duration

### 7.8 Single Initialization

The hook registry loads and validates all hook configurations once at startup. Individual event fires reuse the initialized registry and planner. Re-initialization only occurs if configuration changes at runtime.

### 7.9 Deduplication

If the same command string appears multiple times for the same event (after matcher filtering), it is executed only once. The instance from the highest-priority source is kept.

> **Implementation detail:** The deduplication key is `command:<command_string>` only — it does not include event name, matcher, timeout, or source. This means two hook entries with the same command but different timeouts or matchers are still considered duplicates. **[Target]** The rewrite preserves this dedup strategy. If finer-grained dedup is needed (e.g., distinguishing the same command with different timeouts), the `HookPlanner.getHookKey()` method would need to be extended to include those fields.

---

## 8. Decision Summary by Event

| Event | Can Block? | Can Modify Input? | Can Modify Output? | Can Stop Agent? | Can Inject Context? |
|---|---|---|---|---|---|
| BeforeTool | Yes | Yes (tool_input) | No | Yes | No |
| AfterTool | No | No | No* | Yes | Yes (additionalContext) |
| BeforeModel | Yes (with optional synthetic response) | Yes (llm_request) | No | Yes | Yes (add messages) |
| AfterModel | No | No | Yes (llm_response) | Yes | No |
| BeforeToolSelection | No | No | No | Yes | No |

*\*AfterTool "Can Modify Output? No" means the hook cannot mutate the tool's result payload directly. However, AfterTool hooks can apply **surface-level effects** that influence how the output is presented: `suppressOutput` hides the result from the user (the model still sees it), and `systemMessage` injects an additional message into the conversation. These are display/context side effects, not modifications to the `tool_response` data itself.*

Note: BeforeToolSelection modifies the tool configuration, which is neither "input" nor "output" in the traditional sense — it controls what the model is allowed to do.

### 8.1 Multi-Hook Conflict Resolution Examples

**BeforeToolSelection conflict — one hook sets NONE, another provides an allow-list:**
- Hook A: `{ toolConfig: { mode: "NONE" } }` (disable all tools)
- Hook B: `{ toolConfig: { mode: "AUTO", allowedFunctionNames: ["read_file", "write_file"] } }`
- **Result:** Mode `NONE` wins (most restrictive). `allowedFunctionNames` is empty. No tools are available. The `NONE` mode takes absolute precedence regardless of other hooks.

**BeforeModel conflict — two hooks modify the request:**
- Hook A (runs first): sets `temperature: 0.0` in `llm_request.config`
- Hook B (runs later): sets `temperature: 1.0` in `llm_request.config`
- **Result (parallel):** Hook B's fields override Hook A's (field-replacement / shallow-merge). Temperature is `1.0`. The last hook in execution order wins for each field.
- **Result (sequential):** Hook A's modified request becomes Hook B's input. Hook B sees temperature `0.0` and can choose to override or preserve it.

**BeforeTool conflict — one allows, one blocks:**
- Hook A: `{ decision: "allow" }`
- Hook B: `{ decision: "block", reason: "Policy violation" }`
- **Result:** OR-decision: any block wins. The tool is blocked with reason "Policy violation".

---

## 9. Error Handling Summary

| Scenario | Behavior |
|---|---|
| `tools.enableHooks` = `false` | No hooks fire. Zero overhead. |
| No hooks configured for event | No hooks fire. Zero overhead. |
| No hooks match (matcher doesn't match tool_name) | No hooks fire. |
| Script exits 0, valid JSON stdout | Parse and apply decisions/modifications. |
| Script exits 0, non-JSON stdout | Treat as allow; stdout becomes `systemMessage`. |
| Script exits 0, empty stdout | Treat as allow, no modifications. |
| Script exits 2 | Block the operation. Use `reason` from stdout or `stderr` as block reason. |
| Script exits 1 (or any other non-0/non-2 code) | Warn and proceed (fail-open). |
| Script times out | Kill process, warn, proceed (fail-open). |
| Script crashes (signal) | Warn and proceed (fail-open). |
| Script writes to stderr on exit 0 | Stderr is logged but does not affect behavior. |
| JSON parse error on exit 0 stdout | Treat stdout as plain text `systemMessage`, proceed. |
| Hook infrastructure error | Warn and proceed (fail-open). |

---

## 10. Scope Exclusions

This specification covers the five core lifecycle hooks listed above. The following are explicitly out of scope:

- **BeforeAgent / AfterAgent hooks** — separate scope, different lifecycle
- **SessionStart / SessionEnd hooks** — separate scope
- **PreCompress hooks** — separate scope
- **Notification hooks** — separate scope
- **Plugin hooks** (npm package-based hooks) — upstream work in progress
- **Migration tooling** (converting Claude Code `claude_code_hooks.json` to our format) — deferred
- **Per-chunk AfterModel streaming** — future optimization
- **Hook script authoring tools or SDKs** — out of scope for this spec
