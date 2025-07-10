# Integration Testing Modifications for Multi-Provider Plan

## Overview

Add real API integration tests at key milestones to ensure mocked behavior matches actual API behavior.

## Integration Test Phases to Add:

### Phase 03a-integration – OpenAI Provider Integration Test

**After Phase 03 (OpenAI getModels implementation)**

- Create integration test that uses real `~/.openai_key`
- Test real model listing
- Test real chat completions
- Test real tool calling
- Verify mocked responses match real API structure

### Phase 09a-integration – Anthropic Provider Integration Test

**After Phase 09 (Anthropic implementation complete)**

- Create integration test that uses real `~/.anthropic_key` or `~/.openrouter_key`
- Test real model listing
- Test real chat completions
- Test real tool calling with Anthropic's format
- Verify provider works with actual API

### Phase 13a-integration – Fireworks Provider Integration Test

**After Phase 13 (Fireworks implementation complete)**

- Create integration test that uses real `~/.fireworks_key`
- Test real model listing
- Test real chat completions
- Test real tool calling if supported
- Verify provider works with actual API

### Phase 14a-integration – ProviderManager Integration Test

**After Phase 14 (ProviderManager complete)**

- Test switching between real providers
- Test model listing across all configured providers
- Test chat completion with each provider
- Verify seamless provider switching works with real APIs

## Integration Test Structure

Each integration test should:

1. Check for API key file in home directory
2. Skip tests if key not found (with informative message)
3. Test basic operations:
   - Model listing
   - Simple chat completion
   - Tool calling (if supported)
4. Run outside of vitest browser environment or use NODE_ENV=test
5. Provide clear output showing what was tested

## Benefits

- Catch API incompatibilities early
- Verify mocked behavior matches reality
- Ensure providers actually work before integration
- Build confidence in the implementation
- Avoid last-minute surprises when connecting to real services
