# LLxprt Privacy-First Telemetry

## Overview

LLxprt takes a **privacy-first approach** to telemetry and logging. All data stays on your local machine, with no external transmission to Google or any other third-party services. This documentation explains our privacy-centered telemetry system and how to use it effectively for debugging and analysis.

## Key Privacy Principles

- **Local Only**: No data is sent to external services
- **Opt-in persistence**: Conversation logging and OTEL output are disabled by default; ephemeral `/stats` aggregation remains in memory
- **Transparent**: You can see exactly what is logged and where it's stored
- **User-Controlled**: Simple commands to enable, disable, and configure all features
- **Data Redaction**: Sensitive information is automatically redacted from logs
- **No Upstream Telemetry**: Unlike the original gemini-cli, LLxprt never sends data to Google

## Conversation Logging

When enabled, LLxprt logs conversations locally to help with debugging, analysis, and improving your AI interactions.

### Storage Details

- **Location**: `<data>/conversations/` (see [Application Directories](./reference/application-directories.md))
- **Format**: JSONL (one JSON object per line)
- **File Naming**: `conversation-YYYY-MM-DD.jsonl` (daily rotation)
- **Permissions**: Files are readable only by your user account
- **Retention**: Configurable retention period (default: 30 days)

### What Gets Logged

When conversation logging is enabled, the following data is stored locally:

#### Request Data

- User prompts and messages
- Provider selection (e.g., "openai", "anthropic", "gemini")
- Model parameters and configuration
- Tool call requests and parameters
- Timestamp and session information

#### Response Data

- AI assistant responses
- Tool call results
- Token usage statistics
- Response metadata (model, provider, timing)

#### Metadata

- Session identifiers
- Performance metrics
- Error information (when applicable)

### What Gets Redacted

LLxprt automatically redacts sensitive information before writing to log files:

- **API Keys and Tokens**: Automatically detected and replaced with `[REDACTED_API_KEY]`
- **Credentials**: Passwords, auth tokens, and secret keys
- **File Paths**: Local file system paths (configurable)
- **URLs**: Web URLs with potentially sensitive parameters
- **Email Addresses**: Personal email addresses
- **Personal Information**: Phone numbers, SSNs, and other PII patterns

## The `/logging` Command

The `/logging` command provides complete control over conversation logging features.

### `/logging status`

Shows the current state of conversation logging.

```bash
/logging status
```

**Example Output:**

```
Conversation Logging: Disabled
```

### `/logging enable`

Enables conversation logging with automatic local storage.

```bash
/logging enable
```

**Example Output:**

```
Conversation logging enabled. Data stored locally only.
```

After enabling, all new conversations will be logged to your local `<data>/conversations/` directory (see [Application Directories](./reference/application-directories.md)).

### `/logging disable`

Disables conversation logging. No future conversations will be logged.

```bash
/logging disable
```

**Example Output:**

```
Conversation logging disabled. No conversation data will be collected.
```

Note: This does not delete existing log files. Use your system's file manager to remove old logs if desired.

### `/logging show [N]`

Displays the last N log entries from your conversation history (default: 50).

```bash
/logging show 25
```

**Example Output:**

```
Conversation Logs (3 entries):
────────────────────────────────────────────────────────────
[1] 14:32:15 → openai: What is TypeScript and how does it differ from JavaScript?...
[2] 14:32:18 ← openai: TypeScript is a superset of JavaScript that adds static typing...
[3] 14:35:22 → gemini: Can you help me debug this React component?...
────────────────────────────────────────────────────────────
```

### `/logging redaction`

Configure what types of data get automatically redacted from logs.

#### View Current Settings

```bash
/logging redaction
```

**Example Output:**

```
Current Redaction Settings:
  • API Keys: Enabled
  • Credentials: Enabled
  • File Paths: Disabled
  • URLs: Enabled
  • Email Addresses: Enabled
  • Personal Info: Enabled

To modify settings:
  /logging redaction --api-keys=false
  /logging redaction --file-paths=true
```

#### Modify Redaction Settings

```bash
/logging redaction --file-paths=true --emails=false
```

**Available Options:**

- `--api-keys=true/false`: Redact API keys and authentication tokens
- `--credentials=true/false`: Redact passwords and credentials
- `--file-paths=true/false`: Redact local file system paths
- `--urls=true/false`: Redact URLs with sensitive parameters
- `--emails=true/false`: Redact email addresses
- `--personal-info=true/false`: Redact phone numbers, SSNs, and PII

**Example Output:**

```
Redaction settings updated:
  • redactFilePaths: enabled
  • redactEmails: disabled
```

## Configuration Options

LLxprt's telemetry can be configured through settings files, environment variables, and command-line flags.

### Settings File Configuration

Add telemetry configuration to your [user settings.json](./reference/application-directories.md) (in LLxprt's config directory) or workspace `.llxprt/settings.json`:

```json
{
  "telemetry": {
    "logConversations": false,
    "logResponses": false,
    "redactSensitiveData": true,
    "redactFilePaths": false,
    "redactUrls": true,
    "redactEmails": true,
    "redactPersonalInfo": true,
    "conversationLogPath": "",
    "maxLogFiles": 10,
    "maxLogSizeMB": 50,
    "retentionDays": 30,
    "maxConversationsStored": 1000
  }
}
```

Leave `conversationLogPath` empty (or omit it) to use the default `<data>/conversations` location; set it to an absolute path to override.

### Configuration Options Reference

#### Core Logging Settings

- `logConversations` (boolean): Enable conversation logging (default: `false`)
- `logResponses` (boolean): Include full AI responses in logs (default: `false`)
- `conversationLogPath` (string): Directory for log files (default: `<data>/conversations`, see [Application Directories](./reference/application-directories.md))

#### Data Retention Settings

- `retentionDays` (number): Days to keep log files (default: `30`)
- `maxLogFiles` (number): Maximum number of log files to keep (default: `5`)
- `maxLogSizeMB` (number): Maximum size of each log file in MB (default: `10`)
- `maxConversationsStored` (number): Maximum conversations to store (default: `1000`)

#### Privacy and Redaction Settings

- `redactSensitiveData` (boolean): Enable API key/credential redaction (default: `true`)
- `redactFilePaths` (boolean): Redact local file paths (default: `false`)
- `redactUrls` (boolean): Redact URLs with parameters (default: `true`)
- `redactEmails` (boolean): Redact email addresses (default: `true`)
- `redactPersonalInfo` (boolean): Redact PII patterns (default: `true`)

#### Client Performance Telemetry

LLxprt can optionally collect **local client-side performance telemetry** —
timing data for client phases (prepare, stream handling, Ink rendering, stdout
writes, finalization), provider/tool activity intervals, and operation lifecycle
metadata. This data is written to local JSONL files and is **never transmitted
externally**.

Both keys are **disabled by default**. To enable:

```json
{
  "telemetry": {
    "perf": {
      "enabled": true,
      "memory": true
    }
  }
}
```

- `telemetry.perf.enabled` (boolean): Master switch for performance telemetry. Default: `false`. When `false`, no perf files are created, no observers are installed, and no memory ring is allocated.
- `telemetry.perf.memory` (boolean): Include memory trend data (RSS, heap, external, array buffers) in perf records. Default: `false`. **Effective only when `enabled` is `true`** — memory is gated by the master switch. When perf is enabled but memory is off, operation records omit the memory columns entirely (absent, not zero-filled).

`telemetry.perf` is an **object**, not a boolean. Setting it to `true` or `false`
directly is invalid.

When perf telemetry is enabled, data is persisted to local JSONL files and is
**never transmitted externally**.

- **Location**: the perf directory is `<global log dir>/perf`, where the global
  log dir is `Storage.getGlobalLogDir()` (resolved from `LLXPRT_LOG_HOME`, then
  `LLXPRT_CONFIG_HOME`, then the platform default — see
  [Application Directories](./reference/application-directories.md)). Files are
  named `perf-YYYYMMDD-<runUuid>.jsonl` (one per writer per UTC day).
- **What is recorded**: each `operation` record carries identity/build fields
  (`session_id`, `operation_id`, `runtime_id`, `project_hash`, `llxprt_version`,
  `git_sha`, `runtime`, `platform`), the comparison dimensions (`provider`,
  `model`, `render_mode`, terminal geometry), token counts
  (`context_tokens`, `output_tokens`), direct client-phase timing
  (`client_prepare_ms`, `stream_handler_ms`, `ink_render_ms`,
  `stdout_write_sync_ms`, `client_finalize_ms`), provider/tool activity
  intervals, the terminal `status`, and `concurrent_instances`. When
  `telemetry.perf.memory` is on, `memory_sample` rows additionally carry RSS,
  heap, external, and array-buffer bytes with `uptime_ms`. Prompt/response text
  is **not** recorded.
- **Retention**: an eventual bound of **64 MiB / 128 artifacts** (JSONL files +
  claim files) is enforced oldest-first. A genuinely-live writer — today's UTC
  day-key with an mtime within the maintenance window — is never evicted, and a
  non-stale run claim survives while it is active; both still count toward the
  caps. This lets a long-running process converge to the bounds by evicting its
  own older files while its current file stays safe.
- **Inspection and management** (interactive `/perf` subcommands):
  - `/perf` — current-process snapshot (live samples, active operation) when
    perf is active in this process; otherwise reports it is not active.
  - `/perf inspect` — directory path, schema version, privacy/default-off
    statement, file/record counts, and self-health (skipped/truncated lines,
    last write error, evictions).
  - `/perf report [--baseline <version|sha>]` — grouped p50 metrics by build
    and comparison dimensions, with optional matched-dimension delta.
  - `/perf delete` — removes old/stale perf artifacts (respecting live writers
    and active claims).

### Environment Variables

You can also control telemetry through environment variables:

- `LLXPRT_LOG_CONVERSATIONS`: Set to `"true"` to enable conversation logging
- `LLXPRT_CONVERSATION_LOG_PATH`: Override the log directory path

### Configuration Precedence

Settings are applied in the following order (highest precedence first):

1. **Command-line flags** (when using the `llxprt` CLI)
2. **Environment variables**
3. **Workspace settings** (`.llxprt/settings.json` in current directory)
4. **User settings** (your user `settings.json` in LLxprt's [config directory](./reference/application-directories.md))
5. **Default values**

## Testing and Development

### Local Telemetry for Tests

During testing and development, configure a temporary local outfile when tests
need to inspect telemetry output:

```javascript
const telemetryConfig = {
  enabled: true,
  outfile: '/tmp/llxprt-telemetry.jsonl',
  logConversations: true,
};
```

This ensures that:

- No test data leaves your development machine
- Test telemetry is isolated from production usage
- Integration tests can verify logging functionality safely

### Debugging with Conversation Logs

To debug issues with LLxprt:

1. **Enable logging**: `/logging enable`
2. **Reproduce the issue**: Run the problematic commands
3. **View recent logs**: `/logging show 20`
4. **Examine log files**: Check `<data>/conversations/` (see [Application Directories](./reference/application-directories.md)) for detailed JSONL data

The log files contain structured data that can be analyzed with standard JSON tools:

```bash
# View today's conversation log. This Linux example honors LLXPRT_DATA_HOME,
# then LLXPRT_CONFIG_HOME, then the Linux default; see Application Directories
# for the macOS and Windows defaults.
DATA_DIR="${LLXPRT_DATA_HOME:-${LLXPRT_CONFIG_HOME:-$HOME/.local/share/llxprt-code}}"
cat "${DATA_DIR}/conversations/conversation-$(date +%Y-%m-%d).jsonl" | jq '.'

# Filter for specific providers
cat "${DATA_DIR}/conversations/conversation-"*.jsonl | jq 'select(.provider == "openai")'

# Count conversations by provider
cat "${DATA_DIR}/conversations/conversation-"*.jsonl | jq -r '.provider' | sort | uniq -c
```

## Privacy Guarantees

### What LLxprt Does NOT Do

- **No telemetry transmission**: Conversation logs and telemetry are never uploaded to Google, OpenAI, Anthropic, or another analytics service
- **No uploaded analytics**: Local session statistics are not transmitted
- **No cloud log storage**: LLxprt does not upload conversation logs to cloud storage
- **No telemetry profiling**: Conversation logging exists for local inspection and debugging

### What LLxprt DOES Do

- **Local Storage Only**: All logs are written to your local file system with proper permissions
- **Automatic Redaction**: Sensitive information is automatically removed before logging
- **User Control**: You have complete control over what gets logged and for how long
- **Transparency**: All logging behavior is documented and configurable
- **Data Ownership**: You own and control all logged data

## Difference from Upstream Gemini CLI

LLxprt fundamentally differs from the original Google Gemini CLI in its approach to telemetry:

### Upstream Gemini CLI (What We Don't Do)

- May send telemetry data to Google services
- Has different privacy policies and data handling
- May collect usage statistics for Google's analysis
- Telemetry configuration optimized for Google's needs

### LLxprt Privacy-First Approach

- **Zero telemetry transmission**: Telemetry and conversation logs always stay local
- **Persistent output disabled by default**: OTEL telemetry and conversation logging require explicit enablement; in-memory `/stats` remains active
- **Complete user control**: Users manage all persistent telemetry and conversation logging
- **Enhanced redaction**: Advanced privacy protection with configurable redaction
- **Open transparency**: Full documentation of all privacy practices

## Best Practices

### For Daily Use

1. **Start with logging disabled**: Only enable when you need debugging information
2. **Configure redaction**: Enable redaction for all sensitive data types in your workflow
3. **Regular cleanup**: Periodically review and clean old log files
4. **Check settings**: Verify your privacy settings match your comfort level

### For Development

1. **Use temporary output files**: Keep test telemetry isolated in local temporary files
2. **Sensitive data awareness**: Be mindful of API keys and credentials in test scenarios
3. **Log analysis**: Use standard JSON tools to analyze conversation patterns
4. **Documentation**: Document any privacy-related configuration for your team

### For Team Environments

1. **Consistent settings**: Share redaction configurations across team members
2. **No shared logs**: Never share raw conversation log files (they may contain sensitive data)
3. **Privacy policies**: Establish team policies for conversation logging
4. **Access control**: Ensure log files have appropriate file system permissions

## Support and Troubleshooting

### Common Issues

**Q: I enabled logging but don't see any log files**
A: Check that the log directory exists and you have write permissions. The default path is `<data>/conversations/` (see [Application Directories](./reference/application-directories.md)).

**Q: My log files are very large**
A: Configure `maxLogSizeMB` and `maxLogFiles` in your settings to control file rotation and size limits.

**Q: I see sensitive information in logs despite redaction being enabled**
A: Some patterns may not be caught by automatic redaction. Consider adding custom redaction patterns or disabling logging for sensitive workflows.

**Q: How do I permanently delete all conversation logs?**
A: Remove the entire conversation log directory. This Linux example honors `LLXPRT_DATA_HOME`, then `LLXPRT_CONFIG_HOME`, then the Linux default; see [Application Directories](./reference/application-directories.md) for the macOS and Windows defaults:

```bash
DATA_DIR="${LLXPRT_DATA_HOME:-${LLXPRT_CONFIG_HOME:-$HOME/.local/share/llxprt-code}}"
rm -rf "${DATA_DIR}/conversations/"
```

### Getting Help

For privacy-related questions or concerns:

1. Check this documentation first
2. Review your current settings with `/logging status` and `/logging redaction`
3. Examine log files to understand what data is being stored
4. File an issue in the LLxprt repository for additional support

Remember: Your privacy and data control are fundamental to LLxprt's design. All telemetry features are designed to serve you, not external parties.
