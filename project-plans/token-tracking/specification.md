# Feature Specification: Token Usage Tracking Enhancement

## Purpose

To enhance LLxprt Code's token usage tracking to provide comprehensive metrics including:
1. Average tokens per second
2. Token bursts
3. Throttling wait time (429 errors/retry delays)
4. Session cumulative token usage (not just context window usage)

This feature will provide valuable insights into model performance and usage patterns for users, helping them better understand their token consumption and optimize their interactions with LLM providers.

## Architectural Decisions

- **Pattern**: Decorator pattern for logging wrapper, with metric tracking extension
- **Technology Stack**: 
  - TypeScript 5.x
  - Zod for validation
  - Node.js (used in core packages)
- **Data Flow**: 
  1. ProviderPerformanceTracker collects metrics during API calls
  2. ProviderManager accumulates session token usage
  3. LoggingProviderWrapper facilitates collection of token metrics during API calls
  4. Retry mechanisms capture 429 wait times
- **Integration Points**: 
  - ProviderManager with session-wide token accumulation
  - ProviderPerformanceTracker with new metric tracking fields
  - LoggingProviderWrapper with telemetry logging

## Project Structure

```
packages/core/src/providers/
  types.ts # Type definitions including ProviderPerformanceMetrics
  ProviderManager.ts # Enhanced to store cumulative token usage per session
  logging/
    ProviderPerformanceTracker.ts # Extended to track token rate over time and burst rates
  LoggingProviderWrapper.ts # Updated to collect token metrics during API calls
  utils/
    retry.ts # Capture 429 wait times to contribute to throttle wait time tracking
```

## Technical Environment

- **Type**: CLI Tool
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - TypeScript: ^5.0.0
  - Zod: ^3.22.0
  - Vitest: ^1.0.0

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- `/packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Will track tokens per second and burst rates
- `/packages/core/src/providers/ProviderManager.ts` - Will accumulate session token usage
- `/packages/core/src/providers/LoggingProviderWrapper.ts` - Will log enhanced token metrics
- `/packages/core/src/utils/retry.ts` - Will capture 429 wait times
- `/packages/core/src/telemetry/loggers.ts` - Will output enhanced metrics

### Existing Code To Be Replaced

- `/packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Enhanced with new metrics
- `/packages/core/src/providers/ProviderManager.ts` - Enhanced to include session token accumulation
- `/packages/core/src/providers/LoggingProviderWrapper.ts` - Updated to collect token metrics during API calls

### User Access Points

- Enhanced logging output in telemetry data
- Improved performance metrics displayed in logs
- Potential future CLI commands to query token usage data

### Migration Requirements

- Existing token tracking metrics in ProviderPerformanceTracker need to be extended
- ProviderManager's token handling requires enhancement
- Telemetry output format may need adjustment to include new metrics
- Any integration tests that validate token tracking need updating

## Formal Requirements

[REQ-001] Token Usage Metrics Enhancement
  [REQ-001.1] Track average tokens per second for each request
  [REQ-001.2] Track peak token generation rates (bursts) within short time windows
  [REQ-001.3] Track cumulative wait time due to 429 throttling errors
  [REQ-001.4] Track session-wide cumulative token usage including input, output, cache, tool and thought tokens
  [REQ-001.5] Maintain compatibility with existing token tracking systems

## Data Schemas

```typescript
// Enhanced ProviderPerformanceMetrics interface
const ProviderPerformanceMetricsSchema = z.object({
  providerName: z.string(),
  totalRequests: z.number(),
  totalTokens: z.number(),
  averageLatency: z.number(),
  timeToFirstToken: z.number().nullable(),
  tokensPerSecond: z.number(), // Average (updated each request)
  burstTokensPerSecond: z.number(), // Peak rate in short windows
  throttleWaitTimeMs: z.number(), // Cumulative 429 wait time
  sessionTokenUsage: z.object({
    input: z.number(),
    output: z.number(),
    cache: z.number(),
    tool: z.number(),
    thought: z.number(),
    total: z.number(),
  }), // Cumulative tracking for session
  chunksReceived: z.number(),
  errorRate: z.number(),
  errors: z.array(z.object({
    timestamp: z.number(),
    duration: z.number(),
    error: z.string(),
  })),
});

// ProviderManager token accumulation params
const TokenAccumulationSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache: z.number().optional(),
  tool: z.number().optional(),
  thought: z.number().optional(),
});
```

## Example Data

```json
{
  "ProviderPerformanceMetrics": {
    "providerName": "gemini",
    "totalRequests": 150,
    "totalTokens": 64000,
    "averageLatency": 1500,
    "timeToFirstToken": 200,
    "tokensPerSecond": 120,
    "burstTokensPerSecond": 350,
    "throttleWaitTimeMs": 15000,
    "sessionTokenUsage": {
      "input": 12000,
      "output": 52000,
      "cache": 0,
      "tool": 0,
      "thought": 0,
      "total": 64000
    },
    "chunksReceived": 1000,
    "errorRate": 0.1,
    "errors": [
      {
        "timestamp": 1700000000000,
        "duration": 2000,
        "error": "429 Too Many Requests"
      }
    ]
  },
  "TokenAccumulationExample": {
    "input": 80,
    "output": 150,
    "cache": 10,
    "tool": 25,
    "thought": 5
  }
}
```

## Constraints

- Must work with all existing LLM providers (Gemini, OpenAI, Anthropic)
- No external HTTP calls in unit tests
- All async operations must have timeouts
- Database transactions for multi-table operations (if applicable)
- Must follow existing token counting conventions

## Performance Requirements

- Token tracking metrics must not significantly impact API call performance
- Session cumulative token tracking should work efficiently for long sessions
- Burst rate tracking should be computed in real-time without significant overhead