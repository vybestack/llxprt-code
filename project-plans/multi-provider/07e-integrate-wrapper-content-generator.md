# Phase 07e – Integrate GeminiCompatibleWrapper with ContentGenerator (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Modify the ContentGenerator to use ProviderManager and GeminiCompatibleWrapper when available, allowing the existing Gemini infrastructure to work with any provider.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/core/src/core/contentGenerator.ts` to support providers
- Updated factory function to check for and use ProviderManager
- Maintained backward compatibility with existing Gemini auth types

## Checklist (implementer)

- [ ] Since ContentGenerator is in core package and ProviderManager is in cli package:
  - [ ] Option 1: Pass provider instance through config/params
  - [ ] Option 2: Create provider hooks in cli package that intercept before ContentGenerator
  - [ ] Choose the cleanest approach that maintains package boundaries
- [ ] Modify the integration point to:
  - [ ] Check if a provider is active
  - [ ] If yes, create GeminiCompatibleWrapper around the provider
  - [ ] Use the wrapper as the content generator
  - [ ] Otherwise, use existing Gemini logic
- [ ] Ensure proper error handling for missing providers
- [ ] Maintain all existing functionality for Gemini auth types
- [ ] Add appropriate type definitions
- [ ] The integration must allow real API calls to flow through to OpenAI

## Self-verify

```bash
npm run typecheck
npm run lint
# Test that existing Gemini flow still works
npm test packages/core/src/core/contentGenerator.test.ts
# Verify conditional provider support
grep -n "ProviderManager\|GeminiCompatibleWrapper" packages/core/src/core/contentGenerator.ts
```

**STOP. Wait for Phase 07e verification.**
