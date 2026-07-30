# Plan: Issue #2817 — Estimate the finalized prompt envelope before first send and reconcile provider usage

## Goal

Before the first provider usage of a turn, estimate the _same finalized prompt
envelope_ that is about to be sent. After the provider call succeeds, the
provider-reported `promptTokens` remains authoritative. The estimate lets the
agent layer make compression / context-limit decisions using the real
provider-shaped envelope (history + pending content + merged system/developer
instructions + tools + provider-added prompt material) instead of a generic
character heuristic that diverges from what the provider actually bills.

## Acceptance Matrix

| #   | Acceptance criterion                                                                                                                                                                                                                         | Proven by (test)                                                                                                                                                                                | Slice |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| A1  | Provider-neutral prompt-estimation request/result contract exists in core, owned by `packages/core/src/runtime/contracts`, with no tokenizer/projection logic in core.                                                                       | `PromptEstimation.test.ts` — structural contract accepts projection + returns result with model identity, protocol, method/version, projection revision, token count, unsupported-media marker. | S1    |
| A2  | The estimate result includes model identity, protocol, method/version, and projection revision, and carries **no** raw prompt payload (no logging/persistence of raw prompt).                                                                | `PromptEstimation.test.ts` — result shape asserts no prompt-bearing fields.                                                                                                                     | S1    |
| A3  | Anthropic Messages provider owns a pure prompt-bearing projection of the finalized request body (the same `requestBody` used by transport). Estimation shares that preparation representation.                                               | `AnthropicPromptEnvelopeProjection.test.ts` — real `prepareAnthropicRequest` is invoked and the projection returns its finalized `requestBody` + identifies protocol/method/revision.           | S2    |
| A4  | OpenAI Chat provider owns the same kind of projection over its `requestBody`.                                                                                                                                                                | `OpenAIChatPromptEnvelopeProjection.test.ts` — real `prepareRequest` produces the shared envelope.                                                                                              | S2    |
| A5  | OpenAI Responses provider owns the same kind of projection over its `request`.                                                                                                                                                               | `OpenAIResponsesPromptEnvelopeProjection.test.ts` — real `buildRequestContext` produces the shared envelope.                                                                                    | S2    |
| A6  | A behavioral first-turn test proves history, pending content, merged system/developer instructions, tools, and provider-added prompt material **all** affect the pre-send estimate (adding any of them increases the estimated token count). | `TurnProcessor.promptEnvelopeEstimation.test.ts` — observable estimate that changes as each input dimension grows.                                                                              | S3    |
| A7  | Agents invoke estimation after known mutations and before compression/context-limit decisions and transport; re-estimate materially changed retries.                                                                                         | `TurnProcessor.promptEnvelopeEstimation.test.ts` — estimate is produced before the provider call and observable; a materially larger retry produces a fresh estimate.                           | S3    |
| A8  | Provider actual usage remains authoritative and includes cached prompt tokens for context occupancy.                                                                                                                                         | `TurnProcessor.promptEnvelopeEstimation.test.ts` — after success, `historyService.syncTotalTokens` is called with the provider-reported prompt tokens (which include cache reads).              | S3    |
| A9  | Unsupported media is explicit (estimate result flags it), not silently caption-only.                                                                                                                                                         | `PromptEstimation.test.ts` + projection tests — projection surfaces `unsupportedMedia` entries.                                                                                                 | S1/S2 |
| A10 | Tests exercise real request preparation and observable behavior, not mock-call theater.                                                                                                                                                      | All slice tests use real preparation functions / real structural contracts.                                                                                                                     | S1–S3 |

## Explicit Non-Goals

- No new dependencies.
- No workflow / CI / quality-tool changes.
- No `.llxprt` changes.
- No CLI-only changes (CLI owns no tokenizer/projection logic).
- No media token formulas, tokenizer assets, calibration, or adaptation.
- No ContextManager rewrite.
- No TPM / cost / prompt-reduction.
- No broader estimation framework — only the minimal contract + projection seam
  necessary for the accepted behavior.
- No git commit / push / PR.

## Bounded Vertical Slices

### S1 — Core contract (RED → GREEN)

- New file `packages/core/src/runtime/contracts/PromptEstimation.ts`:
  - `PromptEnvelopeProtocol` literal union: `'anthropic-messages' | 'openai-chat' | 'openai-responses'`.
  - `PromptEnvelopeMethod` — the wire method/version (e.g. `'messages/v1'`,
    `'chat/completions/v1'`, `'responses/v1'`).
  - `UnsupportedMediaEntry` — `{ kind: 'unsupported'; reason: string; mediaType?: string }`.
  - `PromptEnvelopeEstimate` (result):
    - `estimatedPromptTokens: number`
    - `model: string`
    - `protocol: PromptEnvelopeProtocol`
    - `method: PromptEnvelopeMethod`
    - `projectionRevision: number`
    - `unsupportedMedia: readonly UnsupportedMediaEntry[]`
    - **No raw prompt payload** (no `requestBody`, no messages, no system text).
  - `PromptEnvelopeProjection` (provider-implemented seam): a pure value that
    carries the finalized preparation representation + the tokenizer to apply,
    WITHOUT exposing raw prompt to core (core never reads it; providers count
    against it themselves). Concretely:
    - `countProjectedTokens: () => Promise<number>` — provider counts tokens
      against its own finalized representation.
    - `describeProjection(): { protocol; method; projectionRevision; model; unsupportedMedia }`
- Export from `packages/core/src/runtime/contracts/index.ts`.
- Test: `packages/core/src/runtime/contracts/PromptEstimation.test.ts`.

### S2 — Provider projection seams (RED → GREEN per provider)

Each provider already builds a finalized request body in its preparation path.
The seam reuses that exact representation:

- **Anthropic**: `AnthropicRequestContext.requestBody` is the finalized
  envelope. Add `projectAnthropicPromptEnvelope(context)` returning a
  `PromptEnvelopeProjection` whose `countProjectedTokens` serializes the
  `requestBody` and counts with the provider's tokenizer/char estimator.
  Method: `'messages/v1'`, protocol: `'anthropic-messages'`, revision: `1`.
- **OpenAI Chat**: `RequestContext.requestBody` (`ChatCompletionCreateParams`).
  Add `projectOpenAIChatPromptEnvelope(requestContext)`. Method:
  `'chat/completions/v1'`, protocol: `'openai-chat'`, revision: `1`.
- **OpenAI Responses**: `RequestContext.request` (`OpenAIResponsesRequest`).
  Add `projectOpenAIResponsesPromptEnvelope(requestContext)`. Method:
  `'responses/v1'`, protocol: `'openai-responses'`, revision: `1`.

Each provider exposes the projection via an optional method on the structural
`RuntimeProvider` contract surface (`projectPromptEnvelope?`) so the agent
layer can call it without importing provider internals. Core stays neutral.

### S3 — Agent invocation + usage reconciliation (RED → GREEN)

- `TurnProcessor`: before the provider call (after
  `enforceProviderContents`, before `_executeProviderCall` transport), if the
  provider implements `projectPromptEnvelope`, obtain the estimate and record it
  (observable via a captured field / callback used by tests and by compression
  decisioning). Re-estimate on materially changed retries.
- `MessageStreamOrchestrator._checkSessionLimits`: prefer the provider
  envelope estimate over the generic pending-tokens fallback when available,
  so context-limit decisions use the finalized envelope.
- Usage reconciliation already exists (`_syncTokenCounts` uses
  `response.usage.promptTokens` which includes cache reads). Ensure cached
  prompt tokens are included in context occupancy (already true via
  `cachedTokens`/`cache_read_input_tokens`). Add an explicit behavioral test.

## Expected Paths

- `packages/core/src/runtime/contracts/PromptEstimation.ts` (new)
- `packages/core/src/runtime/contracts/index.ts` (export)
- `packages/core/src/runtime/contracts/PromptEstimation.test.ts` (new)
- `packages/providers/src/runtime/promptEnvelopeProjections.ts` (new, projections)
- `packages/providers/src/runtime/promptEnvelopeProjections.test.ts` (new)
- `packages/providers/src/IProvider.ts` (optional `projectPromptEnvelope?`)
- `packages/core/src/runtime/contracts/RuntimeProvider.ts` (optional method)
- `packages/agents/src/core/TurnProcessor.ts` (invoke + reconcile)
- `packages/agents/src/core/TurnProcessor.promptEnvelopeEstimation.test.ts` (new)
- `packages/agents/src/core/MessageStreamOrchestrator.ts` (use estimate)

Target: ≤ 25 changed files, ≤ 1,500 net lines.

## Scope Ledger

| Item                           | Status                                      | Notes                          |
| ------------------------------ | ------------------------------------------- | ------------------------------ |
| Files changed                  | tracking                                    | See "Expected Paths"           |
| Net lines                      | tracking                                    | Will record final              |
| New dependency                 | none                                        |                                |
| New subsystem/framework        | none — minimal contract + seam only         |                                |
| New public abstraction         | one optional provider method + one contract | authorized by issue            |
| Workflow change                | none                                        |                                |
| Quality-tool change            | none                                        |                                |
| .llxprt change                 | none                                        |                                |
| CLI tokenizer/projection logic | none                                        | CLI owns none                  |
| Media formula/calibration      | none                                        | Only explicit unsupported flag |
| ContextManager rewrite         | none                                        |                                |

## Mandatory Scope Review Checkpoints

- Stop and report if changed files > 40.
- Stop and report if net lines > 2,500.
- Stop and report if an unplanned subsystem / public abstraction / workflow /
  dependency / quality-tool / memory change is required.
