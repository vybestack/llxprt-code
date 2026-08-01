# Debug Logging System

The LLxprt debug logging system provides powerful, zero-overhead debugging capabilities with flexible configuration and namespace-based filtering.

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

### Zero Overhead When Disabled

The debug system uses lazy evaluation — when debugging is disabled, log messages
are never evaluated, so there is zero performance impact even if the code passes
expensive computations as arguments.

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

- For the programmatic logging API and internal architecture, see
  [Debug Logging Internals](../dev-docs/debug-logging-internals.md).
