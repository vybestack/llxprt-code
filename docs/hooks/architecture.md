# Hook System Architecture

This guide explains how the LLxprt Code hook system works internally, which helps you write more effective hooks and debug issues.

## System Overview

The hook system consists of four main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        HookSystem                                │
│  (Owns all components, provides lazy initialization)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  HookRegistry │   │  HookPlanner  │   │ HookRunner    │
│  (Stores all  │   │  (Selects     │   │ (Executes     │
│   configured  │──▶│   matching    │──▶│  scripts via  │
│   hooks)      │   │   hooks)      │   │  subprocess)  │
└───────────────┘   └───────────────┘   └───────┬───────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │HookAggregator │
                                        │ (Merges       │
                                        │  results)     │
                                        └───────────────┘
```

### Component Responsibilities

| Component          | Responsibility                                                     |
| ------------------ | ------------------------------------------------------------------ |
| **HookSystem**     | Entry point. Manages initialization, owns all sub-components       |
| **HookRegistry**   | Stores hook configurations, provides lookup by event               |
| **HookPlanner**    | Creates execution plans, applies matchers, handles deduplication   |
| **HookRunner**     | Spawns subprocess, sends JSON to stdin, reads stdout/stderr        |
| **HookAggregator** | Merges outputs from multiple hooks using event-specific strategies |

## Execution Flow

When a hook event fires, here's what happens:

### 1. Event Trigger

```typescript
// Example: Tool execution triggers BeforeTool
const result = await hookSystem
  .getEventHandler()
  .fireBeforeToolEvent('write_file', { path: '/etc/passwd', content: '...' });
```

### 2. Planning Phase

The `HookPlanner` creates an execution plan:

1. Look up all hooks registered for the event (`BeforeTool`)
2. Apply matchers to filter hooks (e.g., `matcher: "write_*"` only runs for write tools)
3. Sort by priority (Project > Extensions)
4. Determine execution mode (parallel or sequential)

### 3. Execution Phase

The `HookRunner` executes each hook:

1. Build the input payload (JSON)
2. Spawn the hook command as a subprocess
3. Write input JSON to stdin
4. Read stdout and stderr
5. Wait for exit (with timeout)
6. Parse JSON output or convert plain text

### 4. Aggregation Phase

The `HookAggregator` combines results using event-specific strategies:

| Event Type             | Aggregation Strategy                                       |
| ---------------------- | ---------------------------------------------------------- |
| BeforeTool/AfterTool   | OR logic: any "block" wins                                 |
| BeforeModel/AfterModel | Last write wins (field replacement)                        |
| BeforeToolSelection    | UNION of allowed tools; NONE mode wins if any hook uses it |

## Hook Input Format

Every hook receives a JSON object on stdin with these base fields:

```typescript
interface HookInput {
  session_id: string; // Unique session identifier
  hook_event_name: string; // e.g., "BeforeTool"
  cwd: string; // Current working directory
  timestamp: string; // ISO 8601 timestamp
  transcript_path: string; // Path to session transcript (if any)
}
```

Event-specific fields are added based on the event type. See [API Reference](./api-reference.md) for complete schemas.

## Hook Output Format

Hooks return JSON on stdout with these common fields:

```typescript
interface HookOutput {
  // Execution control
  continue?: boolean; // false = stop execution
  stopReason?: string; // Reason for stopping

  // Decision (for permission-based hooks)
  decision?: 'allow' | 'deny' | 'block' | 'ask' | 'approve';
  reason?: string; // Explanation for decision

  // Output control
  suppressOutput?: boolean; // true = hide from user
  systemMessage?: string; // Message to inject

  // Event-specific output
  hookSpecificOutput?: Record<string, unknown>;
}
```

## Exit Code Semantics

| Exit Code | Meaning            | Behavior                            |
| --------- | ------------------ | ----------------------------------- |
| 0         | Success            | Hook output is processed normally   |
| 1         | Non-blocking error | Warning logged, execution continues |
| 2         | Blocking error     | Operation is blocked/denied         |

### Plain Text Fallback

If your hook outputs plain text instead of JSON:

- **Exit 0**: Text becomes `systemMessage` with `decision: "allow"`
- **Exit 1**: Text becomes warning message
- **Exit 2**: Text becomes blocking reason with `decision: "deny"`

Example:

```bash
#!/bin/bash
# This works even without JSON!
echo "Access denied: sensitive directory"
exit 2
```

## Matchers

Matchers filter which hooks run for which operations. The matcher string is compared against context values.

### Tool Name Matching

For `BeforeTool` and `AfterTool` events:

```json
{
  "matcher": "write_*",
  "hooks": [...]
}
```

This hook only runs for tools starting with `write_` (like `write_file`).

### No Matcher (Default)

If no matcher is specified, the hook runs for all occurrences of that event:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "./log-all-tools.sh"
    }
  ]
}
```

## Sequential vs Parallel Execution

By default, hooks for an event run in parallel. Set `sequential: true` for ordered execution:

```json
{
  "sequential": true,
  "hooks": [
    { "type": "command", "command": "./hook1.sh" },
    { "type": "command", "command": "./hook2.sh" }
  ]
}
```

When sequential:

- Hooks run in order
- Each hook can see the output of previous hooks
- One hook's output can modify the input for the next

**Note**: If _any_ hook group for an event sets `sequential: true`, all hooks for that event run sequentially.

## Timeout Handling

Each hook has a default timeout of 60 seconds. Configure per-hook:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "./slow-hook.sh",
      "timeout": 120000
    }
  ]
}
```

When a hook times out:

1. SIGTERM is sent
2. After 5 seconds, SIGKILL if still running
3. Hook result is marked as failed
4. Execution continues (timeout is not blocking by default)

## Error Handling

The hook system is designed to fail gracefully:

### Hook Script Errors

- Non-zero exit (except 2): Logged as warning, execution continues
- Exit code 2: Treated as intentional blocking
- Unparseable output: Converted to plain text response

### Infrastructure Errors

- Hook not found: Logged, skipped
- Spawn failure: Logged, skipped
- Aggregation error: Returns empty success result

**Philosophy**: A broken hook should not break the entire agent. Errors are logged but don't crash execution.

## Environment Variables

Hooks receive these environment variables:

| Variable             | Description               |
| -------------------- | ------------------------- |
| `LLXPRT_PROJECT_DIR` | Current working directory |
| `GEMINI_PROJECT_DIR` | Alias (compatibility)     |
| `CLAUDE_PROJECT_DIR` | Alias (compatibility)     |

Plus all parent process environment variables.

## MessageBus Integration

Advanced: The hook system can receive events via the internal MessageBus:

```typescript
// Channel: HOOK_EXECUTION_REQUEST
{
  type: 'HOOK_EXECUTION_REQUEST',
  payload: {
    correlationId: string;
    eventName: HookEventName;
    input: HookInput;
  }
}

// Response: HOOK_EXECUTION_RESPONSE
{
  type: 'HOOK_EXECUTION_RESPONSE',
  payload: {
    correlationId: string;
    success: boolean;
    output?: AggregatedHookResult;
    error?: { code: string; message: string };
  }
}
```

This is primarily for internal use and extension integration.

## Debugging Hooks

Enable debug logging to see hook execution:

```bash
DEBUG=llxprt:core:hooks:* llxprt
```

This shows:

- Which hooks are selected for each event
- Input/output for each hook
- Execution timing
- Aggregation results

## Performance Considerations

1. **Keep hooks fast**: The entire hook phase blocks the agent until all hooks complete
2. **Use matchers**: Don't run hooks for events you don't care about
3. **Prefer parallel**: Sequential is slower
4. **Set appropriate timeouts**: Don't let slow hooks block execution
5. **Exit early**: If you can determine the result quickly, exit immediately
