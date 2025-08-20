# Fix for JSON Truncation in max-prompt-tokens Trimming

## Problem

When using `max-prompt-tokens` limit (e.g., 50000 for Cerebras), the prompt truncation logic could break JSON in function calls, causing 400 errors:

- The truncation would cut off function calls mid-JSON
- This created malformed requests that providers reject

## Solution

Fixed the truncation logic to never break function calls or responses:

### Key Changes in `/packages/core/src/core/geminiChat.ts`:

1. **Never truncate function calls or responses**
   - Either include them completely or skip them entirely
   - Add marker text when omitting: `[...function calls omitted due to token limit...]`

2. **Better logging**
   - Log when function calls are skipped due to token limits
   - Count and report how many function calls were removed
   - Show detailed info about what's being trimmed

3. **Safer truncation**
   - Only truncate text content, never structured data
   - Validate that truncated content still has parts before adding

## How It Works

```typescript
// For non-text parts (function calls, responses)
if (currentTokens + partTokens <= maxTokens) {
  // Include the whole part
  truncatedParts.push(part);
} else {
  // Skip entirely - NEVER partially include
  // Log what we're skipping
  // Add marker text that content was omitted
}
```

## Benefits

1. **No more 400 errors** from broken JSON in requests
2. **Clear visibility** into what's being trimmed via logs
3. **LLM awareness** - the model sees markers when content is omitted
4. **Safer degradation** - better to omit old function calls than break current ones

## Testing

- ✅ Build passes
- ✅ Lint passes (fixed TypeScript types)
- ✅ Format passes
- ✅ Ready for testing with Cerebras

## Logs to Watch For

When token limits are hit, you'll now see:

```
INFO: TRIMMED: Trimmed prompt from 65000 to ~49000 tokens
WARNING: Trimming removed 5 function calls (12 -> 7)
INFO: Skipping functionCall: search_files due to token limit (needs 2000 tokens, only 500 available)
```

This fix ensures that even with aggressive token limits, requests remain valid JSON and providers don't reject them.
