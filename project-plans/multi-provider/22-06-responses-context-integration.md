# Phase 22-06 – Remote-context accounting & UI indicator (multi-provider)

Integrate the new Responses stateful flow with the existing **context-left** logic so the status bar reflects true token headroom when remote (server-stored) history is included.

---

## Goal

Track cumulative tokens already stored on the server for each conversation and deduct them, together with the next prompt, from the model’s maximum context window to produce an accurate percentage and trigger trim warnings.

## Deliverables

- `packages/cli/src/providers/openai/ConversationCache.ts` enhanced to store `promptTokensAccum: number`.
- New util `packages/cli/src/providers/openai/estimateRemoteTokens.ts`.
- Config map `MODEL_CONTEXT_SIZE` (`o3` & `o3-pro` = 128_000, fallback 128k).
- Status-line renderer update in `packages/cli/src/ui/status.tsx` (or existing file) to use new estimator.
- Warning & auto-trim hook inside `OpenAIProvider.callResponsesEndpoint` (only if `stateful` true and `contextLeft < 4_000`).
- Retry logic on 422 `context_length_exceeded` (invalidate cache → resend stateless once).
- Tests:
  - `ConversationCache.accumTokens.test.ts`
  - `estimateRemoteTokens.test.ts`
  - `ContextIndicator.ui.test.tsx` (mock remote + prompt sizes → expect percent)
  - Integration `ResponsesContextTrim.integration.test.ts` simulates 120k stored + 10k prompt.

## Checklist (implementer)

- [x] Extend cache interface & write migration code.
- [x] Increment `promptTokensAccum` after each call.
- [x] Implement estimator util & model window constants.
- [x] Patch status UI to display new percent.
- [x] Add auto-trim warning + optional `autoTrimRemote` flag.
- [x] Handle 422 retry/invalidate.
- [x] All new tests green, lint & typecheck pass.

## Self-verify

```bash
npm run typecheck && npm run lint \
  && npm test --run ResponsesContext --run ConversationCache --run ContextIndicator
```

STOP. Wait for Phase 22-06a verification.
