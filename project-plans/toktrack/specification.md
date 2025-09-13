# Feature Specification: Token Usage Tracking Enhancement

## Purpose

The purpose of this feature is to enhance token usage tracking in LLxprt Code by adding metrics for tokens per minute (TPM) average rates, and throttling wait times due to 429 errors. This will provide users with more granular insight into their token consumption patterns and help identify performance bottlenecks.

## Architectural Decisions

- **Pattern**: Decorator pattern for wrapping provider functionality with metrics tracking
- **Technology Stack**: TypeScript, Node.js, React Ink
- **Data Flow**: Metrics are collected at the provider level during API calls and aggregated for display
- **Integration Points**: ProviderManager, ProviderPerformanceTracker, LoggingProviderWrapper, telemetry system, UI footer, stats display, and diagnostics command

## Project Structure

```
src/
  providers/
    types.ts # Enhanced ProviderPerformanceMetrics interface
    logging/
      ProviderPerformanceTracker.ts # Updated to track additional metrics
  telemetry/
    types.ts # Enhanced telemetry event types
    metrics.ts # Updated to track new metrics
    loggers.ts # Updated to record new metrics
    uiTelemetry.ts # Enhanced to include new metrics in session summary
  cli/
    ui/
      components/
        Footer.tsx # Updated to display token metrics
        StatsDisplay.tsx # Updated to show additional metrics
      commands/
        diagnosticsCommand.ts # Updated to include detailed token tracking info
```

## Technical Environment

- **Type**: CLI Tool
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - @opentelemetry/api: ^1.9.0
  - React Ink for UI components
  - Other existing LLxprt Code dependencies

## Integration Points

### Existing Code That Will Use This Feature

- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Will track token rates and throttling times
- `packages/core/src/providers/ProviderManager.ts` - Will accumulate token usage per session
- `packages/core/src/providers/LoggingProviderWrapper.ts` - Will collect token metrics during API calls
- `packages/core/src/telemetry/loggers.ts` - Will record new metrics with each API response
- `packages/core/src/telemetry/uiTelemetry.ts` - Will aggregate metrics for UI display
- `packages/cli/src/ui/components/Footer.tsx` - Will display real-time token metrics
- `packages/cli/src/ui/components/StatsDisplay.tsx` - Will display session summary metrics
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` - Will show detailed token data in diagnostics output

### Existing Code To Be Replaced

- `packages/core/src/providers/types.ts` - ProviderPerformanceMetrics interface to be enhanced
- Existing token tracking implementation will be extended rather than replaced

### User Access Points

- Real-time display in CLI footer during conversation
- Session summary stats shown when session ends
- Detailed diagnostics via `/diagnostics` command

### Migration Requirements

- No significant migration needed as we're extending existing metrics
- UI components will be updated to display new metrics

## Formal Requirements

[REQ-001] Token Usage Rate Tracking
  [REQ-001.1] Track tokens per minute (TPM) average rate
  [REQ-001.2] Track cumulative token usage per session
  
[REQ-002] Throttling Metrics
  [REQ-002.1] Track explicit wait periods due to 429 errors
  [REQ-002.2] Record cumulative throttling wait time per session

[REQ-003] UI Integration
  [REQ-003.1] Display token rates in footer component
  [REQ-003.2] Include token metrics in session statistics display
  [REQ-003.3] Add token tracking information to diagnostics command output

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Enhance ProviderPerformanceMetrics interface with new fields
  [REQ-INT-001.2] Update ProviderPerformanceTracker to calculate and store token rates
  [REQ-INT-001.3] Extend telemetry system to collect and emit new metrics
  [REQ-INT-001.4] Modify UI components to display new metrics appropriately

## Data Schemas

```typescript
// Enhanced token metrics
interface ProviderPerformanceMetrics {
  providerName: string;
  totalRequests: number;
  totalTokens: number;
  averageLatency: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
  chunksReceived: number;
  errorRate: number;
  errors: Array<{ timestamp: number; duration: number; error: string }>;
  // Newly added metrics:
  tokensPerMinute: number; // Rolling average tokens per minute
  throttleWaitTimeMs: number; // Cumulative throttling wait time
  sessionTokenUsage: {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  }; // Cumulative session token tracking
}

// Enhanced telemetry event
interface EnhancedTokenMetricsEvent {
  tokens_per_minute: number;
  throttle_wait_time_ms: number;
  session_token_usage: {
    input: number;
    output: number;
    cache: number;
    tool: number;
    thought: number;
    total: number;
  };
}
```

## Example Data

```json
{
  "tokensPerMinute": 4500,
  "throttleWaitTimeMs": 12000,
  "sessionTokenUsage": {
    "input": 15000,
    "output": 22000,
    "cache": 5000,
    "tool": 3000,
    "thought": 1000,
    "total": 46000
  }
}
```

## Constraints

- Token metrics tracking must not significantly impact performance
- TPM calculation should use rolling window approach
- Integration with existing telemetry systems must be seamless

## Performance Requirements

- TPM calculation should be lightweight and not block API responses
- UI updates with token metrics should not cause noticeable lag
- Memory usage for tracking metrics should remain within reasonable limits