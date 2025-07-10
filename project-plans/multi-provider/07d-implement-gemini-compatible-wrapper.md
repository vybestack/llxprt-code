# Phase 07d – Implement GeminiCompatibleWrapper (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Implement the GeminiCompatibleWrapper to translate between IProvider formats and Gemini's expected formats, making all Phase 07c tests pass.

## Deliverables

- Fully implemented `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/adapters/GeminiCompatibleWrapper.ts`
- Working stream adaptation from provider format to Gemini events
- All tests from Phase 07c passing

## Checklist (implementer)

- [ ] Implement `generateContent()`:
  - [ ] Convert messages to provider format
  - [ ] Call provider's `generateChatCompletion`
  - [ ] Collect full response from stream
  - [ ] Format response as Gemini GenerateContentResponse
- [ ] Implement `generateContentStream()`:
  - [ ] Return async generator matching Gemini's format
  - [ ] Adapt provider stream events to GeminiEvent types
  - [ ] Handle content streaming with proper event types
  - [ ] Convert tool calls to Gemini format
  - [ ] Handle errors appropriately
- [ ] Implement `adaptProviderStream()`:
  - [ ] Map provider message chunks to Gemini events
  - [ ] Accumulate content properly
  - [ ] Detect and convert tool calls
  - [ ] Generate appropriate completion events
- [ ] Handle provider-specific differences:
  - [ ] Role mapping (assistant → model)
  - [ ] Message format differences
  - [ ] Tool call format conversion
- [ ] Add proper error handling throughout

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/adapters/GeminiCompatibleWrapper.test.ts
# All tests should now PASS
! grep -n "NotYetImplemented" packages/cli/src/providers/adapters/GeminiCompatibleWrapper.ts
# Should find no NotYetImplemented
```

**STOP. Wait for Phase 07d verification.**
