# Feature Specification: Token Usage Tracking Enhancement

## Purpose

To enhance LLxprt Code's token usage tracking to provide comprehensive metrics including:
1. Tokens per minute (TPM) tracking
2. Session cumulative token usage
3. Throttling wait time due to 429 errors
4. Requests per minute (RPM) tracking

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
packages/cli/src/ui/components/
  Footer.tsx # Enhanced to display TPM and session tokens
packages/cli/src/ui/commands/
  diagnosticsCommand.ts # Enhanced to show token tracking information
packages/cli/src/ui/components/
  StatsDisplay.tsx # Enhanced to show token tracking in summary
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

- `/packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Will track tokens per minute and session tokens
- `/packages/core/src/providers/ProviderManager.ts` - Will accumulate session token usage
- `/packages/core/src/providers/LoggingProviderWrapper.ts` - Will log enhanced token metrics
- `/packages/core/src/utils/retry.ts` - Will capture 429 wait times
- `/packages/core/src/telemetry/loggers.ts` - Will output enhanced metrics
- `/packages/cli/src/ui/components/Footer.tsx` - Will display TPM and session tokens
- `/packages/cli/src/ui/commands/diagnosticsCommand.ts` - Will show token tracking information
- `/packages/cli/src/ui/components/StatsDisplay.tsx` - Will include token tracking in summary

### Existing Code To Be Replaced

- `/packages/core/src/providers/logging/ProviderPerformanceTracker.ts` - Enhanced with new metrics
- `/packages/core/src/providers/ProviderManager.ts` - Enhanced to include session token accumulation
- `/packages/core/src/providers/LoggingProviderWrapper.ts` - Updated to collect token metrics during API calls
- `/packages/cli/src/ui/components/Footer.tsx` - Enhanced to display token metrics
- `/packages/cli/src/ui/commands/diagnosticsCommand.ts` - Enhanced with token tracking information
- `/packages/cli/src/ui/components/StatsDisplay.tsx` - Enhanced to include token tracking

### User Access Points

- Enhanced footer in UI showing TPM and session token usage
- Enhanced diagnostics command output showing token metrics
- Enhanced session summary dialog showing token tracking metrics

### Migration Requirements

- Existing token tracking metrics in ProviderPerformanceTracker need to be extended
- ProviderManager's token handling requires enhancement
- Telemetry output format may need adjustment to include new metrics
- Any integration tests that validate token tracking need updating
- Existing footer UI needs enhancement to show new metrics

## Formal Requirements

[REQ-001] Token Usage Metrics Enhancement
  [REQ-001.1] Track tokens per minute (TPM) rate for each provider
  [REQ-001.2] Track cumulative session token usage (input, output, tool, thought)
  [REQ-001.3] Record cumulative throttle wait time from 429 errors
  [REQ-001.4] Track requests per minute in addition to token metrics
  [REQ-001.5] Display TPM and session token count in footer UI responsively
  [REQ-001.6] Show token metrics in diagnostics command output
  [REQ-001.7] Show token metrics in session summary dialog
  [REQ-001.8] Implement in-memory storage for all token tracking metrics

## Data Schemas

```typescript
// Enhanced ProviderPerformanceMetrics interface
const ProviderPerformanceMetricsSchema = z.object({
  providerName: z.string(),
  totalRequests: z.number(),
  totalTokens: z.number(),
  averageLatency: z.number(),
  timeToFirstToken: z.number().nullable(),
  tokensPerMinute: z.number(), // Track tokens per minute
  sessionTokenUsage: z.object({
    input: z.number(),
    output: z.number(),
    tool: z.number(),
    thought: z.number(),
    total: z.number(),
  }), // Cumulative tracking for session
  requestsPerMinute: z.number(), // Track requests per minute
  throttleWaitTimeMs: z.number(), // Cumulative 429 wait time
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
    "tokensPerMinute": 12000,
    "sessionTokenUsage": {
      "input": 12000,
      "output": 52000,
      "tool": 0,
      "thought": 0,
      "total": 64000
    },
    "requestsPerMinute": 15,
    "throttleWaitTimeMs": 15000,
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
- TPM calculations should be responsive and updated in real-time