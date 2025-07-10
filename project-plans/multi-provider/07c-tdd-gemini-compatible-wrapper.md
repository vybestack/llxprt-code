# Phase 07c – TDD Tests for GeminiCompatibleWrapper (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Write comprehensive tests that define the expected behavior of GeminiCompatibleWrapper, ensuring it properly translates between provider formats and Gemini formats.

## Deliverables

- Created `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/adapters/GeminiCompatibleWrapper.test.ts` with failing tests
- Tests define the contract for stream adaptation and content generation

## Checklist (implementer)

- [ ] Create test file with proper imports and mocks
- [ ] Write tests for `generateContent()`:
  - [ ] Test that it calls provider's `generateChatCompletion`
  - [ ] Test that it formats the response like Gemini's format
  - [ ] Test error handling and propagation
- [ ] Write tests for `generateContentStream()`:
  - [ ] Test that it creates an async generator
  - [ ] Test that it adapts provider stream events to Gemini events
  - [ ] Test content accumulation and formatting
  - [ ] Test tool call adaptation
  - [ ] Test error event handling
- [ ] Write tests for OpenAI-specific adaptations:
  - [ ] Test role mapping (assistant → model)
  - [ ] Test streaming chunk assembly
  - [ ] Test tool call format conversion
- [ ] Mock IProvider and its stream responses appropriately
- [ ] Ensure tests fail with current NotYetImplemented stubs

## Self-verify

```bash
npm run typecheck
npm test packages/cli/src/providers/adapters/GeminiCompatibleWrapper.test.ts
# All tests should fail with NotYetImplemented errors
grep -c "NotYetImplemented" packages/cli/src/providers/adapters/GeminiCompatibleWrapper.test.ts
# Should return 0 - no reverse tests allowed
```

**STOP. Wait for Phase 07c verification.**
