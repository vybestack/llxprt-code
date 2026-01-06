# Root Cause Verification: Issue #981

## Conclusion: AGREE - Root cause analysis is CORRECT

The investigation correctly identifies that pipeline mode fails to capture the original OpenAI `tool_call_id` from streaming deltas, breaking tool response matching.

## Evidence Summary

### 1. Pipeline Mode Fragment Collection (BROKEN)

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts:3964-3973`

```typescript
const deltaToolCalls = choice.delta?.tool_calls;
if (deltaToolCalls && deltaToolCalls.length > 0) {
  for (const deltaToolCall of deltaToolCalls) {
    if (deltaToolCall.index === undefined) continue;

    // Add fragment to pipeline instead of accumulating strings
    this.toolCallPipeline.addFragment(deltaToolCall.index, {
      name: deltaToolCall.function?.name,
      args: deltaToolCall.function?.arguments,
      // MISSING: id: deltaToolCall.id
    });
  }
}
```

**Problem**: The `deltaToolCall.id` field is never captured.

### 2. Legacy Mode Fragment Collection (WORKING)

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts:2326-2344`

```typescript
const deltaToolCalls = choice.delta?.tool_calls;
if (deltaToolCalls && deltaToolCalls.length > 0) {
  for (const deltaToolCall of deltaToolCalls) {
    if (!accumulatedToolCalls[deltaToolCall.index]) {
      accumulatedToolCalls[deltaToolCall.index] = {
        name: '',
        arguments: '',
        argumentsSoFar: '',
        finished: false,
      };
    }

    const tc = accumulatedToolCalls[deltaToolCall.index];

    if (deltaToolCall.id) tc.id = deltaToolCall.id; // PRESERVES ID
    if (deltaToolCall.function?.name) tc.name += deltaToolCall.function.name;
    // ...
  }
}
```

**Correct**: The `deltaToolCall.id` is preserved in `tc.id`.

### 3. ToolCallFragment Interface (Missing ID Field)

**File**: `packages/core/src/providers/openai/ToolCallCollector.ts:27-33`

```typescript
export interface ToolCallFragment {
  index: number;
  name?: string;
  args?: string;
  timestamp: number;
  // MISSING: id?: string;
}
```

**Problem**: The interface doesn't include an `id` field, so no ID can be stored in fragments.

### 4. NormalizedToolCall Interface (Missing ID Field)

**File**: `packages/core/src/providers/openai/ToolCallNormalizer.ts:29-40`

```typescript
export interface NormalizedToolCall {
  index: number;
  name: string;
  args: Record<string, unknown>;
  originalArgs?: string;
  // MISSING: id?: string;
}
```

**Problem**: The normalized output also lacks the ID field.

### 5. Pipeline Mode Emit (Synthesizes Fake ID)

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts:4236`

```typescript
blocks.push({
  type: 'tool_call',
  id: this.normalizeToHistoryToolId(`call_${normalizedCall.index}`),
  // Uses index-based synthetic ID, not the original tool_call_id
  name: normalizedCall.name,
  parameters: processedParameters,
});
```

**Problem**: Synthesizes a new ID (`hist_tool_<uuid>`) instead of using the real one.

## Data Flow Analysis

```
OpenAI API returns:
  tool_calls[0].id = "call_abc123"
  tool_calls[0].function.name = "search"
  tool_calls[0].function.arguments = "{}"

↓ Pipeline Mode (BROKEN)

Fragment collection (line 3964):
  Captured: name="search", args="{}"
  Discarded: id="call_abc123"  ← BUG

↓

ToolCallCollector.assembleCall():
  Result: { index: 0, name: "search", args: "{}" }  // No ID

↓

ToolCallNormalizer.normalize():
  Result: { index: 0, name: "search", args: {...} }  // Still no ID

↓

Emit tool_call block (line 4236):
  id = this.normalizeToHistoryToolId("call_0") = "hist_tool_<uuid>"  ← Synthetic ID!

↓

CoreToolScheduler: createFunctionResponsePart("hist_tool_<uuid>", ...)
  Produces: { functionResponse: { id: "hist_tool_<uuid>", ... } }

↓

Next provider call receives:
  Assistant message: { tool_calls: [{ id: "hist_tool_<uuid>", ... }]}
  Tool message: { role: "tool", tool_call_id: "hist_tool_<uuid>", ... }

↓

OpenAI API expects:
  Tool responses to reference "call_abc123" (the ID it actually returned)
  But receives: "hist_tool_<uuid>" (a fake ID it never saw)

↓

RESULT: Tool responses are rejected/ignored
```

## Why This Matters

OpenAI's Chat Completions API enforces strict ID matching:

1. When the API returns `tool_calls` with specific IDs, it expects subsequent tool messages to reference those **exact** IDs
2. Using synthetic IDs breaks this contract
3. The provider may drop unmatched tool messages or fail to match them with their corresponding tool calls

## Legacy Mode Comparison

Legacy mode correctly preserves the ID:

```
API: id="call_abc123"
  ↓
Line 2344: tc.id = "call_abc123"  ← Preserved
  ↓
Emit: id = this.normalizeToHistoryToolId("call_abc123") = "call_123" (normalized)
  ↓
Response: id="call_123"
  ↓
Next call sees matching IDs [OK]
```

## Fix Summary

The fix requires:

1. Add `id?: string` to `ToolCallFragment` interface
2. Add `id?: string` to `NormalizedToolCall` interface
3. Capture `deltaToolCall.id` in pipeline mode fragment collection
4. Pass the original ID through normalization to `NormalizedToolCall`
5. Use the original ID when emitting tool_call blocks

## Verification Status

[OK] Root cause analysis is accurate and supported by code evidence
[OK] The bug location is correctly identified in pipeline mode fragment collection
[OK] The impact on tool response matching is correctly understood
[OK] The comparison with legacy mode is correct
[OK] The fix approach (adding ID support to pipeline types) is the right direction

---

**Verified by**: LLxprt Code
**Date**: January 6, 2026
**Issue**: #981
**Status**: Root cause CONFIRMED
