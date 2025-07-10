# Phase 22-02 – Request builder & param passthrough (multi-provider)

## Goal

Create `buildResponsesRequest()` utility that converts our `IChatGenerateParams` into a valid `openai.responses.create` body supporting stateless and stateful modes.

## Deliverables

- `packages/cli/src/providers/openai/buildResponsesRequest.ts`
- Markdown mapping table `packages/cli/src/providers/openai/docs/params-mapping.md`
- Tests `buildResponsesRequest.test.ts` (matrix snapshot)

## Checklist

- [x] Implement util with exhaustive fields.
- [x] Enforce schema limits (<16 tools, JSON <32 KB).
- [x] Warn & trim messages when `conversationId` present.
- [x] Support `prompt` shortcut & ambiguity error.
- [x] Green tests, lint, types.

## Self-verify

```bash
npm run typecheck && npm run lint && npm test --run buildResponsesRequest
```

STOP. Wait for Phase 22-02a verification.
