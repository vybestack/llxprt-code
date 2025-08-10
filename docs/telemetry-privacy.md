# LLxprt Privacy-First Telemetry

## Overview

LLxprt takes a **privacy-first approach** to telemetry and logging. All data stays on your local machine by default, with no external transmission to Google or any other third-party services. This documentation explains our privacy-centered telemetry system and how to use it effectively for debugging and analysis.

## Key Privacy Principles

- **Local Only**: No data is sent to external services by default
- **Opt-in**: All logging and telemetry features are disabled by default
- **Transparent**: You can see exactly what is logged and where it's stored
- **User-Controlled**: Simple commands to enable, disable, and configure all features
- **Data Redaction**: Sensitive information is automatically redacted from logs
- **No Upstream Telemetry**: Unlike the original gemini-cli, LLxprt never sends data to Google

## Conversation Logging

When enabled, LLxprt logs conversations locally to help with debugging, analysis, and improving your AI interactions.

### Storage Details

- **Location**: `~/.llxprt/conversations/`
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

After enabling, all new conversations will be logged to your local `~/.llxprt/conversations/` directory.

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

Add telemetry configuration to your `~/.llxprt/settings.json` or workspace `.llxprt/settings.json`:

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
    "conversationLogPath": "~/.llxprt/conversations",
    "maxLogFiles": 10,
    "maxLogSizeMB": 50,
    "retentionDays": 30,
    "maxConversationsStored": 1000
  }
}
```

### Configuration Options Reference

#### Core Logging Settings

- `logConversations` (boolean): Enable conversation logging (default: `false`)
- `logResponses` (boolean): Include full AI responses in logs (default: `false`)
- `conversationLogPath` (string): Directory for log files (default: `~/.llxprt/conversations`)

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

### Environment Variables

You can also control telemetry through environment variables:

- `LLXPRT_LOG_CONVERSATIONS`: Set to `"true"` to enable conversation logging
- `LLXPRT_CONVERSATION_LOG_PATH`: Override the log directory path

### Configuration Precedence

Settings are applied in the following order (highest precedence first):

1. **Command-line flags** (when using the `llxprt` CLI)
2. **Environment variables**
3. **Workspace settings** (`.llxprt/settings.json` in current directory)
4. **User settings** (`~/.llxprt/settings.json` in home directory)
5. **Default values**

## Testing and Development

### Local Telemetry for Tests

During testing and development, LLxprt uses local-only telemetry configuration:

```javascript
// Integration tests use local telemetry target
const telemetryConfig = {
  target: 'local',
  enabled: true,
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
4. **Examine log files**: Check `~/.llxprt/conversations/` for detailed JSONL data

The log files contain structured data that can be analyzed with standard JSON tools:

```bash
# View today's conversation log
cat ~/.llxprt/conversations/conversation-$(date +%Y-%m-%d).jsonl | jq '.'

# Filter for specific providers
cat ~/.llxprt/conversations/conversation-*.jsonl | jq 'select(.provider == "openai")'

# Count conversations by provider
cat ~/.llxprt/conversations/conversation-*.jsonl | jq -r '.provider' | sort | uniq -c
```

## Privacy Guarantees

### What LLxprt Does NOT Do

- **No External Transmission**: LLxprt never sends your conversation data to Google, OpenAI, Anthropic, or any other external service
- **No Analytics**: No usage analytics or statistics are collected or transmitted
- **No Cloud Storage**: All data remains on your local machine
- **No Tracking**: No user behavior tracking or profiling

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

- **Zero external transmission**: All data stays local by default
- **Disabled by default**: No telemetry or logging without explicit user consent
- **Complete user control**: Users manage all aspects of data collection
- **Enhanced redaction**: Advanced privacy protection with configurable redaction
- **Open transparency**: Full documentation of all privacy practices

## Best Practices

### For Daily Use

1. **Start with logging disabled**: Only enable when you need debugging information
2. **Configure redaction**: Enable redaction for all sensitive data types in your workflow
3. **Regular cleanup**: Periodically review and clean old log files
4. **Check settings**: Verify your privacy settings match your comfort level

### For Development

1. **Local testing only**: Use local telemetry targets for all development work
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
A: Check that the log directory exists and you have write permissions. The default path is `~/.llxprt/conversations/`.

**Q: My log files are very large**
A: Configure `maxLogSizeMB` and `maxLogFiles` in your settings to control file rotation and size limits.

**Q: I see sensitive information in logs despite redaction being enabled**
A: Some patterns may not be caught by automatic redaction. Consider adding custom redaction patterns or disabling logging for sensitive workflows.

**Q: How do I permanently delete all conversation logs?**
A: Remove the entire conversation log directory: `rm -rf ~/.llxprt/conversations/`

### Getting Help

For privacy-related questions or concerns:

1. Check this documentation first
2. Review your current settings with `/logging status` and `/logging redaction`
3. Examine log files to understand what data is being stored
4. File an issue in the LLxprt repository for additional support

Remember: Your privacy and data control are fundamental to LLxprt's design. All telemetry features are designed to serve you, not external parties.
