# Phase 2 – Authentication Integration (gemini)

**STOP**: After completing all tasks in this phase, do not proceed. Wait for Phase 2a verification.

## Goal

Enhance `GeminiProvider` to handle all three authentication methods (OAuth, Gemini API key, Vertex AI) and implement the fallback hierarchy.

## Deliverables

- [x] Add authentication mode tracking to `GeminiProvider` in `packages/cli/src/providers/gemini/GeminiProvider.ts`
- [x] Implement OAuth support in the provider (read from existing auth config)
- [x] Implement Vertex AI credential support (check env vars: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_API_KEY`)
- [x] Implement fallback hierarchy: Vertex → Gemini API key → OAuth prompt
- [x] Update `getModels()` to return fixed list for OAuth mode, fetch from API for others
- [x] Add method to determine best available authentication method

## Checklist (implementer)

- [x] Added `authMode` property to track current authentication type
- [x] Created `determineBestAuth()` method that checks available credentials
- [x] Modified `getModels()` to handle OAuth mode (return fixed list)
- [x] Added Vertex AI environment variable checks
- [x] Implemented proper fallback when no credentials available
- [x] Provider can read from existing Config auth settings
- [x] All authentication modes properly set environment variables
- [x] Type checking passes
- [x] Linting passes

## Implementation Notes

- DO NOT remove or modify existing auth system yet
- Provider should read from existing Config to maintain compatibility
- OAuth mode should return only: `gemini-2.5-pro`, `gemini-2.5-flash`
- Vertex AI requires: `GOOGLE_GENAI_USE_VERTEXAI=true` plus credentials

## Self-verify

Run these commands to verify your implementation:

```bash
npm run typecheck
npm run lint
npm test -- --testPathPattern=gemini
```

## End note

STOP. Wait for Phase 2a verification before proceeding to Phase 3.
