# Integration with Provider Implementations

This phase details integration of the token tracking enhancement with the actual provider implementations where API calls are made.

## Integration Points by Provider

### 1. Gemini Provider (/packages/core/src/providers/gemini/GeminiProvider.ts)
/**
 * @plan PLAN-20250909-TOKTRACK.P09
 * @requirement REQ-001, REQ-002, REQ-003
 * @pseudocode lines 12-18, 21-26
 */

- Modify `generateChatCompletion` method to track tokens per minute
- Modify `invokeServerTool` method to track token usage
- Add token extraction from API responses
- Add session token accumulation calls
- Add throttle wait time tracking integration

### 2. OpenAI Provider (/packages/core/src/providers/openai/OpenAIProvider.ts)
/**
 * @plan PLAN-20250909-TOKTRACK.P09
 * @requirement REQ-001, REQ-002, REQ-003
 */

- Modify `generateChatCompletionImpl` method to track tokens per minute
- Add token extraction from API responses
- Add session token accumulation calls
- Add throttle wait time tracking integration

### 3. Anthropic Provider (/packages/core/src/providers/anthropic/AnthropicProvider.ts)
/**
 * @plan PLAN-20250909-TOKTRACK.P09
 * @requirement REQ-001, REQ-002, REQ-003
 */

- Modify `generateChatCompletion` method to track tokens per minute
- Add token extraction from API responses
- Add session token accumulation calls
- Add throttle wait time tracking integration

## Implementation Requirements

### Token Tracking Requirements
- Extract token usage from API responses
- Track tokens per minute for each provider
- Accumulate session token usage across providers

### Throttling Requirements
- Track explicit wait times from Retry-After headers
- Track exponential backoff delays
- Accumulate throttle wait time per provider

### Session Metrics Requirements
- Implement session token usage accumulation
- Track input, output, cache, tool, and thought tokens separately