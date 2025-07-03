# Validation Checklist

## Pre-Implementation

- [ ] Review current SessionContext implementation
- [ ] Identify all components using useSessionStats
- [ ] Document current behavior for comparison
- [ ] Set up monitoring for the error in development

## Implementation

- [ ] Apply the stable ref pattern to SessionContext
- [ ] Add isFlushingRef safeguard
- [ ] Update addUsage to prevent queuing during flush
- [ ] Ensure proper cleanup on unmount
- [ ] Verify all functions use useCallback appropriately

## Testing

- [ ] Run existing SessionContext tests
- [ ] Add stress test for rapid updates (100+ events)
- [ ] Test debouncing with various timing scenarios
- [ ] Verify no "Maximum update depth exceeded" errors
- [ ] Test cleanup on component unmount
- [ ] Test with real Gemini streaming responses

## Integration Testing

- [ ] Test with useGeminiStream hook
- [ ] Verify Footer component updates correctly
- [ ] Check performance with React DevTools Profiler
- [ ] Monitor memory usage during extended sessions
- [ ] Test with multiple concurrent streams

## Edge Cases

- [ ] Component unmounts during debounce timer
- [ ] Rapid mount/unmount cycles
- [ ] Multiple providers sending usage events
- [ ] Network interruptions during streaming
- [ ] Browser tab switching/backgrounding

## Performance Validation

- [ ] Measure render count before/after fix
- [ ] Check for memory leaks with heap snapshots
- [ ] Verify debouncing reduces state updates
- [ ] Ensure no unnecessary re-renders
- [ ] Profile with Chrome DevTools

## Production Readiness

- [ ] All tests passing
- [ ] No console warnings or errors
- [ ] Performance metrics acceptable
- [ ] Code reviewed by team
- [ ] Documentation updated

## Post-Deployment

- [ ] Monitor error logs for recurrence
- [ ] Track performance metrics
- [ ] Gather user feedback
- [ ] Document any edge cases found
