# REIMPLEMENT Playbook: cfdc4cf — Fix race condition by awaiting scheduleToolCalls

## Upstream Change Summary

Upstream fixed a race condition where tool scheduling was not properly awaited, causing history ordering issues:

1. **`scheduleToolCalls` return type changed**: From `void` to `Promise<void>`
2. **All `scheduleToolCalls` calls are now awaited**: In `useGeminiStream.ts`
3. **`useReactToolScheduler` schedule function**: Returns the promise from `scheduler.schedule()`
4. **Test updates**: Tests modified to properly await the schedule function

## LLxprt Current State

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

LLxprt has deduplication logic before scheduling tool calls:
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

LLxprt ALREADY awaits `scheduleToolCalls`! This was likely adapted from an earlier version.

**File**: `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

The `schedule` function returns `Promise<void>`:
```typescript
const schedule: ScheduleFn = useCallback(
  (request, signal) => {
    // ...code...
    return scheduler.schedule(normalizedRequest, signal).catch(() => {
      // Silently ignore cancellation rejections
    });
  },
  [scheduler],
);
```

**Type definition**:
```typescript
export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => Promise<void>;
```

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/cli/src/ui/hooks/useGeminiStream.ts`

**ALREADY DONE** - LLxprt already awaits `scheduleToolCalls` in both locations:
- In `prepareQueryForGemini` for the `schedule_tool` result
- In `processGeminiStreamEvents` for tool call requests

**Verification only** - Confirm the await is in place.

#### 2. `packages/cli/src/ui/hooks/useReactToolScheduler.ts`

**ALREADY DONE** - The `schedule` function already returns a Promise.

**Verification only** - Confirm the return type is `Promise<void>`.

#### 3. `packages/cli/src/ui/hooks/useToolScheduler.test.ts`

Update tests to properly await the schedule function. Check if tests are already correct.

## Files to Read

- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts`
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts`

## Files to Modify

- Possibly `packages/cli/src/ui/hooks/useToolScheduler.test.ts` if tests need updates

## Specific Verification

1. Run tests: `npm run test -- packages/cli/src/ui/hooks/useToolScheduler.test.ts`
2. Verify all tests pass with proper async handling
3. Check that `scheduleToolCalls` is awaited in all locations in `useGeminiStream.ts`

## Notes

This commit appears to be **already implemented** in LLxprt. The adaptation may only require test verification. The key indicator is that `ScheduleFn` type already returns `Promise<void>` and the calls are already awaited.
