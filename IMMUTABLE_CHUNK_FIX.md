# Fix for Immutable JSONResponse Error

## Problem

Error: `'JSONResponse' object does not support item assignment`

This occurred when trying to modify streaming chunks from Cerebras, as the response objects are immutable JSONResponse instances.

## Solution

Instead of modifying the chunk in place:

```typescript
// BAD - tries to modify immutable object
chunk.choices[0].delta = { ... };
```

Create a new object with the corrections:

```typescript
// GOOD - creates new object
processedChunk = {
  ...originalChunk,
  choices: [{
    delta: { ... },
    message: undefined
  }],
  usage: originalChunk.usage
};
```

## Impact

- Fixes the server error when processing Cerebras streams
- Allows proper conversion of malformed chunks
- Maintains immutability of response objects

## All Fixes Summary

### 1. Universal Defensive Handling

- Detects and fixes malformed responses from any provider
- Works for both streaming and non-streaming

### 2. JSON Truncation Fix

- Prevents breaking function calls when trimming for token limits
- Ensures valid JSON in all requests

### 3. Stream Aggregation Mode

- Automatically detects providers that send message format instead of delta
- Aggregates all chunks before yielding to prevent premature stopping

### 4. Immutable Object Fix (NEW)

- Creates new objects instead of modifying immutable responses
- Prevents JSONResponse assignment errors

## Remaining Issues

If still experiencing occasional stopping:

1. Try `/toolformat openai` as a workaround (you mentioned this helps)
2. The "repeating" with openai format is handled by our aggregation
3. May need provider-specific tool call handling for Cerebras

## Testing Status

- ✅ Build passes
- ✅ Lint passes
- ✅ Format passes
- ✅ Ready for testing
