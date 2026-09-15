# Hook System API Reference

This document provides complete type definitions and interface specifications for the LLxprt Code hook system.

## Configuration Schema

### Hook Configuration in settings.json

```typescript
interface SettingsHooks {
  hooks: {
    [eventName: string]: HookDefinition[];
  };
}
```

### HookDefinition

```typescript
interface HookDefinition {
  /** Pattern to match against context (e.g., tool name). Optional. */
  matcher?: string;

  /** If true, hooks in this group run sequentially. Default: false */
  sequential?: boolean;

  /** Array of hook configurations to execute */
  hooks: HookConfig[];
}
```

### HookConfig

```typescript
interface CommandHookConfig {
  /** Must be "command" */
  type: 'command';

  /** Shell command to execute. Supports ~ expansion. */
  command: string;

  /** Timeout in milliseconds. Default: 60000 (60 seconds) */
  timeout?: number;
}

type HookConfig = CommandHookConfig;
```

### Example Configuration

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_*",
        "sequential": false,
        "hooks": [
          {
            "type": "command",
            "command": "~/bin/llxprt-hooks/security.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/bin/llxprt-hooks/audit.sh"
          }
        ]
      }
    ]
  }
}
```

The `command` field accepts any path on your system (with `~` expansion). You
can keep hook scripts under your project's `.llxprt/hooks/` directory, under a
personal scripts directory, or anywhere else you choose — see
[Application Directories](../reference/application-directories.md) for where
LLxprt itself stores configuration.

## Hook Event Types

```typescript
enum HookEventName {
  BeforeTool = 'BeforeTool',
  AfterTool = 'AfterTool',
  BeforeAgent = 'BeforeAgent',
  AfterAgent = 'AfterAgent',
  BeforeModel = 'BeforeModel',
  AfterModel = 'AfterModel',
  BeforeToolSelection = 'BeforeToolSelection',
  SessionStart = 'SessionStart',
  SessionEnd = 'SessionEnd',
  PreCompress = 'PreCompress',
  Notification = 'Notification',
}
```

## Input Interfaces

### Base HookInput

All hook inputs include these fields:

```typescript
interface HookInput {
  /** Unique session identifier */
  session_id: string;

  /** Path to session transcript (may be empty) */
  transcript_path: string;

  /** Current working directory */
  cwd: string;

  /** Name of the hook event */
  hook_event_name: string;

  /** ISO 8601 timestamp */
  timestamp: string;
}
```

### BeforeToolInput

```typescript
interface BeforeToolInput extends HookInput {
  /** Name of the tool being called */
  tool_name: string;

  /** Tool parameters */
  tool_input: Record<string, unknown>;
}
```

**Example:**

```json
{
  "session_id": "abc123",
  "hook_event_name": "BeforeTool",
  "cwd": "/home/user/project",
  "timestamp": "2025-02-18T16:30:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "path": "/home/user/project/file.txt",
    "content": "Hello, world!"
  }
}
```

### AfterToolInput

```typescript
interface AfterToolInput extends HookInput {
  /** Name of the tool that was called */
  tool_name: string;

  /** Tool parameters that were used */
  tool_input: Record<string, unknown>;

  /** Result returned by the tool */
  tool_response: Record<string, unknown>;
}
```

### BeforeModelInput

```typescript
interface BeforeModelInput extends HookInput {
  /** LLM request in the v2 hook wire format */
  llm_request: HookLLMRequest;
}
```

The `llm_request` envelope is provider-neutral and versioned. The runtime
stamps `version: 2` centrally before the hook runs, so every payload a hook
receives carries the wire version explicitly:

```typescript
interface HookLLMRequest {
  /** Wire-format version (always 2, stamped by the runtime) */
  version: 2;

  /** Model the request is being sent to */
  model: string;

  /** Conversation contents in neutral IContent form */
  contents: IContent[];

  /** Tool declarations available for this request */
  tools?: ToolDeclaration[];

  /** Generation settings (temperature, maxOutputTokens, ...) */
  settings?: ModelGenerationSettings;
}
```

`IContent` is the runtime's universal, provider-agnostic content
representation — a speaker turn made of typed blocks:

```typescript
interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: ContentBlock[];
  metadata?: ContentMetadata;
}

// ContentBlock is a discriminated union on `type`; the common ones:
// { type: 'text', text: string }
// { type: 'tool_call', id: string, name: string, args: object }
// { type: 'tool_response', id: string, name: string, response: object }
// { type: 'thinking', thought: string }
```

Tool blocks restricted by the configuration may be filtered out of
`contents` before the hook sees them.

**Example:**

```json
{
  "session_id": "abc123",
  "hook_event_name": "BeforeModel",
  "cwd": "/home/user/project",
  "timestamp": "2026-09-14T16:30:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "version": 2,
    "model": "glm-5.3",
    "contents": [
      {
        "speaker": "human",
        "blocks": [{ "type": "text", "text": "Tell me a story" }]
      }
    ]
  }
}
```

### AfterModelInput

`AfterModel` fires once per streamed response chunk, with both the original
request and the current chunk:

```typescript
interface AfterModelInput extends HookInput {
  /** Original request (v2 envelope, same shape as BeforeModel) */
  llm_request: HookLLMRequest;

  /** LLM response chunk in the v2 hook wire format */
  llm_response: HookLLMResponse;
}

interface HookLLMResponse {
  /** Wire-format version (always 2, stamped by the runtime) */
  version: 2;

  /** Response content as a single neutral IContent */
  content: IContent;

  /**
   * Canonical finish reason. Present only on the terminal chunk of a turn;
   * non-terminal chunks carry none. Values: 'stop' | 'max_tokens' |
   * 'tool_calls' | 'safety' | 'refusal' | 'error' | 'other'
   */
  finishReason?:
    | 'stop'
    | 'max_tokens'
    | 'tool_calls'
    | 'safety'
    | 'refusal'
    | 'error'
    | 'other';

  /** Provider-native stop reason, retained for diagnostics */
  rawStopReason?: string;

  /** Token usage for this response */
  usage?: UsageStats;
}

interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
}
```

`finishReason` uses a fixed canonical vocabulary (lowercase) across all
providers. The provider's own value, when it differs, is preserved verbatim
in `rawStopReason` (for example `end_turn` from Anthropic, `length` from
OpenAI, `MAX_TOKENS` from Gemini).

### BeforeToolSelectionInput

```typescript
interface BeforeToolSelectionInput extends HookInput {
  /** Current LLM request (v2 envelope) */
  llm_request: HookLLMRequest;
}
```

At this phase the envelope carries `model` and the available `tools`;
`contents` is an empty array. In v1 the hook received the bare tools array
(not an object) — see the [migration table](#v1-to-v2-migration) below.

### SessionStartInput

```typescript
interface SessionStartInput extends HookInput {
  /** How the session was started */
  source: 'startup' | 'resume' | 'clear' | 'compress';
}
```

### SessionEndInput

```typescript
interface SessionEndInput extends HookInput {
  /** Why the session ended */
  reason: 'exit' | 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}
```

### BeforeAgentInput

```typescript
interface BeforeAgentInput extends HookInput {
  /** User prompt being processed */
  prompt: string;
}
```

### AfterAgentInput

```typescript
interface AfterAgentInput extends HookInput {
  /** Original user prompt */
  prompt: string;

  /** Agent's response */
  prompt_response: string;

  /** Whether a stop hook is active */
  stop_hook_active: boolean;
}
```

## Output Interfaces

### Base HookOutput

```typescript
interface HookOutput {
  /** Set to false to stop execution */
  continue?: boolean;

  /** Reason for stopping (when continue=false) */
  stopReason?: string;

  /** Hide output from user */
  suppressOutput?: boolean;

  /** Message to inject into conversation */
  systemMessage?: string;

  /** Permission decision */
  decision?: HookDecision;

  /** Explanation for decision */
  reason?: string;

  /** Event-specific output data */
  hookSpecificOutput?: Record<string, unknown>;
}

type HookDecision = 'ask' | 'block' | 'deny' | 'approve' | 'allow' | undefined;
```

### BeforeToolOutput

```typescript
interface BeforeToolOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'BeforeTool';

    /** Permission decision (compatibility) */
    permissionDecision?: HookDecision;

    /** Reason for decision (compatibility) */
    permissionDecisionReason?: string;

    /** Modified tool input (overrides original) */
    tool_input?: Record<string, unknown>;
  };
}
```

**Example - Block:**

```json
{
  "decision": "deny",
  "reason": "Writing to /etc is prohibited"
}
```

**Example - Modify Input:**

```json
{
  "decision": "allow",
  "hookSpecificOutput": {
    "tool_input": {
      "path": "/safe/path/file.txt",
      "content": "Modified content"
    }
  }
}
```

### AfterToolOutput

```typescript
interface AfterToolOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'AfterTool';

    /** Additional context to add to the response */
    additionalContext?: string;
  };
}
```

### BeforeModelOutput

```typescript
interface BeforeModelOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'BeforeModel';

    /** Partial v2 request merged onto the original (see merge semantics) */
    llm_request?: Partial<HookLLMRequest>;

    /** Synthetic response (skips actual LLM call) */
    llm_response?: HookLLMResponse;

    /** Pending-content boundary for hook-modified contents (enables compression for full-replacement hooks) */
    llm_request_boundary?: HookLLMRequestBoundary;
  };
}

interface HookLLMRequestBoundary {
  /** Schema version (currently 2) */
  version?: 2;

  /** 0-based index where the pending (new, unsent) suffix starts */
  pendingMessageStartIndex: number;

  /** Number of pending messages; defaults to the rest of the contents */
  pendingMessageCount?: number;

  /** Policy when the boundary is invalid: 'skip-compression' (default) or 'throw' */
  onInvalidBoundary?: 'skip-compression' | 'throw';
}
```

A returned `llm_request` is a partial v2 envelope merged onto the original
request with these semantics:

- `contents` (when provided as an array) **replaces** the entire conversation
- `model` (when provided as a string) **overrides** the target model
- `settings` (when provided as an object) **shallow-merges** over the
  existing settings
- absent or wrongly-typed fields leave the target untouched

There is no v1 fallback decode: a hook-returned `llm_request` is validated
shallowly against the v2 envelope, and a v1-shaped payload (for example one
using `messages`) is rejected, leaving the original request unchanged.
Because `contents` replaces the conversation wholesale, tool_call,
tool_response, and thinking blocks inside the replacement are preserved
verbatim (see the [security note](#v2-wire-security-note) below).

A returned `llm_response` short-circuits the LLM call entirely: the runtime
uses it as a synthetic response instead of calling the provider. Presence is
keyed on `content` being an object, and `finishReason`, when present, must be
from the canonical vocabulary.

`llm_request_boundary` is only relevant when the hook modifies
`llm_request.contents`. When a hook replaces or restructures the conversation,
the runtime can no longer tell which trailing contents are the new (unsent)
"pending" content versus prior history. Without that boundary, context
compression is skipped (the modified contents are sent as-is under the context
limit, and a clear error is thrown when they exceed it).

The metadata declares that the contents from `pendingMessageStartIndex` onward
(`pendingMessageCount` items, defaulting to the rest) are the pending suffix —
these are preserved verbatim through compression. Indices are interpreted over
the modified `contents` array. The prefix **before** that index is declared
history-semantics: if compression runs, that prefix is **replaced** by the
compressed real history from the history service. Hooks that need
history-side rewrites to survive compression must **not** supply this
metadata (they should accept skip-compression instead).

The boundary must describe a suffix of the modified contents:
`pendingMessageStartIndex + pendingMessageCount` must equal
`contents.length`. Otherwise the boundary is invalid and `onInvalidBoundary`
applies (`'skip-compression'` by default, or `'throw'`). Malformed
(structurally invalid) metadata is treated as invalid, not ignored — the hook
explicitly attempted to control the boundary, so differential recovery is not
used.

When `llm_request_boundary` is absent, the runtime attempts deterministic
differential analysis (comparing the pre-hook and post-hook contents) to
recover the boundary automatically. Pending-side modifications — append and
modify-pending — are recovered without any hook changes. Prepends are
detected but intentionally left unrecoverable: the prepended content lives on
the history side of the boundary and would be silently discarded if
compression rebuilt that prefix, so compression is skipped instead.

**Example - Full replacement with a boundary:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "BeforeModel",
    "llm_request": {
      "contents": [
        {
          "speaker": "human",
          "blocks": [
            { "type": "text", "text": "Summarized earlier conversation..." }
          ]
        },
        {
          "speaker": "ai",
          "blocks": [{ "type": "text", "text": "Understood." }]
        },
        {
          "speaker": "human",
          "blocks": [
            { "type": "text", "text": "The new (pending) user message" }
          ]
        }
      ]
    },
    "llm_request_boundary": {
      "version": 2,
      "pendingMessageStartIndex": 2,
      "onInvalidBoundary": "skip-compression"
    }
  }
}
```

### AfterModelOutput

```typescript
interface AfterModelOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'AfterModel';

    /** Replacement response (v2 envelope) */
    llm_response?: HookLLMResponse;
  };
}
```

A returned `llm_response` replaces the current chunk. Presence is keyed on
`content` being an object (not on `candidates`); `finishReason`, when
present, must be from the canonical vocabulary, and `usage` is carried
through as supplied.

### BeforeToolSelectionOutput

```typescript
interface BeforeToolSelectionOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'BeforeToolSelection';

    /** Tool choice override */
    toolChoice?: ToolChoice;
  };
}

interface ToolChoice {
  /** Tool selection mode */
  mode: 'auto' | 'required' | 'none';

  /** Explicitly allowed tool names */
  allowedToolNames?: string[];
}
```

Semantics:

- `mode: 'auto'` — the model decides freely which tools to call (default)
- `mode: 'required'` — the model must call a tool
- `mode: 'none'` — the model may not call any tool
- `allowedToolNames` restricts the selectable tools to the listed names

When multiple hooks return `toolChoice`, aggregation is most-restrictive-
wins: `none` beats `required` beats `auto`, and `allowedToolNames` lists are
intersected (a tool must be allowed by every hook that supplied a list to
remain selectable).

**Example - Restrict Tools:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "BeforeToolSelection",
    "toolChoice": {
      "mode": "auto",
      "allowedToolNames": [
        "read_file",
        "read_many_files",
        "glob",
        "search_file_content",
        "list_directory"
      ]
    }
  }
}
```

### v2 wire security note

Hook-supplied `contents` and `content` pass through to the provider request
with full fidelity: text, `tool_call`, `tool_response`, `thinking`, and media
blocks all survive verbatim, and validation of the inner blocks is
deliberately shallow. Hooks are a trusted extension seam — the same trust
model as the hook configuration itself. Only install hooks whose code you
have reviewed, because a BeforeModel/AfterModel hook can rewrite anything the
model sees or emits, including injecting tool calls that execute with your
permissions.

### v1 → v2 migration

The v2 wire format is breaking: the runtime no longer decodes v1 hook
payloads at all (no fallback). Hooks that returned v1 shapes are silently
ignored on the modification path — the original request/response is kept.

A note on what v1 actually emitted: the **input side was already neutral**.
Since the hook-system rewrite, hooks received `llm_request` as
`{contents, tools}` (no version, no model) — the older documentation that
described Gemini-shaped inputs (`role`/`parts`, `systemInstruction`,
`generationConfig`) was wrong about the input side. The shapes below that
changed are the output side and the version/object envelope.

| v1 (what hooks received/returned)                                            | v2                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input `llm_request`: `{contents, tools}` (no version)                        | `{version: 2, model, contents, tools?, settings?}`                                                                                                   |
| `BeforeToolSelection` input: bare `tools` array                              | Object envelope: `llm_request = {version: 2, model, contents: [], tools}`                                                                            |
| Output `llm_request.messages: [{role, content}]`                             | Output `llm_request.contents: IContent[]` (contents replace wholesale)                                                                               |
| Output `llm_response.candidates[].content.parts`                             | Output `llm_response.content: IContent` (presence keyed on `content`)                                                                                |
| `toolConfig` with `mode: 'AUTO' / 'ANY' / 'NONE'` and `allowedFunctionNames` | `toolChoice` with `mode: 'auto' / 'required' / 'none'` and `allowedToolNames`                                                                        |
| `usageMetadata: {promptTokenCount, candidatesTokenCount, totalTokenCount}`   | `usage: {promptTokens, completionTokens, totalTokens}`                                                                                               |
| `finishReason` in provider vocabulary (`STOP`, `MAX_TOKENS`, `SAFETY`, ...)  | `finishReason` canonical (`stop`, `max_tokens`, `tool_calls`, `safety`, `refusal`, `error`, `other`) + `rawStopReason` for the provider-native value |
| `llm_request_boundary.version: 1`, indices over `messages`                   | `llm_request_boundary.version: 2`, indices over `contents`                                                                                           |

## Aggregated Results

### AggregatedHookResult

Returned by the hook system after all hooks for an event complete:

```typescript
interface AggregatedHookResult {
  /** True if all hooks succeeded */
  success: boolean;

  /** Merged final output */
  finalOutput?: DefaultHookOutput;

  /** All individual hook outputs */
  allOutputs: HookOutput[];

  /** Any errors that occurred */
  errors: Error[];

  /** Total execution time in milliseconds */
  totalDuration: number;
}
```

### ProcessedHookResult

Processed result with common-output semantics applied:

```typescript
interface ProcessedHookResult {
  /** Raw aggregated result */
  aggregated: AggregatedHookResult;

  /** Should execution stop? */
  shouldStop: boolean;

  /** Reason for stopping */
  stopReason: string | undefined;

  /** System message to inject */
  systemMessage: string | undefined;

  /** Should output be suppressed? */
  suppressOutput: boolean;
}
```

## Exit Codes

| Code | Constant                       | Meaning                      |
| ---- | ------------------------------ | ---------------------------- |
| 0    | `EXIT_CODE_SUCCESS`            | Hook completed successfully  |
| 1    | `EXIT_CODE_NON_BLOCKING_ERROR` | Warning, execution continues |
| 2    | `EXIT_CODE_BLOCKING_ERROR`     | Block/deny the operation     |

## Environment Variables

Hooks receive these environment variables:

| Variable             | Description               |
| -------------------- | ------------------------- |
| `LLXPRT_PROJECT_DIR` | Current working directory |

`LLXPRT_PROJECT_DIR` is the only environment variable LLxprt Code adds to the
hook environment; the rest of the environment is inherited from the LLxprt Code
process.

Inside a hook's `command` string, two layers of expansion apply:

1. **LLxprt Code expands `$LLXPRT_PROJECT_DIR` itself.** Before invoking the
   shell, LLxprt Code replaces every `$LLXPRT_PROJECT_DIR` token with the
   current working directory, shell-escaping the value first to prevent
   injection. No other LLxprt-specific token is substituted by LLxprt Code.
2. **The platform shell then performs its normal expansion.** Because the
   resulting string is handed to a real shell, ordinary shell features such as
   `${VAR:-default}`, `$HOME`, `~`, command substitution, and quoting all work
   as they would in any shell script. For example,
   `${LLXPRT_CONFIG_HOME:-$HOME/.config/llxprt-code}` resolves correctly inside
   a `command` because the shell evaluates it at run time.

## MessageBus Contracts

For advanced integration via the internal message bus:

### HookExecutionRequest

```typescript
interface HookExecutionRequest {
  /** Correlation ID for tracking */
  correlationId: string;

  /** Event to fire */
  eventName: HookEventName;

  /** Event input data */
  input: HookInput;
}
```

### HookExecutionResponse

```typescript
interface HookExecutionResponse {
  /** Matches request correlationId */
  correlationId: string;

  /** Whether execution succeeded */
  success: boolean;

  /** Result if successful */
  output?: AggregatedHookResult;

  /** Error if failed */
  error?: {
    code: string;
    message: string;
  };
}
```

### Channel Names

| Channel                   | Direction | Description            |
| ------------------------- | --------- | ---------------------- |
| `HOOK_EXECUTION_REQUEST`  | Incoming  | Trigger hook execution |
| `HOOK_EXECUTION_RESPONSE` | Outgoing  | Hook execution result  |

## Hook Output Classes

The hook system provides output classes with utility methods:

### DefaultHookOutput

```typescript
class DefaultHookOutput implements HookOutput {
  /** Check if this represents a blocking decision */
  isBlockingDecision(): boolean;

  /** Check if execution should stop */
  shouldStopExecution(): boolean;

  /** Get the effective reason for blocking/stopping */
  getEffectiveReason(): string;

  /** Get additional context if provided */
  getAdditionalContext(): string | undefined;

  /** Get blocking error info */
  getBlockingError(): { blocked: boolean; reason: string };
}
```

### BeforeToolHookOutput

```typescript
class BeforeToolHookOutput extends DefaultHookOutput {
  /** Get modified tool input if provided */
  getModifiedToolInput(): Record<string, unknown> | undefined;
}
```

### BeforeModelHookOutput

```typescript
class BeforeModelHookOutput extends DefaultHookOutput {
  /** Get synthetic response if provided (v2 envelope) */
  getSyntheticResponse(): HookLLMResponse | undefined;

  /** Apply modifications to the LLM request (v2 merge semantics) */
  applyLLMRequestModifications(target: HookLLMRequest): HookLLMRequest;

  /** Parse llm_request_boundary metadata (discriminated result) */
  getLLMRequestBoundaryResult(): HookLLMRequestBoundaryParseResult;
}
```

### BeforeToolSelectionHookOutput

```typescript
class BeforeToolSelectionHookOutput extends DefaultHookOutput {
  /** Apply tool choice modifications */
  applyToolChoiceModifications(target: { tools?: unknown[] }): {
    toolChoice?: ToolChoice;
    tools?: unknown[];
  };
}
```

### AfterModelHookOutput

```typescript
class AfterModelHookOutput extends DefaultHookOutput {
  /** Get modified response if provided (v2 envelope) */
  getModifiedResponse(): HookLLMResponse | undefined;
}
```

## Aggregation Strategies

### OR Decision Logic (BeforeTool, AfterTool)

- Any `block` or `deny` decision → aggregated result is blocked
- Messages (`reason`, `systemMessage`) are concatenated
- `suppressOutput` uses OR logic (any true wins)
- Default decision is `allow` if no blocking

### Field Replacement (BeforeModel, AfterModel)

- Later hook outputs override earlier ones
- `hookSpecificOutput` fields are merged (last write wins)

### Tool Selection (BeforeToolSelection)

- `allowedToolNames` lists are intersected across all hooks (a tool must be
  allowed by every hook that supplied a list to remain selectable)
- `none` mode wins if any hook uses it
- Otherwise `required` if any hook uses it, else `auto`
- Results are sorted for deterministic behavior
