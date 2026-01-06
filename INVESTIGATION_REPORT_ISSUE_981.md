# Investigation Report: Issue #981

# Pipeline Mode - Tool Responses Not Added to Context

## Executive Summary

**Root Cause Identified**: Pipeline mode fails to capture and preserve the original OpenAI `tool_call_id` from streaming deltas, unlike legacy mode which correctly preserves it. This breaks the tool call ↔ tool response ID matching required for context continuity.

**Impact**: Tool responses are not added to conversation context in pipeline mode, causing multi-turn conversations with tool calls to fail.

**Affected Providers**: All OpenAI-compatible providers when using `toolCallProcessingMode: 'pipeline'`, including Qwen, local models, and standard OpenAI models.

## Investigation Details

### 1. The Bug Location

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts`
**Line**: 3964-3973 (pipeline mode fragment collection)

```typescript
// PIPELINE MODE - BROKEN CODE
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

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts`
**Line**: 2326-2344 (legacy mode - WORKING CODE)

```typescript
// LEGACY MODE - WORKING CODE
const deltaToolCalls = choice.delta?.tool_calls;
if (deltaToolCalls && deltaToolCalls.length > 0) {
  for (const deltaToolCall of deltaToolCalls) {
    // ...accumulation logic...
    // CORRECT: Captures the original tool_call_id
    if (deltaToolCall.id) tc.id = deltaToolCall.id;
    // ...
  }
}
```

### 2. Why This Breaks Tool Responses

The full data flow showing where the break occurs:

**Step 1: OpenAI API Response**

- API returns: `{ delta: { tool_calls: [{ id: "call_abc123", index: 0, function: { name: "search", arguments: "{}" } }] } }`
- The `id` field contains the tool's unique identifier: `"call_abc123"`

**Step 2: Pipeline Mode Fragment Collection (BROKEN)**

- Code at line 3964-3973 extracts: `name` and `args` only
- **Discarded**: `deltaToolCall.id = "call_abc123"`
- Result: `ToolCallFragment` has no ID information

**Step 3: ToolCallCollector.assembleCall()**

- Receives: `{ index, name, args }` (no ID)
- Result: `ToolCallCandidate` has no ID information

**Step 4: ToolCallNormalizer.normalize()**

- Input: `{ index, name, args, isValid, validationErrors }`
- Output: `NormalizedToolCall { index, name, args, originalArgs }`
- Result: Still no ID information

**Step 5: Pipeline Mode Emit (Line 4236 - BROKEN)**

```typescript
// Synthesizes a fake ID instead of using the real one
id: this.normalizeToHistoryToolId(`call_${normalizedCall.index}`);
// Creates: "hist_tool_<uuid>" instead of "call_abc123"
```

**Step 6: Tool Execution (CoreToolScheduler)**

- scheduler receives: `IContent` with tool*call_id = `"hist_tool*<uuid>"`
- scheduler creates: `CompletedToolCall` with this synthetic ID
- `createFunctionResponsePart("hist_tool_<uuid>", ...)` is called

**Step 7: Tool Response Flow Back**

- responseParts contain: `{ functionResponse: { id: "hist_tool_<uuid>", name: "search", response: { output: "..." } } }`

**Step 8: Next Provider Call with History**

- buildMessagesWithReasoning() converts `IContent` to OpenAI format
- Builds assistant message with: `{ tool_calls: [{ id: "hist_tool_<uuid>", ... }] }`
- Builds tool message with: `{ role: 'tool', tool_call_id: "hist_tool_<uuid>", ... }`

**The Problem**: While the IDs match internally (both are `"hist_tool_<uuid>"`), they don't match any tool*calls that the OpenAI API actually returned in the previous response. The OpenAI API expects tool responses to reference the exact `tool_call_id` it returned, which was `"call_abc123"`, not `"hist_tool*<uuid>"`.

### 3. Comparison with Legacy Mode (WORKING)

**Legacy Mode correctly preserves the ID:**

```
API returns: id="call_abc123"
  ↓
Captured at line 2344: tc.id = "call_abc123"
  ↓
Emitted with original id: id="call_abc123"
  ↓
Scheduler uses: "call_abc123"
  ↓
Response has: "call_abc123"
  ↓
Next call sees matching IDs [OK]
```

### 4. Evidence from Code

**ToolCallFragment Interface** (ToolCallCollector.ts:27-35)

```typescript
export interface ToolCallFragment {
  index: number;
  name?: string;
  args?: string;
  timestamp: number;
  // Missing: id?: string;  <- This is what needs to be added
}
```

**NormalizedToolCall Interface** (ToolCallNormalizer.ts:29-43)

```typescript
export interface NormalizedToolCall {
  index: number;
  name: string;
  args: Record<string, unknown>;
  originalArgs?: string;
  // Missing: id?: string;  <- This is what needs to be added
}
```

**ToolCallBlock Interface** (IContent.ts - from search)

```typescript
{
  type: 'tool_call',
  id: string,  // This IS present in the IContent that gets yielded
  name: string,
  parameters: Record<string, unknown>
}
```

### 5. Additional Investigation Results

**Where do tool responses actually go missing?**

After examining `useGeminiStream.ts` and `geminiChat.ts`:

1. `handleCompletedTools()` correctly calls `geminiClient.addHistory()` with both functionCall and functionResponse parts
2. `geminiClient.sendMessageStream()` correctly passes history to providers via `contents` parameter
3. `buildMessagesWithReasoning()` converts `IContent[tool]` blocks to `{ role: 'tool', tool_call_id, ... }` messages

**The tool responses ARE being added to history** - they're just being added with the wrong IDs.

When `buildMessagesWithReasoning()` builds the OpenAI messages:

- It finds assistant tool*calls with `id: "hist_tool*<uuid>"`
- It finds tool responses with `tool_call_id: "hist_tool_<uuid>"`
- IDs match, so validation passes

But the OpenAI API on the next call doesn't recognize these responses because it never returned a tool*call with id `"hist_tool*<uuid>"`- it returned`"call_abc123"`.

### 6. Why Legacy Mode Works by Comparison

Looking at `generateLegacyChatCompletionImpl` (starting around line 1532):

```typescript
// Legacy accumulates tool calls into this structure
let accumulatedToolCalls: {
  [index: number]: {
    id?: string;
    name?: string;
    arguments?: string;
    argumentsSoFar?: string;
    finished?: boolean;
  };
} = {};

// When processing deltas:
if (deltaToolCall.id) tc.id = deltaToolCall.id; // PRESERVES THE ID
```

Then when building tool_call blocks (around line 2480):

```typescript
id: this.normalizeToHistoryToolId(tc.id),  // Uses the ORIGINAL ID
```

The `normalizeToHistoryToolId` function just normalizes/cleans the ID - it doesn't generate a new one if an ID exists.

### 7. Root Cause Conclusion

**Primary Root Cause**: Pipeline mode does not capture the OpenAI `tool_call_id` from streaming deltas.

**Secondary Root Cause**: Pipeline mode synthesizes new IDs instead of using the ones provided by the OpenAI API.

**Why This Matters**: OpenAI's Chat Completions API requires strict ID matching between tool_calls in assistant messages and tool_call_id in tool messages. The provider must use the exact IDs returned by the API.

**Why Legacy Works**: Legacy mode preserves these IDs throughout the flow.

**Why Pipeline Fails**: Pipeline mode discards them and generates new ones.

## Fix Plan

### Phase 1: Add ID Support to Pipeline Types

1. **Update `ToolCallFragment` interface** (ToolCallCollector.ts:27-35)
   - Add: `id?: string;`

2. **Update `ToolCallCandidate` interface** (ToolCallCollector.ts:38-44)
   - This interface already extends fragments, so it should inherit the ID field

3. **Update `NormalizedToolCall` interface** (ToolCallNormalizer.ts:29-43)
   - Add: `id?: string;`

4. **Update `ToolCallNormalizer.normalize()`** (ToolCallNormalizer.ts:56-77)
   - Preserve ID from input to output

### Phase 2: Capture ID in Pipeline Mode

5. **Update fragment collection** (OpenAIProvider.ts:3964-3973)

   ```typescript
   this.toolCallPipeline.addFragment(deltaToolCall.index, {
     id: deltaToolCall.id, // ADD THIS
     name: deltaToolCall.function?.name,
     args: deltaToolCall.function?.arguments,
   });
   ```

6. **Similar update for Kimi tool calls** (OpenAIProvider.ts:3718-3728)
   ```typescript
   this.toolCallPipeline.addFragment(baseIndex, {
     id: generateToolCallId(), // For Kimi, need to generate a proper ID
     name: toolCall.name,
     args: JSON.stringify(toolCall.parameters),
   });
   ```

### Phase 3: Use Original IDs When Emitting

7. **Update emission ID logic** (OpenAIProvider.ts:4236)
   ```typescript
   id: this.normalizeToHistoryToolId(
     normalizedCall.id || `call_${normalizedCall.index}`
   ),
   ```

### Phase 4: Tests

8. Add tests verifying:
   - Pipeline mode preserves tool_call IDs from streaming deltas
   - Tool responses are matched correctly with their tool calls
   - Context includes both tool calls and responses
   - Multi-turn conversations work in pipeline mode

## Files to Modify

1. `packages/core/src/providers/openai/ToolCallCollector.ts`
2. `packages/core/src/providers/openai/ToolCallNormalizer.ts`
3. `packages/core/src/providers/openai/OpenAIProvider.ts`

## Verification Plan

After implementing the fix:

1. Run `npm run test` - all tests should pass
2. Run `npm run typecheck` - no TypeScript errors
3. Run `npm run lint` - no linting errors
4. Run `npm run format` - code formatting
5. Run `npm run build` - successful build
6. Run `node scripts/start.js --profile-load synthetic "write me a haiku"` - should work with tool calls
7. Test with actual multi-turn tool call scenario to verify responses appear in `/dumpcontext`

---

**Investigation Date**: January 6, 2026
**Investigator**: LLxprt Code
**Issue**: #981
**Status**: Root cause confirmed, fix plan ready
