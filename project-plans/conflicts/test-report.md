# Test Suite Report

Date: 2025-07-09
Command: `NODE_OPTIONS="--max-old-space-size=8192" npm test`

## Summary

**Test Files**: 2 failed | 52 passed (54 total)
**Tests**: 3 failed | 849 passed (852 total)
**Duration**: 5.08s total

- Transform: 1.70s
- Setup: 298ms
- Collect: 17.51s
- Tests: 4.55s
- Environment: 8ms
- Prepare: 4.76s

## Failed Tests

### 1. client.test.ts

- **Test**: `Gemini Client (client.ts) > countTokens > should handle valid input text`
- **Issue**: Expected 75 tokens but received 93
- **Location**: packages/core/src/core/client.test.ts:1095

### 2. client.test.ts

- **Test**: `Gemini Client (client.ts) > updateModel > should update model in config and reinitialize chat`
- **Issue**: Expected 'gemini-2.5-flash' but received 'gemini-2.5-pro'
- **Location**: packages/core/src/core/client.test.ts:1631

### 3. shell.test.ts

- **Test**: `Shell tests > directory validation edge cases > should handle malformed directory paths gracefully`
- **Issue**: Process exited with code 1
- **Command**: `cd /malformed//path && echo "test"`
- **Location**: packages/core/src/tools/shell.test.ts:303

## Memory Issue

The test run ended with a JavaScript heap out of memory error despite setting `--max-old-space-size=8192`. The error occurred after running most tests successfully, suggesting that memory accumulation during the test run exceeded 8GB.

## Passed Test Categories

All other test categories passed successfully, including:

- Gemini Client tests (except the 2 failures noted)
- Tool tests (write-file, glob, mcp-tool, todo-read/write, etc.)
- Utility tests (editor, retry, memory discovery, etc.)
- Core functionality tests (contentGenerator, turn, prompts, etc.)
- Service tests (gitService, fileDiscoveryService)
- Telemetry tests

## Recommendations

1. **Token Count Test**: The expected token count may need updating if the tokenizer has changed
2. **Model Update Test**: Verify that the `updateModel` function is correctly updating the model to 'gemini-2.5-flash'
3. **Shell Test**: The malformed path test may need adjustment for platform-specific behavior
4. **Memory Usage**: Consider:
   - Running tests in smaller batches
   - Investigating memory leaks in the test suite
   - Increasing memory allocation further or optimizing test resource usage

## Next Steps

1. Fix the 3 failing tests
2. Update snapshots if needed with `npm test -- -u`
3. Investigate memory usage optimization for the test suite
