# REIMPLEMENT Playbook: 0bebc66 — fix(ui): flush rationale before scheduling tool calls

## Upstream Change Summary

Upstream fixed a race condition where the model's rationale text was not displayed before tool calls were scheduled:

1. **Added flush before scheduling**: In `processGeminiStreamEvents`, flush `pendingHistoryItem` before calling `scheduleToolCalls`
2. **Added dependency array entries**: `addItem`, `pendingHistoryItemRef`, `setPendingHistoryItem` added to useCallback dependencies

**The fix**:
```typescript
if (toolCallRequests.length > 0) {
  // Flush pending text rationale before scheduling tool calls
  if (pendingHistoryItemRef.current) {
    addItem(pendingHistoryItemRef.current, userMessageTimestamp);
    setPendingHistoryItem(null);
  }
  await scheduleToolCalls(toolCallRequests, signal);
}
```

## LLxprt Current State

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

LLxprt already has deduplication logic before scheduling:
```typescript
if (toolCallRequests.length > 0) {
  // Issue #1040: Deduplicate tool call requests by callId
  const seenCallIds = new Set<string>();
  const dedupedToolCallRequests = toolCallRequests.filter((request) => {
    if (seenCallIds.has(request.callId)) {
      return false;
    }
    seenCallIds.add(request.callId);
    return true;
  });

  if (dedupedToolCallRequests.length > 0) {
    await scheduleToolCalls(dedupedToolCallRequests, signal);
  }
}
```

**LLxprt does NOT have the flush logic before scheduling!**

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/cli/src/ui/hooks/useGeminiStream.ts`

Add the flush logic before scheduling tool calls:

```typescript
if (toolCallRequests.length > 0) {
  // Issue #1040: Deduplicate tool call requests by callId
  const seenCallIds = new Set<string>();
  const dedupedToolCallRequests = toolCallRequests.filter((request) => {
    if (seenCallIds.has(request.callId)) {
      return false;
    }
    seenCallIds.add(request.callId);
    return true;
  });

  if (dedupedToolCallRequests.length > 0) {
    // Fix: Flush pending text rationale before scheduling tool calls
    // This ensures correct history order - rationale appears before tool results
    if (pendingHistoryItemRef.current) {
      addItem(pendingHistoryItemRef.current, userMessageTimestamp);
      setPendingHistoryItem(null);
    }
    await scheduleToolCalls(dedupedToolCallRequests, signal);
  }
}
```

**Note**: Add the flush AFTER deduplication but BEFORE `scheduleToolCalls`.

#### 2. Update `processGeminiStreamEvents` useCallback dependencies

Add the missing dependencies to the useCallback:
```typescript
const processGeminiStreamEvents = useCallback(
  async (
    stream: AsyncIterable<GeminiEvent>,
    userMessageTimestamp: number,
    signal: AbortSignal,
  ): Promise<StreamProcessingStatus> => {
    // ...
  },
  [
    // ... existing dependencies
    addItem,
    pendingHistoryItemRef,
    setPendingHistoryItem,
  ],
);
```

#### 3. `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

Add test for the fix:
```typescript
it('should flush pending text rationale before scheduling tool calls to ensure correct history order', async () => {
  const addItemOrder: string[] = [];

  mockAddItem.mockImplementation((item: any) => {
    addItemOrder.push(`addItem:${item.type}`);
  });

  // Mock scheduleToolCalls to capture when it's called
  const mockScheduleToolCalls = vi.fn(async (requests) => {
    addItemOrder.push('scheduleToolCalls_START');
    // ... simulate tool completion
    addItemOrder.push('scheduleToolCalls_END');
  });

  // ... setup test with rationale followed by tool call

  const rationaleIndex = addItemOrder.indexOf('addItem:gemini');
  const scheduleIndex = addItemOrder.indexOf('scheduleToolCalls_START');

  expect(rationaleIndex).toBeGreaterThan(-1);
  expect(scheduleIndex).toBeGreaterThan(-1);

  // Core fix: Rationale comes before tools are scheduled
  expect(rationaleIndex).toBeLessThan(scheduleIndex);
});
```

## Files to Read

- `packages/cli/src/ui/hooks/useGeminiStream.ts`

## Files to Modify

- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

## Specific Verification

1. Run tests: `npm run test -- packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
2. Manual: Test with a query that produces both rationale and tool calls
3. Verify history order: Rationale should appear before tool results

## Integration with LLxprt Deduplication

The fix integrates cleanly with LLxprt's deduplication logic:
1. Deduplicate tool calls first (LLxprt-specific)
2. Flush pending rationale (upstream fix)
3. Schedule tool calls

This preserves both the deduplication fix (#1040) and the history ordering fix.
