# Task: Final Verification and Testing

## Objective

Perform comprehensive verification that all issues are resolved and the Gemini CLI works correctly with all providers.

## Verification Steps

### 1. Build Verification

```bash
# From project root
npm run clean
npm install
npm run build
npm run lint        # Must pass with 0 errors
npm run typecheck   # Must pass with 0 errors
```

### 2. Test Suite Verification

```bash
# Run all tests
npm test

# Expected results:
# - All tests should pass (or have documented known failures)
# - No memory exhaustion errors
# - No timeout errors
```

### 3. CLI Launch Test

```bash
# Navigate to CLI directory
cd packages/cli

# Launch the CLI
node lib/gemini.js

# Verify:
# - CLI starts without errors
# - Welcome message appears
# - Prompt is ready for input
```

### 4. Basic Functionality Test

```bash
# Test with default Gemini provider
node lib/gemini.js -p 'List the files in the current directory using the LS tool'

# Verify:
# - Tool call is recognized
# - LS tool executes
# - Results are displayed
# - No errors occur
```

### 5. Provider Switching Test

```bash
# Start CLI
node lib/gemini.js

# Test provider switching
/provider openai     # Should switch to OpenAI
/provider anthropic  # Should switch to Anthropic
/provider gemini     # Should switch back to Gemini

# Test with each provider (if API keys configured):
# - Send a simple message
# - Execute a tool call
# - Verify responses work
```

### 6. Tool Execution Test

```bash
# Test various tools with different providers:

# File operations
"Read the package.json file"
"List all TypeScript files in the src directory"

# Code operations
"Search for 'ProviderManager' in the codebase"
"Show me the current git status"

# Verify each tool works correctly
```

### 7. Configuration Test

```bash
# Test configuration commands
/auth openai sk-test-key
/model gpt-4
/config

# Verify settings persist across restarts
```

### 8. Memory and Performance Test

```bash
# Have a longer conversation
# Monitor memory usage
# Ensure no significant memory growth
# Test /refresh or memory commands if implemented
```

## Success Criteria

✅ All build commands succeed  
✅ Lint and typecheck pass with 0 errors  
✅ Test suite passes (>99% pass rate)  
✅ CLI launches without errors  
✅ Basic tool execution works  
✅ Provider switching works  
✅ No memory leaks observed  
✅ Configuration persists correctly

## Known Acceptable Issues

- OpenAI streaming tests may fail in test environment (documented)
- Some provider features may require API keys to fully test

## Final Checklist

- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] All tests pass (or failures documented)
- [ ] CLI launches successfully
- [ ] Tool execution works
- [ ] Provider switching works
- [ ] Memory usage acceptable
- [ ] Documentation updated

## Dependencies

- All P0, P1, and P2 tasks must be complete

## Estimated Time

30 minutes

## Notes

- Document any issues found for future fixes
- If any critical issues found, create follow-up tasks
- Consider creating automated smoke test for future merges
