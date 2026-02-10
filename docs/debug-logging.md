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
3. **User config** - `~/.llxprt/settings.json`
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

Edit `~/.llxprt/settings.json`:

```json
{
  "debug": {
    "enabled": true,
    "namespaces": ["llxprt:openai:*", "llxprt:anthropic:*"],
    "level": "debug",
    "output": {
      "target": "file",
      "directory": "~/.llxprt/debug"
    },
    "lazyEvaluation": true,
    "redactPatterns": ["apiKey", "token", "password", "secret"]
  }
}
```

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

Debug logs are written to `~/.llxprt/debug/` in JSONL format:

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
  "args": ["gpt-4"],
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

The debug system uses lazy evaluation - when debugging is disabled, there is zero performance impact:

```typescript
// This function is never called if debug is disabled
logger.debug(() => `Processing ${expensiveComputation()}`);
```

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
# View the current run log
cat ~/.llxprt/debug/llxprt-debug-<PID>.jsonl

# Pretty print with jq
cat ~/.llxprt/debug/llxprt-debug-*.jsonl | jq '.'

# Filter by namespace
cat ~/.llxprt/debug/llxprt-debug-*.jsonl | jq 'select(.namespace | startswith("llxprt:openai"))'

# Follow log in real-time
tail -f ~/.llxprt/debug/llxprt-debug-<PID>.jsonl | jq '.'
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

Default location: `~/.llxprt/debug/`

- Files are named by date: `debug-YYYY-MM-DD.jsonl`
- Check permissions on the directory
- Verify output target includes "file"

## API Usage (For Developers)

```typescript
import { DebugLogger } from '@vybestack/llxprt-code-core';

// Create a logger with a specific namespace
const logger = new DebugLogger('llxprt:mycomponent:feature');

// Basic logging
logger.log('Simple message');
logger.debug('Debug message');
logger.error('Error message');

// Lazy evaluation for expensive operations
logger.debug(() => `Result: ${JSON.stringify(largeObject)}`);

// With additional arguments
logger.log('Processing request', requestId, userId);
```
