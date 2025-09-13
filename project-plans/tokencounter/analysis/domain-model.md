# Domain Model Analysis: Token Usage Tracking

## Entity Relationships

```
[ProviderManager] --> manages --> [ProviderSession]
[ProviderSession] --> tracks --> [TokenUsageMetrics]
[ProviderPerformanceTracker] --> tracks --> [ProviderCallMetrics]
[ProviderCallMetrics] --> contributesTo --> [TokenUsageMetrics]
[BaseProviderLogger] --> logs --> [ProviderCallMetrics]
[RetryHandler] --> contributesTo --> [ThrottleWaitMetrics]
[ThrottleWaitMetrics] --> partOf --> [TokenUsageMetrics]
```

## State Transitions

### Provider Session State
1. **Initialized** - Session starts with zero token usage
2. **Accumulating** - Each provider call adds to session metrics
3. **Finalized** - Session metrics are completed and ready for reporting

### Token Tracking State
1. **Empty** - No metrics collected yet
2. **Collecting** - Tracking tokens per call
3. **Calculating** - Computing average and burst rates
4. **Reporting** - Including metrics in telemetry output

## Business Rules

1. **Metric Calculation Rule**: Tokens per second must be calculated as (tokensIn + tokensOut) / (durationMs / 1000)
2. **Burst Detection Rule**: Burst rate is the maximum tokens per second observed in a rolling 1-second window
3. **Session Accumulation Rule**: Each provider call adds its token counts to the session's cumulative totals
4. **Throttling Rule**: Wait times due to 429 errors must be captured and added to the session's throttling wait time
5. **Data Integrity Rule**: All token counts must be non-negative integers
6. **Performance Rule**: Metric tracking should add minimal overhead to API calls

## Edge Cases

1. **Zero Duration Calls**: Handling cases where durationMs is 0 (should not result in division by zero)
2. **Concurrent API Calls**: Ensuring session metrics are correctly updated when multiple calls happen simultaneously
3. **Long Sessions**: Efficiently tracking metrics over extended sessions without memory issues
4. **Provider Errors**: Distinguishing between calls that failed due to throttling vs other errors
5. **Partially Available Metrics**: Handling cases where cache/tool/thought tokens aren't available

## Error Scenarios

1. **Invalid Token Counts**: Provider returns negative or non-integer token values
2. **Missing Provider Information**: API response lacks token information
3. **Clock Skew**: System time changes affecting duration calculations
4. **Data Loss**: Session metrics fail to accumulate properly
5. **Memory Constraints**: Burst tracking uses excessive memory

## Technical Components

### ProviderPerformanceTracker
Responsible for tracking per-call metrics including:
- Duration of API calls
- Token counts (in/out)
- Rate calculations (per second)
- Burst detection
- Integration with logging systems

### ProviderManager
Responsible for session management:
- Creating and maintaining provider sessions
- Accumulating metrics across calls
- Providing cumulative token usage data

### RetryHandler
Responsible for handling 429 errors:
- Capturing wait times
- Returning throttling data to metrics system

### BaseProviderLogger
Responsible for telemetry output:
- Including token metrics in log entries
- Ensuring consistent reporting format

## Data Flow

1. Provider makes API call
2. ProviderPerformanceTracker records call metrics (duration, tokens)
3. RetryHandler captures throttling wait times if applicable
4. ProviderManager accumulates session metrics
5. BaseProviderLogger outputs telemetry with all metrics

## Validation Points

1. Token count values are positive integers
2. Duration values are positive numbers
3. Rate calculations are mathematically correct
4. Burst detection algorithm is functioning
5. Session accumulation is consistent
6. Throttling tracking integrates properly with retry logic

## Performance Considerations

1. Minimize overhead in ProviderPerformanceTracker
2. Efficient algorithms for rate/burst calculations
3. Memory-efficient session tracking
4. Thread-safe metric accumulation