# Fix Debounce Architecture

## Problem Summary

The current debouncing implementation in SessionContext causes "Maximum update depth exceeded" errors due to unstable function references and circular state updates during React's rendering cycle.

## Root Causes

1. Unstable `flush` function reference being reassigned on every render
2. Circular dependency between state updates and effect triggers
3. Missing safeguards against recursive flushes
4. Improper handling of React's lifecycle constraints

## Solution Overview

Implement a stable debouncing architecture that works within React's constraints by:

- Using stable function references with `useCallback`
- Implementing the ref pattern for accessing latest closures
- Adding safeguards against recursive updates
- Properly managing timer lifecycles

## Implementation Steps

### 1. Refactor SessionContext Debouncing

- Move flush implementation to ref while exposing stable callback
- Ensure all exposed functions use `useCallback` with empty deps
- Add `isFlushingRef` to prevent recursive flushes
- Clear timer references after execution

### 2. Add Safeguards

- Prevent queuing during flush operations
- Add early return if already flushing
- Ensure timer cleanup on unmount
- Add proper error boundaries

### 3. Update Tests

- Add tests for rapid successive updates
- Verify no maximum update depth errors
- Test debouncing behavior under stress
- Ensure proper cleanup on unmount

### 4. Verify Integration

- Test with real Gemini streaming responses
- Verify usage events are properly batched
- Ensure no performance regressions
- Check memory usage patterns

## Success Criteria

- No "Maximum update depth exceeded" errors
- Usage events properly debounced (500ms)
- Stable performance under rapid updates
- All existing functionality preserved
- Clean test suite with no warnings
