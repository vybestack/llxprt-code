# Phase 07f – Integration Test Multi-Provider Chat (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Create and run integration tests that verify the complete flow from CLI commands through to actual provider API calls, ensuring the multi-provider system works end-to-end.

## Deliverables

- Created `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/integration/multi-provider.integration.test.ts`
- Tests verify `/provider`, `/model` commands and actual chat with OpenAI
- Manual test script for interactive verification

## Checklist (implementer)

- [ ] Create integration test file that:
  - [ ] Initializes ProviderManager with OpenAI (using ~/.openai_key)
  - [ ] Tests provider switching via commands
  - [ ] Tests model switching within provider
  - [ ] Tests actual chat completion through the wrapper with REAL API calls
  - [ ] Verifies streaming works correctly with actual OpenAI responses
  - [ ] Tests with different models (gpt-3.5-turbo, gpt-4, etc.)
  - [ ] Tests error handling (invalid provider, missing API key, invalid model)
- [ ] Create manual test script at `packages/cli/test-multi-provider.js`:
  - [ ] Sets up minimal CLI environment
  - [ ] Allows testing provider commands interactively
  - [ ] Sends test message and displays streaming response
  - [ ] Shows how to switch between models
- [ ] Skip tests if API key not available (with clear message)
- [ ] Document expected output format and example responses
- [ ] Add console test instructions showing exact commands to type

## Self-verify

```bash
npm run typecheck
npm run lint
# Run integration tests (requires ~/.openai_key)
npm test packages/cli/src/providers/integration/multi-provider.integration.test.ts
# Run manual test
node packages/cli/test-multi-provider.js
```

**STOP. Wait for Phase 07f verification.**
