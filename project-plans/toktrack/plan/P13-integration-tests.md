# Integration Testing Plan

This phase details the integration testing required to verify that all components work together correctly.

## Test Requirements

/**
 * @plan PLAN-20250909-TOKTRACK.P13
 * @requirement REQ-INT-001
 */

### 1. Provider-to-Tracker Integration
- Verify each provider implementation correctly calls ProviderPerformanceTracker methods
- Verify token counts are properly extracted from API responses
- Verify throttle wait times are correctly sent to ProviderPerformanceTracker

### 2. Tracker-to-Telemetry Integration
- Verify ProviderPerformanceTracker correctly updates telemetry metrics
- Verify tokens per minute calculation is accurate
- Verify cumulative session token tracking works

### 3. Telemetry-to-UI Integration
- Verify UI telemetry service properly receives new metrics
- Verify footer displays new metrics correctly
- Verify stats display shows proper breakdown of token usage
- Verify diagnostics command outputs all metrics

### 4. Retry-to-Tracker Integration
- Verify retry system correctly records throttle wait times
- Verify explicit Retry-After delays are captured
- Verify exponential backoff delays are captured

## Implementation Steps

### API Response Token Extraction Tests
- Create test API responses with token count headers/fields
- Verify token extraction methods work with various provider formats
- Verify session token accumulation works for all token types

### Throttle Wait Time Tests
- Create mock 429 errors with Retry-After headers
- Verify retry system accumulates explicit wait times
- Create mock 429 errors without headers
- Verify retry system accumulates backoff wait times

### Tokens Per Minute Calculation Tests
- Create time-stamped token usage events
- Verify TPM calculation correctly filters events within 60 seconds
- Verify TPM updates properly with new events
- Verify TPM resets properly when events expire

### UI Component Tests
- Verify footer correctly formats and displays TPM and throttle wait times
- Verify stats display shows detailed token usage breakdown
- Verify diagnostics command includes all new metrics in output

### End-to-End Integration Tests
- Test complete flow from API response to UI display
- Test session token accumulation across multiple provider calls
- Test throttle wait time accumulation during retries
- Verify metrics reset properly between sessions

## Integration Test Scenarios

### Scenario 1: Normal Conversation Flow
- Make API calls to various providers
- Verify token counts are extracted and recorded
- Verify TPM is calculated and updated
- Verify UI components display metrics correctly

### Scenario 2: Rate Limiting Flow
- Trigger 429 errors with various wait times
- Verify retry system accumulates wait times
- Verify ProviderPerformanceTracker records throttle wait times
- Verify UI displays updated throttle metrics

### Scenario 3: Session Reset Flow
- Start session with token tracking
- Verify metrics accumulate properly
- Reset session
- Verify metrics reset to zero