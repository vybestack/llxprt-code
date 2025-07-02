# Phase 22-01 – Responses API bootstrap (multi-provider)

> **Scope guard** All changes live in `packages/cli`. No public-API breakages for other providers.

---

## Goal

Enable the CLI to call the GA `/v1/responses` endpoint through `openai.responses.{create|stream}` while leaving legacy models untouched.

## Deliverables

- `packages/cli/src/providers/openai/RESPONSES_API_MODELS.ts` – exported readonly array of model IDs.
- `packages/cli/src/providers/openai/OpenAIProvider.ts` updated with:
  - `shouldUseResponses(model:string):boolean` helper.
  - Env-flag override `OPENAI_RESPONSES_DISABLE`.
  - New private `callResponsesEndpoint()` skeleton (stateless, streaming + non-stream).
- Added fields to `IChatGenerateParams` interface (same folder): `stream?`, `conversationId?`, `parentId?`, `tool_choice?` and `stateful?`.
- Docs stub `docs/cli/openai-responses.md`.
- Jest/Vitest test files:
  - `OpenAIProvider.shouldUseResponses.test.ts`
  - `OpenAIProvider.callResponses.stateless.test.ts`
  - `OpenAIProvider.switch.test.ts`
- `npm run test:legacy` NPM script.

## Checklist (implementer)

- [x] Create constants & helper.
- [x] Add env-flag logic.
- [x] Implement `callResponsesEndpoint()` (stateless only).
- [x] Wire `generateChatCompletion` switch.
- [x] Extend types.
- [x] Write/green tests.
- [x] Add docs stub & legacy test script.

## Self-verify

```bash
npm run typecheck && npm run lint && npm test --run OpenAIProvider && npm run test:legacy
```

STOP. Wait for Phase 22-01a verification.
