# Migration of Existing Telemetry Systems

This phase details how existing telemetry systems will be updated to work with the token tracking enhancement.

## Migration Requirements

### 1. Token Usage Metrics
/**
 * @plan PLAN-20250909-TOKTRACK.P10
 * @requirement REQ-003
 */

- Update `recordTokenUsageMetrics` function in /packages/core/src/telemetry/metrics.ts
- Add tracking for new token types (cache, tool, thought)
- Ensure backward compatibility with existing token tracking

### 2. UI Telemetry Service
/**
 * @plan PLAN-20250909-TOKTRACK.P10
 * @requirement REQ-001, REQ-003
 */

- Update `ModelMetrics` interface in /packages/core/src/telemetry/uiTelemetry.ts
- Add tokensPerMinute field to model metrics
- Add throttleWaitTimeMs field to model metrics
- Add sessionTokenUsage object to SessionMetrics interface
- Update `processApiResponse` method to handle new token tracking data

### 3. Loggers
/**
 * @plan PLAN-20250909-TOKTRACK.P10
 * @requirement REQ-001, REQ-002, REQ-003
 */

- Update `logApiResponse` function in /packages/core/src/telemetry/loggers.ts
- Add tracking for tokens per minute
- Add tracking for throttle wait times
- Add tracking for session token usage

## Data Migration Approach

### Backward Compatibility
- New fields will have appropriate default values (0 for counts, null for wait times)
- Existing telemetry functions will continue to work unchanged
- New tracking will be additive to existing metrics

### Testing Requirements
- Existing telemetry tests should continue to pass
- New tests for token tracking metrics should be added
- Integration tests with UI components should verify proper metric display