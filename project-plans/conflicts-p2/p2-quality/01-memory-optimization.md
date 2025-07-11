# Task: Memory Optimization

## Objective

Address the memory exhaustion issues identified in the test suite (8GB limit exceeded) and optimize memory usage throughout the application.

## Files to Investigate and Modify

### Priority 1 - Test Suite Memory:

1. **Test configuration files**
   - `vitest.config.ts`
   - `vitest.integration.config.ts`
   - Check for memory limit settings
   - Implement test isolation

2. **Memory-heavy tests**
   - Identify tests using excessive memory
   - Look for tests that don't clean up
   - Fix resource leaks in tests

### Priority 2 - Provider Memory Leaks:

3. **`packages/cli/src/providers/ProviderManager.ts`**
   - Check for retained references
   - Ensure proper cleanup on provider switch
   - Clear caches appropriately

4. **Stream handling**
   - Check all streaming implementations
   - Ensure streams are properly closed
   - Look for buffering issues

### Priority 3 - Conversation Memory:

5. **`packages/cli/src/providers/openai/ConversationCache.ts`**
   - Review cache implementation
   - Implement size limits
   - Add cache eviction

## Specific Changes Needed

### Test Suite Optimization:

1. Add to vitest config:

```javascript
{
  poolOptions: {
    threads: {
      singleThread: true, // Run tests sequentially
      maxThreads: 2 // Limit parallelism
    }
  },
  testTimeout: 30000,
  hookTimeout: 30000
}
```

2. Add afterEach cleanup:

```typescript
afterEach(() => {
  // Clear any global state
  // Reset singletons
  // Garbage collect if needed
});
```

### Provider Memory Management:

1. Implement dispose methods
2. Clear references on provider switch
3. Limit cache sizes
4. Use weak references where appropriate

### Stream Management:

1. Always close streams in finally blocks
2. Implement timeout for long-running streams
3. Limit buffer sizes

## Verification Steps

1. Run full test suite with memory monitoring
2. Check memory usage stays under 4GB
3. Run long conversation to test memory growth
4. Test provider switching doesn't leak
5. Use heap snapshots to find leaks

## Dependencies

- All P1 tasks must be complete

## Estimated Time

1 hour

## Notes

- Memory issues might be causing test failures
- Focus on test suite first (blocking issue)
- Provider memory leaks affect runtime
- Consider implementing memory profiling
