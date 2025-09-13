# Domain Analysis: Token Usage Tracking Enhancement

## Entity Relationships

```
ProviderManager <>-- ProviderPerformanceTracker : contains
ProviderManager --> SessionTokenAccumulator : uses
ProviderPerformanceTracker --> TokenRateCalculator : calculates
LoggingProviderWrapper --> TokenMetricsCollector : collects
TokenMetricsCollector --> TelemetrySystem : emits
TelemetrySystem --> UiTelemetryService : updates
UiTelemetryService --> StatsDisplay : provides
StatsDisplay --> Footer : displays
```

## State Transitions

1. **ProviderPerformanceTracker**:
   - Initial state: metrics initialized to zero
   - During API response: metrics updated with token counts and timing information
   - When recording completion: TPM averages recalculated, session totals incremented

2. **SessionTokenAccumulator** (part of ProviderManager):
   - Initial state: all token type counts at zero
   - As API responses complete: token counts incremented based on response data
   - Reset state: token counts reset to zero when session ends or context is cleared

## Business Rules

1. Tokens per minute (TPM) is calculated as a rolling average using timestamped data points
2. Only token generation time from LLM API calls contributes to TPM calculation
3. Throttling wait times are captured from retry mechanisms when 429 errors occur
4. Session token usage tracks all token types: input, output, cache, tool, and thoughts
5. UI components display metrics in a user-friendly format without exposing internal calculations

## Edge Cases

1. Very short API calls that don't span a full minute
2. Multiple providers used in the same session
3. Disconnected periods when no API calls are made
4. Long throttling wait times that significantly impact average rates
5. Zero token responses from models

## Error Scenarios

1. Missing telemetry initialization preventing metrics recording
2. Invalid token counts returned from model APIs
3. Time synchronization issues affecting rate calculations
4. Memory overflow when storing historical token data for rate calculations