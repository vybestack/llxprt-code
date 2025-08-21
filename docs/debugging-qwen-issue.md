# Debugging Qwen Array Double-Stringification Issue

## Quick Start

To capture debug logs for the Qwen double-stringification issue:

```bash
# Enable debug logging for the specific namespaces needed
llxprt debug enable llxprt:tools:formatter
llxprt debug enable llxprt:providers:openai
llxprt debug set-level debug

# Run your Qwen test that demonstrates the issue
llxprt -m qwen-coder "create a function that takes an array of numbers"

# Check the debug logs
llxprt debug show
```

## Recommended Debug Namespaces

For comprehensive Qwen debugging, enable these namespaces:

### Essential Namespaces

- `llxprt:tools:formatter` - Tracks tool argument accumulation and double-stringification detection
- `llxprt:providers:openai` - Monitors Qwen fix application and provider-specific handling

### Additional Namespaces for Deep Debugging

- `llxprt:providers:openai:stream` - Stream processing and chunk accumulation
- `llxprt:tools:*` - All tool-related processing
- `llxprt:*` - Everything (use sparingly, generates large logs)

## What to Look For in Logs

### 1. Tool Argument Accumulation

Look for log entries with `[qwen] Accumulating argument chunk`:

- Check if chunks contain escaped quotes (`\"` or `\\\"`)
- Monitor the accumulation process chunk by chunk
- Watch for warnings about double-stringification patterns

### 2. Double-Stringification Detection

The system will log errors when it detects potential double-stringification:

- `[Qwen] Detected potential double-stringification in chunk`
- `[Qwen] Arguments appear to be double-stringified`

### 3. Qwen Fix Application

Look for `[Qwen Fix]` prefixed logs in OpenAIProvider:

- Shows when the fix is being applied
- Details about tool calls being processed
- Success/failure of parsing double-stringified arguments

### 4. Cerebras Corruption Detection

If using Cerebras, watch for `[Cerebras Corruption]` logs:

- Malformed array responses
- JSONResponse mutation errors
- Stream format corruption

## Debug Commands Reference

```bash
# Enable specific namespace
llxprt debug enable llxprt:tools:formatter

# Enable multiple namespaces with wildcards
llxprt debug enable llxprt:tools:*
llxprt debug enable llxprt:providers:*

# Set debug level (debug, info, error)
llxprt debug set-level debug

# Show recent logs
llxprt debug show

# Show logs for specific namespace
llxprt debug show llxprt:tools:formatter

# Clear debug logs
llxprt debug clear

# Disable debugging
llxprt debug disable
```

## Example Debug Session

1. **Setup debugging environment:**

```bash
# Clear old logs
llxprt debug clear

# Enable relevant namespaces
llxprt debug enable llxprt:tools:formatter
llxprt debug enable llxprt:providers:openai

# Set to debug level for maximum detail
llxprt debug set-level debug
```

2. **Run test that triggers the issue:**

```bash
# Test with array arguments
llxprt -m qwen-coder "create a function that filters an array [1, 2, 3, 4, 5]"
```

3. **Analyze the logs:**

```bash
# Show all captured logs
llxprt debug show

# Filter for Qwen-specific issues
llxprt debug show | grep -i qwen

# Look for double-stringification patterns
llxprt debug show | grep -i "double-string"
```

## Log File Location

Debug logs are written to: `~/.llxprt/debug/`

Files are in JSONL format and named with timestamps:

- `debug-2025-01-21T10-30-00.jsonl`

You can analyze these files directly:

```bash
# View raw JSONL logs
cat ~/.llxprt/debug/debug-*.jsonl | jq .

# Filter for Qwen issues
cat ~/.llxprt/debug/debug-*.jsonl | jq 'select(.namespace | contains("tools"))'
```

## Interpreting Results

### Healthy Tool Call

```json
{
  "namespace": "llxprt:tools:formatter",
  "message": "[qwen] Accumulating argument chunk",
  "chunk": "[1, 2, 3]",
  "startsWithQuote": false,
  "containsEscapedQuote": false
}
```

### Double-Stringified Tool Call (Problem)

```json
{
  "namespace": "llxprt:tools:formatter",
  "message": "[Qwen] Detected potential double-stringification",
  "chunk": "\\\"[1, 2, 3]\\\"",
  "startsWithQuote": true,
  "containsEscapedQuote": true,
  "pattern": "Contains escaped quotes that suggest double-stringification"
}
```

## Reporting Issues

When reporting Qwen issues, include:

1. Debug logs from the relevant namespaces
2. The exact command/prompt that triggered the issue
3. Provider details (Fireworks, Cerebras, etc.)
4. Model name and version

Export logs for sharing:

```bash
# Create a debug report
llxprt debug show > qwen-debug-report.txt

# Or export the raw JSONL files
tar -czf qwen-debug-logs.tar.gz ~/.llxprt/debug/debug-*.jsonl
```
