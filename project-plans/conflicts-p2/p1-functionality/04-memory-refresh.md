# Task: Fix Memory Refresh Functionality

## Objective

Implement or fix the memory refresh functionality that appears to be referenced but not fully implemented in the merged code.

## Files to Investigate and Modify

### Priority 1 - Find Memory Refresh Implementation:

1. **Search for memory refresh references**
   - Use grep to find "memory", "refresh", "showMemoryAction"
   - Locate any partial implementations
   - Understand intended functionality

2. **`packages/cli/src/ui/hooks/slashCommandProcessor.ts`**
   - The removed `showMemoryAction` import suggests this was planned
   - Check if memory command exists
   - Implement if missing

### Priority 2 - Memory Management:

3. **`packages/core/src/core/client.ts`**
   - Check for memory/context management
   - Look for conversation history handling
   - Implement refresh if needed

4. **Provider-specific memory handling**
   - Check if providers have memory limits
   - Implement provider-aware memory management
   - Handle context window limits

## Specific Changes Needed

### If Memory Refresh is Missing:

1. Add `/memory` command to show current usage
2. Add `/refresh` command to clear context
3. Implement memory tracking in client

### If Partially Implemented:

1. Complete the implementation
2. Wire up UI components
3. Test with each provider

### Memory Tracking Implementation:

```typescript
// Example structure:
interface MemoryStats {
  tokensUsed: number;
  maxTokens: number;
  messageCount: number;
  provider: string;
}
```

## Verification Steps

1. Test memory-related commands
2. Verify memory stats are accurate
3. Test refresh functionality
4. Check memory limits per provider
5. Ensure no memory leaks

## Dependencies

- Tasks 01, 02, and 03 must be complete
- Provider integration must work

## Estimated Time

30 minutes

## Notes

- Memory exhaustion was noted in test suite
- This might be related to context management
- Consider provider-specific token limits
- May need to implement sliding window for long conversations
