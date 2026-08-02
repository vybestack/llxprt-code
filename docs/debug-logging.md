# Debug Logging System

The LLxprt debug logging system provides powerful debugging capabilities with flexible configuration and namespace-based filtering.

## Quick Start

### Enable Debug Logging

```bash
# Enable all debug logging
llxprt --debug

# Enable specific namespaces
llxprt --debug llxprt:openai:*
llxprt --debug llxprt:anthropic:provider

# Multiple namespaces
llxprt --debug llxprt:openai:*,llxprt:gemini:*
```

### Using Debug Commands

Once in the interactive session, use these commands:

- `/debug enable` - Enable debug logging for all namespaces
- `/debug disable` - Disable all debug logging
- `/debug status` - Show current debug configuration
- `/debug level <level>` - Set logging level (verbose, debug, info, error)
- `/debug output <target>` - Set output target (file, stderr, both)
- `/debug persist` - Save current debug settings to user config

## Namespace Conventions

Debug namespaces follow a hierarchical pattern: `llxprt:[component]:[subcomponent]`

### Available Namespaces

| Namespace                   | Description                               |
| --------------------------- | ----------------------------------------- |
| `llxprt:openai:provider`    | OpenAI provider operations                |
| `llxprt:openai:streaming`   | OpenAI streaming responses                |
| `llxprt:anthropic:provider` | Anthropic provider operations             |
| `llxprt:gemini:provider`    | Gemini provider operations                |
| `llxprt:debug:*`            | Debug system internals                    |
| `llxprt:*`                  | All LLxprt debug output                   |
| `*`                         | All debug output (including dependencies) |

### Pattern Matching

- **Exact match**: `llxprt:openai:provider` - Only that specific namespace
- **Wildcard suffix**: `llxprt:openai:*` - All OpenAI-related logging
- **Wildcard prefix**: `*:provider` - All provider logging across components
- **Wildcard middle**: `llxprt:*:provider` - All provider logging in llxprt
- **Multiple wildcards**: `llxprt:*:*` - All llxprt logging with any subcomponents
- **Wildcard all**: `*` - Everything

Examples:

- `llxprt:*:provider` matches `llxprt:openai:provider`, `llxprt:anthropic:provider`
- `llxprt:*:streaming` matches `llxprt:openai:streaming`, `llxprt:gemini:streaming`
- `*:debug` matches any namespace ending with `:debug`

## Configuration

### Configuration Hierarchy

Debug settings are resolved in priority order (highest to lowest):

1. **CLI arguments** - `--debug` flag
2. **Environment variables** - `DEBUG`, `LLXPRT_DEBUG`
3. **User config** - your user [settings.json](./reference/application-directories.md) in LLxprt's config directory
4. **Project config** - `.llxprt/config.json`
5. **Default config** - Built-in defaults

### Environment Variables

```bash
# Enable debug for specific namespaces
export DEBUG=llxprt:openai:*
export LLXPRT_DEBUG=llxprt:*

# Control debug settings
export DEBUG_ENABLED=true
export DEBUG_LEVEL=verbose
```

### User Configuration

Edit your [settings.json](./reference/application-directories.md):

```json
{
  "debug": {
    "enabled": true,
    "namespaces": ["llxprt:openai:*", "llxprt:anthropic:*"],
    "level": "debug",
    "output": {
      "target": "file",
      "directory": "<log>/debug"
    },
    "lazyEvaluation": true,
    "redactPatterns": ["apiKey", "token", "password", "secret"]
  }
}
```

The `output.directory` above uses LLxprt's [log/state directory](./reference/application-directories.md) (`<log>/debug`, overridable via `LLXPRT_LOG_HOME`). If you omit `directory`, the platform default is used automatically.

### Project Configuration

Create `.llxprt/config.json` in your project root:

```json
{
  "debug": {
    "enabled": true,
    "namespaces": ["llxprt:*"],
    "level": "verbose"
  }
}
```

## Output Targets

### File Output (Default)

Debug logs are written to `<log>/debug/` (see [Application Directories](./reference/application-directories.md)) in JSONL format:

- **One file per run**, named by process id: `llxprt-debug-<PID>.jsonl`
- Child processes inherit the same file when `LLXPRT_DEBUG` is set
- Each line is a JSON object with timestamp, namespace, level, and message

Example log entry:

```json
{
  "timestamp": "2025-01-21T10:30:45.123Z",
  "namespace": "llxprt:openai:provider",
  "level": "debug",
  "message": "Sending request to OpenAI API",
  "args": ["gpt-5.5"],
  "runId": "12345",
  "pid": 12345
}
```

### Stderr Output

Debug output can be sent to stderr (terminal) instead of or in addition to files:

```bash
# Output to stderr only
/debug output stderr

# Output to both file and stderr
/debug output both
```

## Logging Levels

| Level     | Description                                |
| --------- | ------------------------------------------ |
| `verbose` | All debug output including detailed traces |
| `debug`   | Debug messages and above                   |
| `info`    | Informational messages and above           |
| `error`   | Only error messages                        |

## Performance

### Near-Zero Overhead When Disabled

When debugging is disabled, the logging methods return immediately without
formatting, redacting, or writing anything. To get that benefit for a message
that is expensive to build, pass it as a **callback** rather than a pre-built
string:

```ts
// The string is built every call — even when logging is disabled.
logger.debug(`result: ${expensiveComputation()}`);

// The callback runs only when logging is enabled for this namespace.
logger.debug(() => `result: ${expensiveComputation()}`);
```

A plain argument is evaluated by your code **before** the logger is entered, so
its cost is paid regardless of whether logging is on. The callback form is what
defers that work.

### Sensitive Data Redaction

Sensitive information is automatically redacted from logs:

- API keys
- Tokens
- Passwords
- Secrets

Custom redaction patterns can be added in configuration.

## Viewing Debug Logs

### In Interactive Mode

Debug output appears in the debug console (Ctrl+O) when using stderr output.

### File Logs

```bash
# View the current run log (debug logs live under <log>/debug/ — see Application Directories)
cat "${LLXPRT_LOG_HOME:-$HOME/.local/state/llxprt-code}/debug/llxprt-debug-<PID>.jsonl"

# Pretty print with jq
cat "${LLXPRT_LOG_HOME:-$HOME/.local/state/llxprt-code}/debug/llxprt-debug-"*.jsonl | jq '.'

# Filter by namespace
cat "${LLXPRT_LOG_HOME:-$HOME/.local/state/llxprt-code}/debug/llxprt-debug-"*.jsonl | jq 'select(.namespace | startswith("llxprt:openai"))'

# Follow log in real-time
tail -f "${LLXPRT_LOG_HOME:-$HOME/.local/state/llxprt-code}/debug/llxprt-debug-<PID>.jsonl" | jq '.'
```

## Tracing Message Order (Chronology Markers)

Every item that enters the conversation history is stamped with a client-side
chronology marker, so you can reconstruct the exact order of events even when
requests are retried or tool calls interleave with ordinary messages.

Each marker carries:

| Field        | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `seq`        | Monotonic insertion ordinal. Never reused, including after `/clear`. |
| `userTurn`   | Which user turn the item belongs to (`0` before the first prompt).   |
| `step`       | Position within that user turn, so tool round-trips stay ordered.    |
| `recordedAt` | Epoch milliseconds when the item entered history.                    |

Markers are **client-side only**. They are never included in a provider request
payload, and they are excluded from token estimation so they cannot affect when
compression triggers.

### In debug logs

Chronology appears on every "Adding content to history" record:

```bash
LLXPRT_DEBUG=llxprt:history:service llxprt

cat "${LLXPRT_LOG_HOME:-$HOME/.local/state/llxprt-code}/debug/llxprt-debug-"*.jsonl \
  | jq 'select(.namespace == "llxprt:history:service") | .args[1].chronology'
```

### In context dumps

`/dumpcontext now` writes the full ordered trace into the request dump file
under a top-level `chronology` key, as a sibling of `request`:

```bash
jq '.chronology' ~/.cache/llxprt-code/dumps/<baseId>-request.json
```

The trace lists structural descriptors only — speaker, block types, tool call
and tool response IDs — and never message text, tool parameters, or tool
results, so it is safe to attach to a bug report. `request.body` stays exactly
what the provider receives.

### After compression

Compression destroys history items, which shows up as a gap in the `seq`
series. When a summary replaces those items, the summary records the span it
stands in for:

```json
{ "chronologyReplaced": { "fromSeq": 1, "toSeq": 42, "itemCount": 42 } }
```

## Examples

### Debugging Provider Issues

```bash
# Enable all provider debug logging
llxprt --debug llxprt:*:provider

# In session, check status
/debug status

# Change level to verbose for more detail
/debug level verbose

# Save settings for next time
/debug persist
```

### Debugging Specific Components

```bash
# Debug only OpenAI streaming
export DEBUG=llxprt:openai:streaming
llxprt

# Debug multiple components
export DEBUG=llxprt:openai:*,llxprt:anthropic:*
llxprt
```

### Temporary Debug Session

```bash
# Enable debug just for this session
llxprt --debug llxprt:*

# In session, disable when done
/debug disable
```

## Programmatic API

If you are writing an extension, a hook, or embedding LLxprt Code, you can log
to the same debug system through the `DebugLogger` class. It is exported from
the public package entry point:

```typescript
import { DebugLogger } from '@vybestack/llxprt-code-core';
```

### Creating a logger

Pass a namespace to the constructor. Follow the `llxprt:[component]:[subcomponent]`
convention so your output is easy to filter alongside the built-in namespaces:

```typescript
const logger = new DebugLogger('llxprt:myextension:feature');
```

You can also use the factory, which returns a single shared instance per
namespace:

```typescript
const logger = DebugLogger.getLogger('llxprt:myextension:feature');
```

`getLogger` caches one logger per namespace, so repeated calls with the same
namespace return the same object. Cached instances live until the process
exits; call `DebugLogger.disposeAll()` if you need to release them sooner.

### Logging methods

Every method accepts either a plain string or a callback that returns a
string, followed by any number of extra arguments that are attached to the log
entry:

| Method  | Level   | Notes                                                |
| ------- | ------- | ---------------------------------------------------- |
| `log`   | `log`   | Always emitted when the namespace is enabled.        |
| `debug` | `debug` | Suppressed when the logging level is set to `error`. |
| `warn`  | `warn`  | Warning level.                                       |
| `error` | `error` | Error level.                                         |

```typescript
// Plain string
logger.log('Processing request');

// Extra arguments are stored on the log entry
logger.log('Processing request', requestId, userId);

// Callback — runs only when this namespace is enabled
logger.debug(() => `Result: ${JSON.stringify(largeObject)}`);
```

### Lazy evaluation

This is the single most important detail for the programmatic API. The
logging methods short-circuit and do nothing when the namespace is disabled.
That saves you nothing when you pass a **plain argument**, because your code
builds the string before the method is ever called:

```typescript
// The template literal runs every time, even with logging off.
logger.debug(`result: ${expensiveComputation()}`);
```

To defer that work until the logger actually needs it, pass a **callback**.
The callback is never invoked when logging is disabled, so the expensive
computation is skipped entirely:

```typescript
// The callback runs only when logging is enabled for this namespace.
logger.debug(() => `result: ${expensiveComputation()}`);
```

Prefer the callback form for any message whose construction is non-trivial.

### Inspecting and overriding a logger

Each instance exposes a few accessors you may find useful:

| Accessor    | Type    | Purpose                                                                                                                                 |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `namespace` | getter  | The namespace this logger was created with.                                                                                             |
| `enabled`   | get/set | Whether output is currently produced. Recomputes from config on read; an explicit set sticks until the effective configuration changes. |
| `level`     | get/set | The logger's level (`'verbose'`, `'debug'`, `'info'`, `'error'`).                                                                       |

Output, redaction, and the active namespace patterns all flow from the same
configuration described in [Configuration](#configuration), so a logger you
create automatically respects `--debug`, the `DEBUG` environment variable, and
your settings files.

## Troubleshooting

### Debug Not Working?

1. Check current status: `/debug status`
2. Verify namespace patterns match what you expect
3. Check configuration hierarchy - CLI overrides environment
4. Ensure output target is correct (file vs stderr)

### Too Much Output?

1. Use more specific namespaces: `llxprt:openai:provider` instead of `llxprt:*`
2. Increase logging level: `/debug level info`
3. Disable verbose components while keeping others

### Can't Find Log Files?

Default location: `<log>/debug/` (see [Application Directories](./reference/application-directories.md)).

- Files are named by process id: `llxprt-debug-<PID>.jsonl`
- Check permissions on the directory
- Verify output target includes "file"

## Related

- See the [Programmatic API](#programmatic-api) section for logging from your
  own code.
