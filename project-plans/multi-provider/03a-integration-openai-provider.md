# Phase 03a-integration – OpenAI Provider Integration Test (multi-provider)

## Goal

To verify the OpenAIProvider implementation works correctly with the real OpenAI API using actual API keys.

## Prerequisites

- Phase 03 completed (OpenAI getModels implementation)
- `~/.openai_key` file exists with valid API key

## Deliverables

- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.integration.test.ts`: Integration tests using real API
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/test-integration.js`: Standalone Node.js test script

## Checklist (verifier)

1. **Check API Key Availability:**

   ```bash
   test -f ~/.openai_key && echo "✓ OpenAI API key found" || echo "✗ OpenAI API key not found"
   ```

2. **Run Standalone Integration Test:**

   ```bash
   npm run build
   node src/providers/openai/test-integration.js
   ```

   **Expected Output:**
   - ✓ Model listing returns real OpenAI models
   - ✓ Chat completion generates actual response
   - ✓ Tool calling works with real API

3. **Verify Key Behaviors:**
   - Model list includes expected models (gpt-4o, gpt-3.5-turbo, etc.)
   - Streaming responses work correctly
   - Tool calls are properly formatted
   - Error handling works for API errors

## Outcome

If all checks pass and real API calls succeed, emit `✅ OpenAI integration verified`. Otherwise, list all `❌` failures with actual vs expected behavior.
