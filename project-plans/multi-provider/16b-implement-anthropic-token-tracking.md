# Phase 16b – Implement Token Tracking for Anthropic Provider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement proper token tracking and context percentage display for Anthropic provider models, ensuring the status bar shows accurate context usage instead of always showing "100% context left".

## Deliverables

- Updated token limits for current Anthropic models
- Token tracking implementation in AnthropicProvider
- Usage event emission through GeminiCompatibleWrapper
- Tokenizer integration for accurate counting

## Checklist (implementer)

### Part A: Update Token Limits

- [ ] Update `packages/core/src/core/tokenLimits.ts`:
  - [ ] Add token limits for current Anthropic models (June 2025):
    - [ ] claude-3-opus-20240229: 200,000 tokens
    - [ ] claude-3-sonnet-20240229: 200,000 tokens
    - [ ] claude-3-haiku-20240307: 200,000 tokens
    - [ ] claude-3.5-sonnet-20240620: 200,000 tokens
    - [ ] claude-3.5-sonnet-20241022: 200,000 tokens
    - [ ] claude-3.5-haiku-20241022: 200,000 tokens
  - [ ] Keep existing model limits intact

### Part B: Implement Usage Tracking in Anthropic Provider

- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.ts`:
  - [ ] Modify stream creation to track usage:
    ```typescript
    const stream = await this.anthropic.messages.create({
      model: this.currentModel,
      messages,
      stream: true,
      max_tokens: 4096,
      // ... other options
    });
    ```
  - [ ] Track token usage from stream events:
    ```typescript
    // Anthropic sends usage in message_start event
    if (event.type === 'message_start') {
      this.currentUsage = event.message.usage;
    }
    // And updates in message_delta events
    if (event.type === 'message_delta' && event.usage) {
      this.currentUsage = event.usage;
    }
    ```

### Part C: Emit Usage Events through Wrapper

- [ ] Update `packages/core/src/providers/adapters/GeminiCompatibleWrapper.ts`:
  - [ ] Add handling for Anthropic usage format:
    ```typescript
    // Anthropic format: { input_tokens, output_tokens }
    // Convert to: { prompt_tokens, completion_tokens, total_tokens }
    if (message.usage && 'input_tokens' in message.usage) {
      message.usage = {
        prompt_tokens: message.usage.input_tokens,
        completion_tokens: message.usage.output_tokens,
        total_tokens: message.usage.input_tokens + message.usage.output_tokens,
      };
    }
    ```

### Part D: Add Anthropic Tokenizer Support

- [ ] Create `packages/cli/src/providers/tokenizers/AnthropicTokenizer.ts`:

  ```typescript
  export class AnthropicTokenizer implements ITokenizer {
    async countTokens(text: string, model: string): Promise<number> {
      // Anthropic uses a similar tokenizer to Claude
      // For now, use a rough estimate: ~4 characters per token
      // Or integrate @anthropic-ai/tokenizer if available
      return Math.ceil(text.length / 4);
    }
  }
  ```

- [ ] Research if Anthropic provides an official tokenizer library:
  - [ ] Check for `@anthropic-ai/tokenizer` or similar
  - [ ] If not available, document the estimation approach

### Part E: Update Provider Message Types

- [ ] Ensure Anthropic provider uses the updated ProviderMessage interface with usage field
- [ ] Map Anthropic's usage format to the common format

## Testing

- [ ] Test with various Anthropic models (claude-3.5-sonnet, claude-3-opus, etc.)
- [ ] Verify context percentage decreases as conversation progresses
- [ ] Test approaching token limits (200k tokens)
- [ ] Ensure usage tracking works with tool calls
- [ ] Compare tokenizer estimates with Anthropic's reported usage

## Self-verify

```bash
npm run typecheck
npm run lint
npm test -- tokenLimits
npm test -- AnthropicProvider
# Manual test: Start a conversation with Anthropic provider and verify context percentage updates
```

**STOP. Wait for Phase 16c verification.**
