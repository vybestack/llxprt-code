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
            "command": "~/.llxprt/hooks/security.sh",
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
            "command": "~/.llxprt/hooks/audit.sh"
          }
        ]
      }
    ]
  }
}
```

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
  /** LLM request in simplified hook format */
  llm_request: LLMRequest;
}

interface LLMRequest {
  model?: string;
  contents?: Array<{
    role: 'user' | 'model';
    parts: Array<string | { text: string }>;
  }>;
  systemInstruction?: {
    role: 'system';
    parts: Array<string | { text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
}
```

### AfterModelInput

```typescript
interface AfterModelInput extends HookInput {
  /** Original request */
  llm_request: LLMRequest;

  /** LLM response */
  llm_response: LLMResponse;
}

interface LLMResponse {
  candidates?: Array<{
    content: {
      role: 'model';
      parts: Array<string | { text: string }>;
    };
    finishReason?: string;
  }>;
}
```

### BeforeToolSelectionInput

```typescript
interface BeforeToolSelectionInput extends HookInput {
  /** Current LLM request */
  llm_request: LLMRequest;
}
```

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

    /** Modified LLM request (merged with original) */
    llm_request?: Partial<LLMRequest>;

    /** Synthetic response (skips actual LLM call) */
    llm_response?: LLMResponse;

    /** Pending-content boundary for hook-modified contents (enables compression for full-replacement hooks) */
    llm_request_boundary?: HookLLMRequestBoundary;
  };
}

interface HookLLMRequestBoundary {
  /** Schema version (currently 1) */
  version?: 1;

  /** 0-based index where the pending (new, unsent) suffix starts */
  pendingMessageStartIndex: number;

  /** Number of pending messages; defaults to the rest of the messages */
  pendingMessageCount?: number;

  /** Policy when the boundary is invalid: 'skip-compression' (default) or 'throw' */
  onInvalidBoundary?: 'skip-compression' | 'throw';
}
```

`llm_request_boundary` is only relevant when the hook modifies
`llm_request.messages`. When a hook replaces or restructures the conversation,
the runtime can no longer tell which trailing messages are the new (unsent)
"pending" content versus prior history. Without that boundary, context
compression is skipped (the modified contents are sent as-is under the context
limit, and a clear error is thrown when they exceed it).

The metadata declares that the messages from `pendingMessageStartIndex` onward
(`pendingMessageCount` items, defaulting to the rest) are the pending suffix —
these are preserved verbatim through compression. The prefix **before** that
index is declared history-semantics: if compression runs, that prefix is
**replaced** by the compressed real history from the history service. Hooks
that need history-side rewrites to survive compression must **not** supply this
metadata (they should accept skip-compression instead).

The boundary must describe a suffix of the modified messages:
`pendingMessageStartIndex + pendingMessageCount` must equal `messages.length`.
Otherwise the boundary is invalid and `onInvalidBoundary` applies
(`'skip-compression'` by default, or `'throw'`). Malformed (structurally
invalid) metadata is treated as invalid, not ignored — the hook explicitly
attempted to control the boundary, so differential recovery is not used.

When `llm_request_boundary` is absent, the runtime attempts deterministic
differential analysis (comparing the pre-hook and post-hook messages) to
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
      "messages": [
        { "role": "user", "content": "Summarized earlier conversation..." },
        { "role": "model", "content": "Understood." },
        { "role": "user", "content": "The new (pending) user message" }
      ]
    },
    "llm_request_boundary": {
      "version": 1,
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

    /** Modified response */
    llm_response?: Partial<LLMResponse>;
  };
}
```

### BeforeToolSelectionOutput

```typescript
interface BeforeToolSelectionOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'BeforeToolSelection';

    /** Tool configuration */
    toolConfig?: HookToolConfig;
  };
}

interface HookToolConfig {
  /** Tool selection mode */
  mode?: 'AUTO' | 'ANY' | 'NONE';

  /** Explicitly allowed function names */
  allowedFunctionNames?: string[];
}
```

**Example - Restrict Tools:**

```json
{
  "hookSpecificOutput": {
    "toolConfig": {
      "mode": "AUTO",
      "allowedFunctionNames": ["read_file", "list_directory", "glob"]
    }
  }
}
```

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
| `GEMINI_PROJECT_DIR` | Alias for compatibility   |
| `CLAUDE_PROJECT_DIR` | Alias for compatibility   |

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
  /** Get synthetic response if provided */
  getSyntheticResponse(): GenerateContentResponse | undefined;

  /** Apply modifications to LLM request */
  applyLLMRequestModifications(
    target: GenerateContentParameters,
  ): GenerateContentParameters;
}
```

### BeforeToolSelectionHookOutput

```typescript
class BeforeToolSelectionHookOutput extends DefaultHookOutput {
  /** Apply tool configuration modifications */
  applyToolConfigModifications(target: {
    toolConfig?: GenAIToolConfig;
    tools?: ToolListUnion;
  }): {
    toolConfig?: GenAIToolConfig;
    tools?: ToolListUnion;
  };
}
```

### AfterModelHookOutput

```typescript
class AfterModelHookOutput extends DefaultHookOutput {
  /** Get modified response if provided */
  getModifiedResponse(): GenerateContentResponse | undefined;
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

- `allowedFunctionNames` are unioned across all hooks
- `NONE` mode wins if any hook uses it
- Otherwise `ANY` if any hook uses it, else `AUTO`
- Results are sorted for deterministic behavior
