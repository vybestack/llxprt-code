# Issue #981: Pipeline Mode - Tool Responses Not Added to Context

## Problem Summary

When using `toolCallProcessingMode: 'pipeline'` with OpenAI providers (including Qwen 3 Next 80b), tool responses are not being added to the conversation context. Legacy mode works correctly.

## Coderabbit's Root Cause Analysis (for context)

Coderabbit hypothesizes that the issue is an ID mismatch:

- Pipeline mode synthesizes IDs as `normalizeToHistoryToolId("call_${index}")`
- Legacy mode preserves IDs from streaming deltas
- This ID mismatch causes tool responses to be "orphaned"

## CRITICAL FINDING - Confirmed Root Cause

The bug is confirmed to be in pipeline mode's fragment collection. Here's what I found:

### Pipeline Mode (BROKEN)

**File:** `packages/core/src/providers/openai/OpenAIProvider.ts` lines 3964-3973

```typescript
const deltaToolCalls = choice.delta?.tool_calls;
if (deltaToolCalls && deltaToolCalls.length > 0) {
  for (const deltaToolCall of deltaToolCalls) {
    if (deltaToolCall.index === undefined) continue;

    // Add fragment to pipeline instead of accumulating strings
    this.toolCallPipeline.addFragment(deltaToolCall.index, {
      name: deltaToolCall.function?.name,
      args: deltaToolCall.function?.arguments,
      // BUG: Missing 'id' field! The original tool_call_id is NEVER captured
    });
  }
}
```

### Legacy Mode (WORKING)

**File:** `packages/core/src/providers/openai/OpenAIProvider.ts` lines 2326-2344

```typescript
const deltaToolCalls = choice.delta?.tool_calls;
if (deltaToolCalls && deltaToolCalls.length > 0) {
  for (const deltaToolCall of deltaToolCalls) {
    ...omitted...
    // CORRECT: Captures the original tool_call_id
    if (deltaToolCall.id) tc.id = deltaToolCall.id;
    ...
  }
}
```

### Why This Breaks Tool Responses

The flow is:

1. **OpenAI API returns tool_calls** with a `tool_call_id` (e.g., `call_abc123`)
2. **Pipeline mode** discards this ID and only captures `name` and `args`
3. **ToolCallCollector** completes tool calls but has no ID information
4. **ToolCallNormalizer** normalizes to `NormalizedToolCall` (index, name, args) - still no ID
5. **Pipeline mode emits tool_call blocks** with synthetic IDs:
   ```typescript
   id: this.normalizeToHistoryToolId(`call_${normalizedCall.index}`);
   ```
   This creates `hist_tool_<uuid>` IDs, not the original `call_abc123`
6. **CoreToolScheduler** uses this synthetic ID in `createFunctionResponsePart(callId, ...)`
7. **Tool responses flow back** with the synthetic ID
8. **Next provider call** receives tool responses with the synthetic ID
9. **buildMessagesWithReasoning** converts these to OpenAI format

### Why Legacy Mode Works

Legacy mode preserves the original OpenAI `tool_call_id` throughout the flow, so when tool responses come back with matching IDs, they can be properly paired with the original tool calls.

## Your Task

### For DeepThinker:

1. Read and verify the analysis above
2. Do your own independent investigation
3. Check if there are any other factors (e.g., does `validateToolMessageSequence` drop mismatched tool messages?)
4. Confirm or disagree with this root cause
5. If you disagree, provide the corrected root cause

### For TypeScriptExpert:

1. Read and verify the analysis above
2. Do your own independent investigation
3. Confirm or disagree with this root cause
4. Check the `ToolCallFragment` interface - does it need an `id` field?
5. Check `ToolCallCollector`, `ToolCallNormalizer`, and `ToolCallPipeline` to understand what changes are needed
6. **If both you and DeepThinker agree on the root cause**, implement a test-driven fix:
   - Write a failing test first
   - Implement the fix
   - Run tests to prove they pass
   - Run the verification workflow: test, typecheck, lint, format, build, `node scripts/start.js --profile-load synthetic "write me a haiku"`

## Key Files to Examine

1. `packages/core/src/providers/openai/OpenAIProvider.ts` - broken pipeline fragment collection (line 3964)
2. `packages/core/src/providers/openai/ToolCallCollector.ts` - ToolCallFragment interface (line 27)
3. `packages/core/src/providers/openai/ToolCallNormalizer.ts` - NormalizedToolCall interface (line 29)
4. `packages/core/src/providers/openai/ToolCallPipeline.ts` - PipelineResult interface

## The Fix Is Likely:

1. Add an `id` field to `ToolCallFragment` interface
2. Capture and store `deltaToolCall.id` in the pipeline fragment collection
3. Pass the ID through normalization to `NormalizedToolCall`
4. Use the original ID when emitting tool_call blocks instead of synthesizing one

But you should verify this and implement your own solution following TDD principles.

## Deliverable

Return a detailed report with:

- Your root cause determination (agree/disagree with analysis)
- Evidence from code showing the bug
- (Iftypescriptexpert) Implementation plan or code changes
