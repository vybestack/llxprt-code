# Phase 08b – Implement Token Tracking for OpenAI Provider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement proper token tracking and context percentage display for OpenAI provider models, ensuring the status bar shows accurate context usage instead of always showing "100% context left".

## Deliverables

- Updated token limits for current OpenAI models
- Token tracking implementation in OpenAIProvider
- Usage event emission through GeminiCompatibleWrapper
- Tokenizer integration for accurate counting

## Checklist (implementer)

### Part A: Update Token Limits

- [ ] Update `packages/core/src/core/tokenLimits.ts`:
  - [ ] Add token limits for current OpenAI models:
    - [ ] o4-mini: 128,000 tokens
    - [ ] o3: 200,000 tokens
    - [ ] o3-mini: 200,000 tokens
    - [ ] gpt-4.1: 128,000 tokens
    - [ ] gpt-4o: 128,000 tokens
    - [ ] gpt-4o-mini: 128,000 tokens
  - [ ] Keep existing Gemini model limits intact

### Part B: Implement Usage Tracking in OpenAI Provider

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Modify stream creation to include usage tracking:
    ```typescript
    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      // ... other options
    });
    ```
  - [ ] Track cumulative token usage during streaming
  - [ ] Store usage data when received in stream chunks

### Part C: Emit Usage Events through Wrapper

- [ ] Update `packages/core/src/providers/adapters/GeminiCompatibleWrapper.ts`:
  - [ ] Add handling for usage metadata in provider messages:
    ```typescript
    // Check for usage data in provider message
    if (message.usage) {
      const usageEvent: ServerGeminiUsageMetadataEvent = {
        type: GeminiEventType.UsageMetadata,
        value: {
          promptTokenCount: message.usage.prompt_tokens,
          candidatesTokenCount: message.usage.completion_tokens,
          totalTokenCount: message.usage.total_tokens,
        },
      };
      yield usageEvent;
    }
    ```
  - [ ] Ensure usage events are emitted after content/tool events

### Part D: Add Tokenizer Support

- [ ] Install tokenizer dependency:

  ```bash
  cd packages/cli
  npm install @dqbd/tiktoken
  ```

- [ ] Create tokenizer utilities:
  - [ ] Create `packages/cli/src/providers/tokenizers/ITokenizer.ts`:
    ```typescript
    export interface ITokenizer {
      countTokens(text: string, model: string): Promise<number>;
    }
    ```
  - [ ] Create `packages/cli/src/providers/tokenizers/OpenAITokenizer.ts`:

    ```typescript
    import { encoding_for_model } from '@dqbd/tiktoken';

    export class OpenAITokenizer implements ITokenizer {
      async countTokens(text: string, model: string): Promise<number> {
        // Implementation using tiktoken
      }
    }
    ```

- [ ] Integrate tokenizer for pre-counting (optional enhancement):
  - [ ] Add token counting before sending requests
  - [ ] Provide early warning when approaching limits

### Part E: Update Provider Message Types

- [ ] Update `packages/core/src/providers/types.ts`:
  - [ ] Add optional usage field to ProviderMessage:
    ```typescript
    export interface ProviderMessage {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_calls?: ProviderToolCall[];
      tool_call_id?: string;
      name?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    }
    ```

## Testing

- [ ] Test with various OpenAI models (o3, o4-mini, gpt-4.1)
- [ ] Verify context percentage decreases as conversation progresses
- [ ] Test approaching token limits
- [ ] Ensure usage tracking works with tool calls
- [ ] Verify tokenizer accuracy against OpenAI's reported usage

## Self-verify

```bash
npm run typecheck
npm run lint
npm test -- tokenLimits
npm test -- OpenAIProvider
# Manual test: Start a conversation with OpenAI provider and verify context percentage updates
```

**STOP. Wait for Phase 08c verification.**
