# Task: Complete Provider Integration

## Objective

Ensure the multi-provider system is properly integrated with the core Gemini client and all provider features work correctly.

## Files to Modify

### Priority 1 - Core Integration:

1. **`packages/core/src/core/client.ts`**
   - Verify ProviderManager integration
   - Ensure proper provider selection logic
   - Check tool execution flows through providers

2. **`packages/cli/src/providers/providerManagerInstance.ts`**
   - Verify singleton instance is properly used
   - Check integration with GeminiClient
   - Ensure proper initialization

3. **`packages/cli/src/ui/hooks/useGeminiStream.ts`**
   - Verify provider-aware streaming
   - Check ProviderContentGenerator usage
   - Ensure proper error handling

### Priority 2 - Tool Integration:

4. **`packages/core/src/core/coreToolScheduler.ts`**
   - Verify ToolFormatter integration
   - Ensure tools work with all providers
   - Check text-based tool parsing

5. **`packages/cli/src/tools/ToolFormatter.ts`**
   - Verify all tool formats implemented
   - Check integration with tool execution
   - Ensure proper format selection

### Priority 3 - Configuration:

6. **`packages/cli/src/config/config.ts`**
   - Ensure provider settings integrated
   - Check API key management
   - Verify base URL configuration

## Specific Changes Needed

### Provider Manager Integration:

1. In client.ts, ensure ProviderManager is used for:
   - Model selection
   - Chat completion generation
   - Tool execution

2. Verify providerManagerInstance is:
   - Imported where needed
   - Initialized with correct config
   - Used consistently throughout

### Tool Execution Flow:

1. Ensure tools are formatted correctly for each provider
2. Verify tool responses are parsed properly
3. Check text-based parsing for non-JSON providers

### Configuration Flow:

1. Ensure provider settings persist
2. Verify API keys are loaded from env vars
3. Check provider switching updates config

## Verification Steps

1. Test provider switching: `/provider openai`, `/provider anthropic`
2. Test tool execution with each provider
3. Verify model selection works per provider
4. Check token tracking for each provider
5. Test with actual API calls (if keys available)

## Dependencies

- P0 tasks must be complete

## Estimated Time

1.5 hours

## Notes

- This is critical for multi-provider functionality
- Focus on runtime behavior, not just compilation
- Test with multiple providers if possible
- Ensure backward compatibility with Gemini-only mode
