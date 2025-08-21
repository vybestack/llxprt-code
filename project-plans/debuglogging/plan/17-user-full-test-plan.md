# Phase 17: User Test Plan for Full Debug Logging System

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P17`

## Prerequisites
- Phase 16 completed (all providers migrated)
- All if(DEBUG) patterns replaced

## Comprehensive Test Plan for User

### Test 1: Provider-Specific Namespaces

```bash
# Test each provider separately
DEBUG=llxprt:openai:* llxprt chat "test openai"
DEBUG=llxprt:gemini:* llxprt chat "test gemini"  
DEBUG=llxprt:anthropic:* llxprt chat "test anthropic"

# Check ~/.llxprt/debug/:
- [ ] Each provider logs to its namespace
- [ ] No cross-contamination
- [ ] Provider-specific quirks captured
```

### Test 2: Core Services Logging

```bash
# Memory service
DEBUG=llxprt:core:memory llxprt chat "remember this: my name is Bob"

# Context service  
DEBUG=llxprt:core:context llxprt chat "long conversation..."

# Tool scheduler
DEBUG=llxprt:core:scheduler llxprt chat "search for something"

# Loop detection
DEBUG=llxprt:core:loopdetect llxprt chat "repetitive task"

# Check logs show:
- [ ] Memory operations
- [ ] Context window management
- [ ] Tool scheduling decisions
- [ ] Loop detection triggers
```

### Test 3: CLI Components

```bash
# Command processing
DEBUG=llxprt:cli:commands llxprt
/help
/provider gemini
/set temperature 0.5

# UI rendering
DEBUG=llxprt:cli:renderer llxprt chat "show me a table"

# Check logs show:
- [ ] Command parsing
- [ ] Settings changes
- [ ] Rendering decisions
```

### Test 4: Complex Namespace Patterns

```bash
# All tools across all providers
DEBUG=llxprt:*:tools llxprt chat "what time is it in Tokyo?"

# All streaming
DEBUG=llxprt:*:streaming llxprt chat "write a long story"

# Everything except CLI
DEBUG=llxprt:openai:*,llxprt:gemini:*,llxprt:anthropic:*,llxprt:core:* llxprt

# Exclude specific component
DEBUG=llxprt:*,-llxprt:*:streaming llxprt chat "test"
```

### Test 5: Configuration Hierarchy

```bash
# 1. CLI flag (highest priority)
llxprt --debug="llxprt:openai:*" chat "test"

# 2. Environment variable
DEBUG=llxprt:gemini:* llxprt chat "test"

# 3. User config
echo '{"debug": {"namespaces": ["llxprt:anthropic:*"]}}' > ~/.llxprt/settings.json
llxprt chat "test"

# 4. Project config
echo '{"debug": {"namespaces": ["llxprt:core:*"]}}' > .llxprt/config.json
llxprt chat "test"

# Test precedence:
DEBUG=llxprt:gemini:* llxprt --debug="llxprt:openai:*" chat "test"
# Should only log OpenAI (CLI flag wins)
```

### Test 6: Runtime Control

```bash
llxprt

# Enable everything
/debug enable llxprt:*
chat "test all"

# Disable streaming across all providers
/debug disable llxprt:*:streaming
chat "test no streaming"

# Enable only tools
/debug disable llxprt:*
/debug enable llxprt:*:tools
chat "use a tool"

# Check current state
/debug status

# Save configuration
/debug persist
# Verify: ~/.llxprt/settings.json updated
```

### Test 7: Performance Impact

```bash
# Baseline (no debug)
time for i in {1..10}; do
  echo "test $i" | llxprt chat
done

# Debug disabled explicitly
DEBUG= time for i in {1..10}; do
  echo "test $i" | llxprt chat  
done

# Debug enabled for everything
DEBUG=llxprt:* time for i in {1..10}; do
  echo "test $i" | llxprt chat
done

# Compare:
- [ ] Disabled matches baseline (zero overhead)
- [ ] Enabled overhead < 5%
```

### Test 8: File Management

```bash
# Generate lots of logs
DEBUG=llxprt:* llxprt
for i in {1..100}; do
  chat "message $i"
done

# Check ~/.llxprt/debug/:
- [ ] Files rotate (daily or by size)
- [ ] Old files cleaned up
- [ ] Disk usage reasonable
```

### Test 9: Cross-Provider Workflows

```bash
# Switch providers mid-conversation
DEBUG=llxprt:* llxprt
chat "Hello from OpenAI"
/provider gemini
chat "Hello from Gemini"
/provider anthropic  
chat "Hello from Anthropic"

# Check logs:
- [ ] Clean transition between providers
- [ ] Each provider's namespace clearly separated
- [ ] No confusion in log output
```

### Test 10: Error Scenarios

```bash
# Invalid API key
OPENAI_API_KEY=invalid DEBUG=llxprt:openai:* llxprt chat "test"

# Network failure (disconnect internet)
DEBUG=llxprt:* llxprt chat "test"

# Rate limiting
DEBUG=llxprt:* # rapid requests to trigger rate limit

# Check logs capture:
- [ ] Error details
- [ ] Retry attempts
- [ ] Fallback behavior
```

### Test 11: Clean Break Verification

```bash
# Old DEBUG=1 pattern should NOT work
DEBUG=1 llxprt chat "test"
# Expected: No debug output (clean break)

# Only new format works
DEBUG=llxprt:* llxprt chat "test"
# Expected: Debug output appears
```

### Test 12: Special Cases

```bash
# Very long messages
DEBUG=llxprt:* llxprt chat "repeat this 1000 times: test"

# Binary data (images)
DEBUG=llxprt:* llxprt chat "analyze this image" [attach image]

# Circular references in logged objects
# Should not crash, should handle gracefully

# Concurrent logging from multiple sources
DEBUG=llxprt:* llxprt # run complex multi-tool query
```

## Final Verification Checklist

### Functionality
- [ ] All providers log correctly
- [ ] All core services log correctly
- [ ] All CLI components log correctly
- [ ] Namespace filtering works
- [ ] Configuration hierarchy works
- [ ] Runtime control works
- [ ] File output/rotation works

### Performance
- [ ] Zero overhead when disabled
- [ ] Acceptable overhead when enabled
- [ ] No memory leaks
- [ ] No blocking I/O

### Usability
- [ ] Log format is readable
- [ ] Namespaces are logical
- [ ] Configuration is intuitive
- [ ] /debug commands are helpful
- [ ] File location makes sense

### Migration Success
- [ ] All if(DEBUG) patterns gone
- [ ] No console.log debug statements remain
- [ ] Backward compatibility works
- [ ] No regression in functionality

## User Sign-off

**Final approval required:**
- [ ] Debug logging system fully tested
- [ ] Performance acceptable
- [ ] Usability good
- [ ] Ready to remove DEBUG=1 compatibility
- [ ] Approved for production use

## Issues to Report

Document any:
- Configuration confusion
- Performance problems
- Missing information
- Format issues
- Feature requests