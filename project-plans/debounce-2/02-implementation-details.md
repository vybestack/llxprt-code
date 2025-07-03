# Implementation Details

## Code Changes

### 1. SessionContext.tsx Refactoring

```typescript
// Before - Problematic pattern
const flush = () => {
  if (queuedMetadataRef.current.length === 0) return;
  // ... flush logic
};

// After - Stable pattern
const flushRef = useRef<(() => void) | null>(null);
const isFlushingRef = useRef(false);

// Update ref with latest implementation
flushRef.current = () => {
  if (isFlushingRef.current || queuedMetadataRef.current.length === 0) return;
  isFlushingRef.current = true;

  try {
    const metadata = [...queuedMetadataRef.current];
    queuedMetadataRef.current = [];

    setStats((prev) => ({
      ...prev,
      aggregatedUsageMetadata: metadata,
      lastUpdated: Date.now(),
    }));
  } finally {
    isFlushingRef.current = false;
  }
};

// Expose stable callback
const flush = useCallback(() => {
  flushRef.current?.();
}, []);
```

### 2. AddUsage Function Updates

```typescript
const addUsage = useCallback(
  (metadata: UsageMetadata) => {
    // Prevent queuing during flush
    if (isFlushingRef.current) return;

    queuedMetadataRef.current.push(metadata);

    // Clear existing timer
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }

    // Schedule new flush
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null; // Clear reference
      flush();
    }, DEBOUNCE_DELAY);
  },
  [flush],
); // Now stable due to useCallback on flush
```

### 3. Cleanup on Unmount

```typescript
useEffect(() => {
  return () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Flush any remaining metadata
    if (queuedMetadataRef.current.length > 0) {
      flushRef.current?.();
    }
  };
}, []);
```

## Testing Approach

### 1. Stress Test for Maximum Update Depth

```typescript
it('should handle rapid updates without maximum update depth errors', async () => {
  const { result } = renderHook(() => useSessionStats(), {
    wrapper: SessionStatsProvider,
  });

  // Simulate rapid fire events
  for (let i = 0; i < 100; i++) {
    act(() => {
      result.current.addUsage({
        promptTokenCount: i,
        candidatesTokenCount: i,
        totalTokenCount: i * 2,
      });
    });
  }

  // Wait for debounce
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Verify no errors and correct aggregation
  expect(result.current.stats.aggregatedUsageMetadata).toHaveLength(100);
});
```

### 2. Verify Debouncing Behavior

```typescript
it('should properly debounce multiple updates', async () => {
  const { result } = renderHook(() => useSessionStats());

  // Add multiple updates within debounce window
  act(() => {
    result.current.addUsage(metadata1);
    result.current.addUsage(metadata2);
    result.current.addUsage(metadata3);
  });

  // Verify not updated immediately
  expect(result.current.stats.aggregatedUsageMetadata).toHaveLength(0);

  // Advance past debounce
  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  // Verify all updates batched
  expect(result.current.stats.aggregatedUsageMetadata).toHaveLength(3);
});
```

## Migration Steps

1. **Update SessionContext.tsx** with new debouncing pattern
2. **Run existing tests** to ensure no regressions
3. **Add new stress tests** for the fixed behavior
4. **Update useGeminiStream tests** if needed
5. **Deploy and monitor** for any edge cases

## Rollback Plan

If issues arise:

1. Revert SessionContext.tsx changes
2. Re-examine the approach
3. Consider alternative debouncing libraries if needed
