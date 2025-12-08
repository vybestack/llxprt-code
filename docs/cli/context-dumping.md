# Context Dumping

The `/dumpcontext` command captures complete API request/response data for debugging provider interactions. Dumps are saved in OpenAI-compliant JSON format, making them easy to replay with curl or analyze for troubleshooting.

## Quick Start

```bash
# In an interactive session, enable dumping for the next request only
/dumpcontext now

# Enable dumping for all requests
/dumpcontext on

# Enable dumping only when errors occur
/dumpcontext error

# Check current status
/dumpcontext status

# Disable dumping
/dumpcontext off
```

## Command Options

| Mode     | Description                           |
| -------- | ------------------------------------- |
| `now`    | Dump context on the next request only |
| `status` | Show current dump status (default)    |
| `on`     | Dump context before every request     |
| `error`  | Dump context only when errors occur   |
| `off`    | Disable context dumping               |

## Dump Location

Dumps are saved to `~/.llxprt/dumps/` with filenames in the format:

```text
YYYYMMDD-HHMMSS-<provider>-<random>.json
```

Example: `20251208-183505-openai-asq1d9.json`

## Dump File Structure

Each dump file contains the complete HTTP request and response:

```json
{
  "provider": "openai",
  "timestamp": "2025-12-08T18:35:05.039Z",
  "request": {
    "url": "https://api.openai.com/v1/chat/completions",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "User-Agent": "llxprt-code"
    },
    "body": {
      "model": "gpt-4",
      "messages": [...],
      "tools": [...],
      "stream": false,
      "tool_choice": "auto",
      "temperature": 1
    }
  },
  "response": {
    "status": 200,
    "headers": {...},
    "body": {...}
  }
}
```

**Note:** The `Authorization` header is intentionally omitted from dumps for security.

## Using Dumps with curl

Dumps are OpenAI API compliant and can be replayed with curl. Since the dump includes metadata alongside the request body, extract the body first:

### Extract and Send Request

```bash
# Extract the request body and send to the API
jq '.request.body' ~/.llxprt/dumps/YOUR_DUMP.json > /tmp/body.json

curl -X POST "$(jq -r '.request.url' ~/.llxprt/dumps/YOUR_DUMP.json)" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d @/tmp/body.json
```

### One-liner Alternative

```bash
# Pipe the body directly to curl
jq '.request.body' ~/.llxprt/dumps/YOUR_DUMP.json | \
  curl -X POST "https://api.openai.com/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d @-
```

### Using with Different Providers

For OpenAI-compatible providers (like local models or alternative endpoints):

```bash
# Extract URL from dump and use with custom auth
DUMP=~/.llxprt/dumps/YOUR_DUMP.json
jq '.request.body' "$DUMP" | \
  curl -X POST "$(jq -r '.request.url' "$DUMP")" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $YOUR_API_KEY" \
    -d @-
```

## Analyzing Dumps

### View Request Summary

```bash
# Show provider, model, and message count
jq '{
  provider: .provider,
  model: .request.body.model,
  message_count: (.request.body.messages | length),
  tool_count: (.request.body.tools | length),
  response_status: .response.status
}' ~/.llxprt/dumps/YOUR_DUMP.json
```

### Extract Conversation History

```bash
# Show messages with roles
jq '.request.body.messages[] | {role, content: .content[:100]}' ~/.llxprt/dumps/YOUR_DUMP.json
```

### List Available Tools

```bash
# Show tool names and descriptions
jq '.request.body.tools[] | {name: .function.name, description: .function.description[:50]}' ~/.llxprt/dumps/YOUR_DUMP.json
```

### Check Response Details

```bash
# Show response finish reason and token usage
jq '{
  finish_reason: .response.body.choices[0].finish_reason,
  usage: .response.body.usage
}' ~/.llxprt/dumps/YOUR_DUMP.json
```

## Use Cases

### Debugging API Issues

When encountering unexpected behavior:

1. Enable dumping: `/dumpcontext on`
2. Reproduce the issue
3. Disable dumping: `/dumpcontext off`
4. Analyze the dump to see exactly what was sent/received

### Comparing Provider Responses

Capture the same prompt across different providers to compare:

1. Run with provider A, dump enabled
2. Switch providers: `/provider openai`
3. Run same prompt with provider B
4. Compare the dump files

### Reporting Bugs

Include relevant dump files (with sensitive data redacted) when reporting provider-related bugs. The dumps show exactly what LLxprt sent and what the API returned.

### Testing API Compatibility

Use dumps to verify that OpenAI-compatible providers handle requests correctly:

```bash
# Replay a known-good request against a new endpoint
jq '.request.body' dump.json | \
  curl -X POST "http://localhost:1234/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d @-
```

## Combining with Debug Logging

For comprehensive debugging, combine context dumping with debug logging:

```bash
# Enable both debug logging and context dumping
llxprt --debug llxprt:*

# In session
/dumpcontext on
```

This gives you:

- **Debug logs**: Internal application flow and timing
- **Context dumps**: Exact API payloads and responses

See [Debug Logging](../debug-logging.md) for more information.

## Security Considerations

- Authorization headers are **never** included in dumps
- Dumps may contain sensitive conversation content
- Store dumps securely and clean up when no longer needed
- Consider redacting sensitive data before sharing dumps

```bash
# Clean up old dumps
rm ~/.llxprt/dumps/*.json

# Or keep only recent dumps
find ~/.llxprt/dumps -name "*.json" -mtime +7 -delete
```
