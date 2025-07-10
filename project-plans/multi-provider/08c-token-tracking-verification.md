# Phase 08c – Verification of Token Tracking Implementation (multi-provider)

## Verification Steps

### 1. Token Limits Verification

```bash
# Check token limits are added for OpenAI models
grep -E "o3|o4-mini|gpt-4\.1" packages/core/src/core/tokenLimits.ts
```

**Expected:** Should find token limit entries for o3, o3-mini, o4-mini, gpt-4.1, gpt-4o models

### 2. Usage Tracking in OpenAI Provider

```bash
# Verify stream_options with include_usage
grep -A2 "stream_options.*include_usage" packages/cli/src/providers/openai/OpenAIProvider.ts
```

**Expected:** Should find stream_options: { include_usage: true }

### 3. Usage Event Emission

```bash
# Check for UsageMetadata event handling in wrapper
grep -B5 -A5 "UsageMetadata" packages/core/src/providers/adapters/GeminiCompatibleWrapper.ts
```

**Expected:** Should find code that emits UsageMetadata events

### 4. Tokenizer Installation

```bash
# Verify tokenizer is installed
cd packages/cli && npm list @dqbd/tiktoken
```

**Expected:** Should show @dqbd/tiktoken in dependencies

### 5. Provider Message Types

```bash
# Check for usage field in ProviderMessage
grep -A5 "usage\?:" packages/core/src/providers/types.ts
```

**Expected:** Should find optional usage field with token counts

### 6. Manual Testing

1. **Start CLI with OpenAI provider:**

   ```bash
   npm run dev
   /provider openai
   /model o3
   ```

2. **Send messages and observe context percentage:**
   - Initial message should show < 100% context left
   - Each message should decrease available context
   - Context percentage should be accurate

3. **Test with different models:**

   ```bash
   /model gpt-4.1
   # Send message, verify context updates
   /model o4-mini
   # Send message, verify context updates
   ```

4. **Test approaching limits:**
   - Send very long messages
   - Verify warning when approaching token limit
   - Verify behavior at limit

### 7. Unit Test Verification

```bash
# Run token limit tests
npm test -- --grep "tokenLimit.*o3|tokenLimit.*gpt-4"

# Run OpenAI provider tests
npm test -- --grep "OpenAIProvider.*usage"
```

**Expected:** All tests should pass

### 8. Integration Test

```bash
# Test full flow with usage tracking
npm run test:integration -- --grep "token.*tracking|usage.*metadata"
```

**Expected:** Integration tests should verify usage events are properly emitted

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures with specific error messages or missing implementations.
