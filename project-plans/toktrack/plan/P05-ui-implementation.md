# Phase 3: Throttling Integration

## Duration
1 day

## Goals
- Capture throttling wait times in retry system
- Integrate throttle tracking with ProviderPerformanceTracker

## Tasks

### Task 3.1: Enhance retry system
- Modify retryWithBackoff to track explicit delay durations for 429 errors
- Add trackThrottleWaitTime function to record wait times with active provider tracker

### Task 3.2: Update LoggingProviderWrapper
- Add extractTokenCountsFromResponse method to parse token usage from API responses
- Update logResponse to extract token counts and accumulate session usage

## Deliverables
- Enhanced retry system with throttle wait time tracking
- Updated LoggingProviderWrapper with token extraction and accumulation