# Task 2: Privacy-First Telemetry Documentation

## Objective
Create comprehensive documentation for llxprt's privacy-first telemetry and logging approach.

## For: typescript-coder subagent

## Requirements
1. Create `docs/telemetry-privacy.md` documenting our approach
2. Update `README.md` with privacy statement
3. Include examples and configuration

## Documentation Structure

### 1. Create Main Telemetry Documentation
**File**: `docs/telemetry-privacy.md`

Content to include:
- Privacy-first philosophy
- Local-only data storage
- No external transmission
- How telemetry works in llxprt
- Difference from upstream gemini-cli

### 2. Logging Command Documentation
- `/logging` command reference
- All subcommands (enable, disable, status, show, redaction)
- Configuration options
- Storage location (~/.llxprt/conversations/)
- Log format (JSONL)

### 3. Configuration Guide
- Settings structure
- Environment variables
- Default values
- How to enable/disable

### 4. Privacy Controls
- Data redaction options
- What gets logged
- What gets redacted
- How to configure redaction

### 5. Testing and Development
- How telemetry works in tests
- Local telemetry for debugging
- Integration test configuration

## Example Content Structure

```markdown
# LLxprt Privacy-First Telemetry

## Overview
LLxprt takes a privacy-first approach to telemetry and logging. All data stays on your machine.

## Key Principles
- **Local Only**: No data is sent to external services
- **Opt-in**: Logging is disabled by default
- **Transparent**: You can see exactly what is logged
- **Controllable**: Simple on/off controls

## Conversation Logging
When enabled, llxprt logs conversations locally to help with debugging and analysis.

### Storage
- Location: `~/.llxprt/conversations/`
- Format: JSONL (one JSON object per line)
- Rotation: Daily files (conversation-YYYY-MM-DD.jsonl)

### Commands
- `/logging enable` - Enable conversation logging
- `/logging disable` - Disable conversation logging
- `/logging status` - Check current status
- `/logging show [N]` - View last N log entries
- `/logging redaction` - Configure what gets redacted

## Configuration
```json
{
  "telemetry": {
    "logConversations": false,
    "logResponses": false,
    "redactSensitiveData": true,
    "redactFilePaths": false,
    "redactPersonalInfo": true
  }
}
```

## Testing
Integration tests use local telemetry with `target: "local"`.
```

## Tests to Write
1. Documentation exists and is accessible
2. All commands are documented
3. Examples are valid
4. Configuration examples work

## Success Criteria
- Clear, comprehensive documentation
- All privacy features explained
- Difference from upstream clearly stated
- Easy to understand for users