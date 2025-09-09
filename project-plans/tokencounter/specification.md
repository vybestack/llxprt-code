# Feature Specification: Token Usage Tracking Enhancement

## Purpose

The purpose of this feature is to enhance the token usage tracking capabilities in LLxprt Code to provide users with more comprehensive metrics. This will include tracking average tokens per second, token bursts, throttling wait time (429 errors/retry delays), and cumulative token usage across entire sessions (not just context window usage). By providing these metrics, users can better understand model performance and usage patterns.

## Architectural Decisions

- **Pattern**: Repository pattern for tracking data storage
- **Technology Stack**: TypeScript with strict typing, Vitest for testing
- **Data Flow**: Token usage data flows from provider API calls through tracking mechanisms to logging systems
- **Integration Points**: Provider APIs in `packages/core/src/providers/`

## Project Structure

```
src/
providers/
logging/
ProviderPerformanceTracker.ts # Token tracking functionality
ProviderManager.ts # Session token accumulation
test/
providers/
ProviderPerformanceTracker.spec.ts # Tests for token tracking
ProviderManager.spec.ts # Tests for session token accumulation
```

## Technical Environment
- **Type**: CLI Tool | IDE Extension
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - TypeScript 5.x
  - Vitest 1.x
  - Zod for schema validation

## Integration Points

### Existing Code That Will Use This Feature
- `packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Will be enhanced to track new metrics
- `packages/core/src/providers/ProviderManager.ts` - Will accumulate session token usage
- `packages/core/src/providers/logging/BaseProviderLogger.ts` - Will include the new metrics in telemetry
- `packages/core/src/providers/retry.ts` - Will capture 429 wait times

### Existing Code To Be Replaced
- Current token tracking in `ProviderPerformanceTracker.ts` will be enhanced, not replaced
- Token usage accumulation in `ProviderManager.ts` will be extended with new methods
- Telemetry logging in `BaseProviderLogger.ts` will be updated to include new metrics

### User Access Points
- Telemetry output in log files
- UI telemetry display (to be implemented)
- Provider performance reports

### Migration Requirements
- Existing token tracking data structures need to be extended
- Telemetry output formats need to be updated
- Tests for existing provider logging need to be updated

## Formal Requirements
[REQ-001] Token Usage Tracking
  [REQ-001.1] Track average tokens per second
  [REQ-001.2] Track token bursts (peak rate in short time windows)
  [REQ-001.3] Track throttling wait time due to 429 errors
  [REQ-001.4] Track cumulative session token usage (input, output, cache, tool, thought)
[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Enhance ProviderPerformanceTracker with new metrics
  [REQ-INT-001.2] Extend ProviderManager to accumulate session tokens
  [REQ-INT-001.3] Update logging systems to include new metrics in output
  [REQ-INT-001.4] Capture wait times from retry system for 429 tracking

## Data Schemas

```typescript
// Provider performance metrics including new token tracking
const ProviderPerformanceMetricsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  timestamp: z.date(),
  durationMs: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  tokensPerSecond: z.number(),
  burstTokensPerSecond: z.number(),
  throttleWaitTimeMs: z.number(),
  sessionTokenUsage: z.object({
    input: z.number(),
    output: z.number(),
    cache: z.number().optional(),
    tool: z.number().optional(),
    thought: z.number().optional(),
    total: z.number()
  })
});
```

## Example Data

```json
{
  "tokenMetrics": {
    "tokensIn": 1250,
    "tokensOut": 875,
    "tokensPerSecond": 350,
    "burstTokensPerSecond": 750,
    "throttleWaitTimeMs": 2500,
    "sessionTokenUsage": {
      "input": 10500,
      "output": 7200,
      "cache": 3500,
      "tool": 1200,
      "thought": 2500,
      "total": 24900
    }
  }
}
```

## Constraints

- All token metrics must be tracked without significantly impacting performance
- 429 wait time tracking must integrate with existing retry logic
- Session token usage must accumulate accurately across multiple provider calls
- No external HTTP calls in unit tests

## Performance Requirements

- Token tracking overhead should be < 5ms per API call
- Rolling average calculations should be efficient
- Burst detection should use minimal memory
- Cumulative tracking should be thread-safe