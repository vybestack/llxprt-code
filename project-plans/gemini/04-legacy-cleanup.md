# Phase 4 – Legacy Cleanup (gemini)

**STOP**: After completing all tasks in this phase, do not proceed. Wait for Phase 4a verification.

## Goal

Remove legacy dual-path code and ensure all Gemini interactions go through the provider architecture. Update the core library integration to work seamlessly with the provider.

## Deliverables

- [x] Update `createContentGenerator` in `packages/core/src/core/contentGenerator.ts` to use provider auth info
- [x] Remove legacy branching based on empty `activeProviderName` throughout codebase
- [x] Update Config class to delegate Gemini auth to provider
- [x] Remove direct `AuthType.USE_PROVIDER` checks where Gemini is concerned
- [x] Ensure sandbox environment variables work with provider-based auth
- [x] Update any remaining legacy Gemini model selection code

## Checklist (implementer)

- [x] Modified `contentGenerator.ts` to work with provider-based auth
- [x] Removed checks for empty `activeProviderName` in relevant files
- [x] Updated Config to integrate with GeminiProvider for auth
- [x] Verified sandbox copies correct environment variables
- [x] Removed legacy model dialog code if any remains
- [x] All Gemini paths now go through provider
- [x] No direct AuthType checks bypass provider for Gemini
- [x] Type checking passes
- [x] Linting passes
- [x] All tests pass

## Implementation Notes

- Be careful not to break other providers (OpenAI, Anthropic)
- The core library should still work but get its auth from the provider
- Maintain backward compatibility where possible

## Self-verify

Run these commands to verify your implementation:

```bash
npm run typecheck
npm run lint
npm test
```

## End note

STOP. Wait for Phase 4a verification before marking the plan complete.
