# Domain Model: Token Usage Tracking

## Entities

### ProviderPerformanceTracker
- Tracks performance metrics for each provider including token usage
- Maintains rolling calculations for tokens per minute
- Records throttle wait times from 429 errors
- Tracks requests per minute independently of token metrics

### ProviderManager
- Manages multiple providers
- Accumulates session token usage across all provider calls
- Provides access to token usage data for UI components

### TokenMetrics
- Represents token usage for a given time period
- Contains input, output, tool, and thought token counts
- Tracks cumulative session totals

## Relationships

```
ProviderManager "1" -- "many" ProviderPerformanceTracker : manages
ProviderPerformanceTracker -- TokenMetrics : tracks
Footer UI -- ProviderManager : displays session metrics
Diagnostics Command -- ProviderManager : shows session info
StatsDisplay -- ProviderManager : includes in summary
```

## State Transitions

### ProviderPerformanceTracker
1. Initialized with zero metrics
2. For each API call:
   - Increments request counter
   - Adds tokens to running total
   - Calculates tokens per minute based on elapsed time
   - Adds wait time when 429 errors occur
3. Metrics reset when session ends or explicitly requested

### ProviderManager
1. Initialized with empty session token counts
2. As providers make API calls:
   - Updates cumulative session token totals
   - Maintains requests per minute count
3. Session metrics provided to UI components on request

## Business Rules

1. Tokens per minute calculation:
   - Only counts actual provider performance time
   - Excludes approval or tool execution time
   - Includes 429 wait time in the calculation

2. Session token accumulation:
   - Input tokens: Count of tokens sent to provider
   - Output tokens: Count of tokens received from provider
   - Tool tokens: Count of tokens used in tool execution
   - Thought tokens: Count of tokens used in reasoning/thinking

3. Throttling wait time tracking:
   - Captured from retry mechanisms
   - Cumulative across entire session
   - Included in TPM calculation for real-time display

4. Requests per minute tracking:
   - Independent of token metrics
   - Tracks actual API requests initiated
   - Updated in real-time in footer display

## Edge Cases

1. Session with no API calls should display zero metrics
2. Very short sessions may have high instantaneous TPM values
3. Long sessions need rolling TPM calculations for relevance
4. Provider switches should maintain continuity in session metrics
5. 429 wait times during tool execution should be excluded from TPM
6. Disconnected IDE clients should not affect token tracking

## Error Scenarios

1. Provider API errors (non-429) should not affect TPM tracking
2. Failed token counting should not crash the application
3. Concurrent provider calls should properly accumulate session metrics
4. Memory overflow in tracking should gracefully degrade