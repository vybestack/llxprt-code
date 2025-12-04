# Issue 621: Prototype OpenAIVercelProvider - Summary

## What is Being Requested

Create a new `OpenAIVercelProvider` using Vercel's AI SDK (https://github.com/vercel/ai/) to replace or complement the existing OpenAI provider implementation. This will outsource provider quirks and model compatibility to Vercel's SDK.

## Key Goals

1. **Stage 1**: Create a new OpenAIVercelProvider that mimics the existing IProvider interface
2. **Stage 2**: Rework tool mapping to align with Vercel AI SDK format while supporting "legacy" format during transition

## Why This is Needed

- **Reduce maintenance burden**: Every day new models and providers appear with quirks
- **Better provider support**: Vercel AI SDK is used by opencode, ensuring better support from providers
- **Model geometry heuristics**: Leverage Vercel's automatic context window detection
- **Focus on features**: Spend less time on provider-specific issues

## Technical Requirements from CodeRabbit Analysis

### 1. Provider Architecture

The new provider should:
- Extend `BaseProvider` and implement `IProvider` interface
- Use Vercel AI SDK's `createOpenAI` function to instantiate the client
- Support the same authentication patterns (API keys, OAuth for Qwen)
- Support the same configuration options (baseURL, model params)

### 2. Tool Call Handling - CRITICAL

This is the most complex part. The issue highlights two key challenges:

#### A. Tool Format Conversion
Currently, llxprt uses a **Gemini-style** tool format internally:
```typescript
{
  functionDeclarations: [
    {
      name: string;
      description: string;
      parametersJsonSchema?: unknown;
      parameters?: unknown;
    }
  ]
}
```

Vercel AI SDK expects **OpenAI-style** tools:
```typescript
{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  }
}
```

**Solution**: The `ToolFormatter` class already handles this conversion. Use it.

#### B. History Service Integration - THE BIG PROBLEM

The current flow involves HistoryService which stores tool calls and responses:

**Turn 1**: User asks question
```typescript
historyService.add({
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Read /tmp/config.json' }]
}, model);
```

**Turn 2**: AI requests tool
```typescript
{
  speaker: 'ai',
  blocks: [
    { type: 'text', text: "I'll read that file" },
    {
      type: 'tool_call',
      id: 'hist_tool_abc123',  // ← History format ID
      name: 'read_file',
      parameters: { path: '/tmp/config.json' }
    }
  ]
}
```

**Turn 3**: Tool executes
```typescript
const result = await toolScheduler.executeTool('read_file', params);
// Result added to HistoryService
{
  speaker: 'tool',
  blocks: [{
    type: 'tool_response',
    callId: 'hist_tool_abc123',  // ← MUST match the tool_call id
    toolName: 'read_file',
    result: '{"config": "data"}'
  }]
}
```

**Turn 4**: Replay to provider
When sending history back to the provider, we need to:
1. Convert `hist_tool_xxx` IDs to provider format (`call_xxx` for OpenAI, `toolu_xxx` for Anthropic)
2. Build provider-specific message structures
3. Handle tool responses correctly

**THE PROBLEM**: 
- Vercel AI SDK expects tool IDs in **OpenAI format** (`call_xxx`)
- History Service uses **history format** (`hist_tool_xxx`)
- Current OpenAIProvider has `normalizeToOpenAIToolId()` and `normalizeToHistoryToolId()` methods
- **Must preserve ID mapping** so tool responses match tool calls

### 3. Streaming Behavior

Vercel AI SDK returns AsyncIterableIterator with chunks. Must convert to IContent format:

```typescript
async *generateChatCompletionWithOptions(options) {
  const stream = await streamText({
    model: vercelModel,
    messages: convertedMessages,
    tools: convertedTools,
  });

  for await (const chunk of stream.textStream) {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: chunk }]
    };
  }

  // Handle tool calls from stream.toolCalls
  for (const toolCall of await stream.toolCalls) {
    yield {
      speaker: 'ai',
      blocks: [{
        type: 'tool_call',
        id: normalizeToHistoryToolId(toolCall.toolCallId),
        name: toolCall.toolName,
        parameters: toolCall.args
      }]
    };
  }
}
```

### 4. Transition Strategy

**During Transition**:
- Keep both OpenAIProvider (current) and OpenAIVercelProvider (new)
- Support both tool formats simultaneously
- Use configuration flag to select which provider to use
- Ensure HistoryService works with both

**After Transition**:
- Deprecate old OpenAIProvider
- Migrate tool handling to Vercel AI SDK format as primary
- Keep backward compatibility layer for existing profiles/configs

## Key Files to Modify

1. **New files**:
   - `packages/core/src/providers/openai/OpenAIVercelProvider.ts`
   - `packages/core/src/providers/openai/OpenAIVercelProvider.test.ts`

2. **Existing files to reference**:
   - `packages/core/src/providers/openai/OpenAIProvider.ts` - Current implementation
   - `packages/core/src/providers/BaseProvider.ts` - Base class
   - `packages/core/src/providers/IProvider.ts` - Interface to implement
   - `packages/core/src/tools/ToolFormatter.ts` - Tool format conversion
   - `packages/core/src/services/history/IContent.ts` - Content block types

3. **Dependencies**:
   - Add `ai` package (Vercel AI SDK) to package.json
   - Add `@ai-sdk/openai` for OpenAI-specific SDK features

## CodeRabbit's Recommended Implementation Plan

### Phase 1: Adapter Layer (Minimal Change)
1. Create `OpenAIVercelProvider` that wraps Vercel SDK
2. Convert HistoryService `IContent[]` to Vercel SDK format
3. Convert Vercel SDK responses back to `IContent[]`
4. Use existing ToolFormatter for tool format conversion
5. Implement ID normalization (hist_tool ↔ call_)

### Phase 2: Parallel Support
1. Add provider selection mechanism (config flag)
2. Test both providers side-by-side
3. Ensure HistoryService works with both
4. Validate tool call round-trips

### Phase 3: Migration
1. Default to Vercel provider for new installs
2. Document migration path
3. Deprecate old provider
4. Remove old provider in future version

## Critical Questions Before Starting

1. **Do we want both providers to coexist permanently or is this a migration?**
   - CodeRabbit suggests: Parallel support during transition, then deprecate old one

2. **How do we select which provider to use?**
   - CodeRabbit suggests: Config flag or profile setting like `use-vercel-sdk: true`

3. **What about existing profiles that reference OpenAI provider?**
   - Need backward compatibility layer or migration guide

4. **Are there any Vercel SDK limitations we should know about?**
   - Need to check: OAuth support, custom endpoints, model params

5. **Should we also create providers for other supported providers (Anthropic, Google)?**
   - Issue only mentions OpenAI, but could be a template for others

## Decisions Needed for Architect Subagent

The architect subagent should create a PLAN.md that addresses:

1. **Provider Selection Strategy**: How do users choose between old/new provider?
2. **Tool ID Mapping**: Detailed pseudocode for ID normalization across the boundary
3. **Testing Strategy**: How to validate tool call round-trips work correctly
4. **Migration Path**: Step-by-step plan for users to transition
5. **Rollback Plan**: What if Vercel SDK doesn't work as expected?
6. **Performance Considerations**: Any overhead from adapter layer?
7. **Edge Cases**: What happens with:
   - Multiple tool calls in one turn
   - Tool call errors
   - Streaming interruption
   - OAuth authentication
   - Custom model parameters

## Context the Architect Needs

When prompting the architect subagent, include:

1. **Current provider architecture**: BaseProvider, IProvider interface, tool handling
2. **HistoryService role**: How tool calls flow through history
3. **Tool format complexity**: Gemini vs OpenAI vs Vercel formats
4. **ID normalization requirements**: Why and how IDs must be converted
5. **Streaming patterns**: How current provider yields IContent chunks
6. **Test requirements**: TDD approach from RULES.md
7. **Vercel AI SDK docs**: Key APIs like `streamText`, `generateText`, tool handling

## Summary for Architect Prompt

You are creating a plan to add Vercel AI SDK support to llxprt-code by implementing OpenAIVercelProvider. The main challenges are:

1. **Tool call ID translation**: HistoryService uses `hist_tool_*` but Vercel SDK expects `call_*` (OpenAI format)
2. **Format conversion**: Internal Gemini format → Vercel SDK OpenAI format
3. **Streaming adaptation**: Vercel's AsyncIterableIterator → IContent blocks
4. **Transition strategy**: Support both old and new providers during migration

The plan must preserve existing behavior while leveraging Vercel SDK's provider support. Focus on tool call round-trip correctness and clear migration path.
