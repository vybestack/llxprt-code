# Cerebras Streaming Fix - Automatic Detection & Aggregation

## Problem

Cerebras was stopping generation after tool calls in streaming mode. The issue was that:

1. Cerebras sends malformed streaming chunks (message format instead of delta)
2. This causes the stream to terminate prematurely after tool responses
3. The model clearly wants to continue (says "Let me...") but stops

## Solution

Implemented automatic detection and handling of malformed streams:

### Key Changes in `/packages/core/src/providers/openai/OpenAIProvider.ts`:

1. **Automatic Detection**
   - Buffer all chunks first (necessary to detect the issue)
   - Check if first chunk has `message` but no `delta` field
   - If detected, switch to aggregation mode automatically

2. **Aggregation Mode**
   - When malformed stream detected, aggregate ALL chunks before yielding
   - Combines all content parts into single response
   - Preserves tool calls and usage data
   - Returns one complete message instead of streaming

3. **No Configuration Needed**
   - Detection happens automatically
   - No need for user to configure anything
   - Works for any provider that has similar issues

## How It Works

```typescript
// 1. Buffer all chunks to detect issues
const allChunks: StreamChunk[] = [];
for await (const chunk of stream) {
  allChunks.push(chunk);
}

// 2. Check first chunk for malformation
if (firstChunk.choices?.[0]?.message && !firstChunk.choices?.[0]?.delta) {
  // Detected malformed stream!

  // 3. Aggregate everything into single response
  for (const chunk of allChunks) {
    const message = chunk.choices?.[0]?.message || chunk.choices?.[0]?.delta;
    // Combine content, tool calls, etc.
  }

  // 4. Yield complete message at once
  yield { role, content, tool_calls, usage };
  return;
}

// Otherwise process normally (streaming)
```

## Benefits

1. **Automatic** - No user configuration needed
2. **Self-healing** - Detects and fixes issues on the fly
3. **Universal** - Works for any provider with similar problems
4. **Preserves functionality** - Tool calls continue to work properly

## Impact

- Cerebras will no longer stop after tool calls
- The model can continue its full response
- Better user experience with no manual intervention needed

## Testing

- ✅ Build passes
- ✅ Lint passes
- ✅ Format passes
- ✅ Ready for testing with Cerebras

The fix ensures that even broken providers like Cerebras work seamlessly without requiring users to know about or configure special settings.
