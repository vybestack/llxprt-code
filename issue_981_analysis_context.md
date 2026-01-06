# Issue #981 Analysis Context

## Problem Statement

Pipeline mode for OpenAI provider is not adding tool responses to conversation context. Legacy mode works correctly - only pipeline mode is broken.

User runs with local models like Qwen 3 Next 80b (uses OpenAI-compatible API).

## Key Findings from Code Investigation

### 1. Pipeline Mode Tool Call ID Generation

**File:** `packages/core/src/providers/openai/OpenAIProvider.ts` around line 4236

Pipeline mode generates synthetic IDs:

```typescript
id: this.normalizeToHistoryToolId(`call_${normalizedCall.index}`);
```

This creates IDs like `hist_tool_<uuid>` with the index as a suffix.

### 2. Legacy Mode Tool Call ID Generation

**File:** `packages/core/src/providers/openai/OpenAIProvider.ts` around line 2888

Legacy mode uses IDs from streaming deltas:

```typescript
id: this.normalizeToHistoryToolId(toolCall.id);
```

This preserves the original tool_call_id from the OpenAI API response.

### 3. CoreToolScheduler Response ID Generation

**File:** `packages/core/src/core/coreToolScheduler.ts` around line 171-177

The scheduler echoes the tool call ID in the functionResponse:

```typescript
function createFunctionResponsePart(
  callId: string, // This is the tool call ID received
  toolName: string,
  output: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
    },
  };
}
```

The scheduler receives the tool_call IDs from the yielded IContent blocks and uses them in `createFunctionResponsePart`.

### 4. History Conversion (buildMessagesWithReasoning)

**File:** `packages/core/src/providers/openai/OpenAIProvider.ts` lines 1327-1344

Tool responses are converted using `resolveToolResponseId`:

```typescript
resolveToolResponseId = (tr: ToolResponseBlock): string => {
  if (toolIdMapper) {
    return toolIdMapper.resolveToolResponseId(tr);
  }
  return this.normalizeToOpenAIToolId(tr.callId);
};
```

The `tr.callId` comes from the ToolResponseBlock's `callId` field.

### 5. Tool Response Flow to History

**File:** `packages/cli/src/ui/hooks/useGeminiStream.ts` around lines 1280-1380

When tools complete, `handleCompletedTools` submits the responseParts to the next turn via `submitQuery`:

```typescript
const responsesToSend: Part[] = geminiTools.flatMap(
  (toolCall) => toolCall.response.responseParts,
);

submitQuery(responsesToSend, { isContinuation: true }, prompt_ids[0]);
```

The responseParts (with functionCall and functionResponse parts) are submitted to the next provider invocation.

## Coderabbit's Hypothesis

Coderabbit claims the issue is an ID mismatch:

- Pipeline mode synthesizes IDs as `normalizeToHistoryToolId("call_${index}")`
- When these IDs don't match what the provider expects in the next turn, tool responses are orphaned
- Legacy mode preserves IDs from streaming deltas, maintaining continuity

## Questions for Analysis

1. **Verify the ID flow:** Does pipeline mode actually generate different IDs than legacy mode? Check if `normalizeToHistoryToolId` is deterministic and creates proper tool_call IDs.

2. **Check what provider expects:** What does the OpenAI provider expect as tool_call_id values when receiving tool responses? Does it use standard OpenAI format (string) or something else?

3. **Examine the actual mismatch:** Look at `validateToolMessageSequence` in OpenAIProvider.ts - does it validate tool_call_id matching and potentially drop mismatched responses?

4. **Consider alternative root causes:**
   - Are tool response IContent blocks being created at all in the CLI layer?
   - Is there a difference in how `handleCompletedTools` processes pipeline vs legacy mode?
   - Are the responseParts from CoreToolScheduler different between the two modes?

## Files to Examine

1. `packages/core/src/providers/openai/OpenAIProvider.ts` - pipeline vs legacy ID generation
2. `packages/core/src/providers/openai/ToolCallPipeline.ts` - what IDs are available during collection
3. `packages/core/src/providers/openai/ToolCallNormalizer.ts` - what information is preserved during normalization
4. `packages/core/src/providers/openai/ToolCallCollector.ts` - what fragments are collected from streaming
5. `packages/core/src/core/coreToolScheduler.ts` - how CompletedToolCall.responseParts are built
6. `packages/core/src/services/history/HistoryService.ts` - how tool responses are stored and retrieved
7. `packages/cli/src/ui/hooks/useGeminiStream.ts` - how tool completion is handled
8. `packages/core/src/core/geminiChat.ts` - how providers are invoked and how history is passed

## Expected Tasks

1. DeepThinker: Analyze the code to determine the actual root cause, not just accept coderabbit's hypothesis
2. TypeScriptExpert: Do independent analysis and confirm/disagree with the root cause
3. If both agree, TypeScriptExpert should implement a test-driven fix
