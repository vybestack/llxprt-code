# Phase 15a: User Test Plan for OpenAI Provider Debug Logging

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P15a`

## Prerequisites
- Phase 15 completed (OpenAI provider has new debug logging)
- User ready to test

## Test Plan for User to Execute

### Test 1: Environment Variable Configuration

```bash
# Test 1A: Basic namespace enabling
DEBUG=llxprt:openai:* llxprt chat "What is 2+2?"
# Check: ~/.llxprt/debug/ has log file with OpenAI API calls

# Test 1B: Specific component
DEBUG=llxprt:openai:streaming llxprt chat "Write a poem"
# Check: Only streaming logs appear, not tools or provider logs

# Test 1C: Multiple namespaces
DEBUG=llxprt:openai:tools,llxprt:openai:provider llxprt chat "What time is it?"
# Check: Both tool calls and provider logs, but no streaming logs

# Test 1D: Wildcard patterns
DEBUG=llxprt:* llxprt chat "Hello"
# Check: All llxprt logs appear (openai, gemini, core, cli)
```

### Test 2: Runtime Configuration via Commands

```bash
# Start llxprt without debug
llxprt

# Test 2A: Enable at runtime
/debug enable llxprt:openai:*
chat "What is the weather?"
# Check: Logs start appearing in ~/.llxprt/debug/

# Test 2B: Disable specific namespace
/debug disable llxprt:openai:streaming
chat "Tell me a story"
# Check: Provider and tools logged, but not streaming

# Test 2C: Change log level
/debug level trace
chat "Calculate 5+5"
# Check: More detailed logs appear

# Test 2D: Check status
/debug status
# Check: Shows current configuration

# Test 2E: Persist settings
/debug persist
# Check: Settings saved to ~/.llxprt/settings.json
```

### Test 3: Configuration File Testing

```bash
# Test 3A: User config
echo '{
  "debug": {
    "enabled": true,
    "namespaces": ["llxprt:openai:tools"],
    "output": {
      "target": "file",
      "directory": "~/my-debug-logs"
    }
  }
}' > ~/.llxprt/settings.json

llxprt chat "Use a tool"
# Check: Logs appear in ~/my-debug-logs/ not ~/.llxprt/debug/

# Test 3B: Project config (in project directory)
echo '{
  "debug": {
    "namespaces": ["llxprt:openai:provider"]
  }
}' > .llxprt/config.json

llxprt chat "Test message"
# Check: Only provider logs, project config merged with user config
```

### Test 4: Cerebras-Specific Issues

```bash
# Switch to Cerebras
/provider cerebras

# Test 4A: Double-stringification issue
DEBUG=llxprt:openai:cerebras llxprt chat "Use the web search tool"
# Check: Logs show "CEREBRAS API ISSUE" entries
# Check: Double-stringified tool arguments logged

# Test 4B: JSONResponse mutation errors
DEBUG=llxprt:openai:* llxprt chat "Stream a long response"
# Check: Any JSONResponse errors logged with full context
```

### Test 5: Performance Validation

```bash
# Test 5A: Overhead when disabled
time llxprt chat "Quick test" # Baseline
DEBUG= time llxprt chat "Quick test" # Should be same
# Check: Times are within 1% of each other

# Test 5B: Lazy evaluation working
DEBUG=llxprt:openai:provider llxprt chat "Complex query with tools"
# Check: Large objects only stringified if logging enabled

# Test 5C: No console output
DEBUG=llxprt:openai:* llxprt chat "Test" 2>&1 | grep -c "DEBUG"
# Check: Should be 0 (all output to files, not console)
```

### Test 6: File Management

```bash
# Test 6A: File rotation by size
# Set small size limit in config
echo '{"debug": {"output": {"maxSize": "1KB"}}}' > ~/.llxprt/settings.json
DEBUG=llxprt:openai:* llxprt chat "Long conversation..."
# Check: Multiple log files created when size exceeded

# Test 6B: Daily rotation
# Check: New file created each day (filename has date)

# Test 6C: Retention/cleanup
# Check: Old files deleted after retention period
```

### Test 7: Sensitive Data Redaction

```bash
# Test with API keys in logs
DEBUG=llxprt:openai:* OPENAI_API_KEY=sk-test123 llxprt chat "Test"
# Check: Logs show "apiKey: [REDACTED]" not actual key

# Test with tokens
# Check: Any "token", "password", "secret" values are [REDACTED]
```

## What to Report Back

After testing, report:

1. **What worked:**
   - [ ] Environment variable configuration
   - [ ] Runtime commands (/debug)
   - [ ] Config file hierarchy
   - [ ] File output location
   - [ ] Log rotation
   - [ ] Sensitive data redaction

2. **What didn't work:**
   - [ ] Any configuration that failed
   - [ ] Performance issues
   - [ ] Missing information in logs
   - [ ] Confusing output format

3. **Cerebras-specific:**
   - [ ] Are the issues being captured?
   - [ ] Is the logging helpful for debugging?
   - [ ] Any missing context?

4. **Overall assessment:**
   - Is this better than if(DEBUG)?
   - Is the file output useful?
   - Any changes needed before migrating other providers?
   - Ready to proceed with full migration?

## STOP POINT

**DO NOT PROCEED TO PHASE 16 UNTIL USER CONFIRMS:**
"OpenAI provider debug logging tested and approved for migration to other providers"