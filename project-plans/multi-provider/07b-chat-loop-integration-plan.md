# Phase 07b – Chat Loop Integration Plan (multi-provider)

## Overview

This phase focuses on integrating the ProviderManager into the core chat loop, enabling the CLI to use different providers for actual chat completions.

## Challenges

1. **Tight Coupling**: The current implementation is deeply coupled to Gemini-specific APIs
2. **Streaming Differences**: Each provider has different streaming formats and protocols
3. **Event Types**: Gemini uses custom events (Thought, ToolCallRequest, etc.) that don't exist in other providers
4. **Tool Calling**: Different providers have different tool/function calling formats

## Proposed Solution: Adapter Pattern

### 1. Create Common Interfaces

```typescript
// Common streaming event types
interface IStreamEvent {
  type: 'content' | 'tool_call' | 'error' | 'done' | 'usage';
  data: any;
}

// Common message format
interface IStreamMessage {
  role: 'assistant';
  content?: string;
  toolCalls?: IToolCall[];
}
```

### 2. Create Provider Adapters

Each provider adapter translates provider-specific formats to common format:

```typescript
class OpenAIStreamAdapter {
  async *adaptStream(
    providerStream: AsyncIterableIterator<any>,
  ): AsyncIterableIterator<IStreamEvent> {
    // Convert OpenAI stream chunks to common format
  }
}
```

### 3. Update useGeminiStream

Either:

- Rename to `useProviderStream` and make it provider-agnostic
- Create a new `useProviderStream` alongside the existing one

## Implementation Steps

### Step 1: Define Common Interfaces

- [ ] Create `IStreamEvent` interface
- [ ] Create `IStreamMessage` interface
- [ ] Define common tool call format
- [ ] Define common error format

### Step 2: Implement Stream Adapters

- [ ] Create `GeminiStreamAdapter` (to test the pattern with existing code)
- [ ] Create `OpenAIStreamAdapter`
- [ ] Create base `StreamAdapter` class

### Step 3: Create Provider-Agnostic Stream Hook

- [ ] Copy `useGeminiStream` to `useProviderStream`
- [ ] Replace Gemini-specific types with common interfaces
- [ ] Use adapters to handle provider differences

### Step 4: Integration

- [ ] Update `App.tsx` to use `useProviderStream` when providers are available
- [ ] Fall back to `useGeminiStream` when using Gemini directly
- [ ] Ensure tool calls work across providers

### Step 5: Testing

- [ ] Test with OpenAI provider
- [ ] Test with Gemini (through adapter)
- [ ] Test tool calls
- [ ] Test error handling

## Alternative Approach: Minimal Integration

If the above is too complex, we could start with a minimal approach:

1. **Create a Gemini-Compatible Wrapper**
   - Make OpenAI responses look like Gemini responses
   - Translate on the fly in the provider
2. **Use Existing Infrastructure**
   - Keep using `GeminiClient` and `GeminiChat`
   - But have them internally use ProviderManager
3. **Gradual Migration**
   - Start with basic chat
   - Add tool support later
   - Add streaming optimizations later

## Decision Needed

Before proceeding, we need to decide:

1. Which approach to take (full refactor vs. minimal integration)
2. Whether to maintain backward compatibility during transition
3. Timeline and priority for this work

## Estimated Effort

- Full refactor: 3-5 phases
- Minimal integration: 1-2 phases
