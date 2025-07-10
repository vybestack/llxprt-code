# Phase 22 – OpenAI "Responses" Endpoint Support (multi-provider)

_This phase supersedes the earlier draft. It is now broken into **22 A–E** so that each PR remains review-able while steadily adding capability._

> **Scope guard** All changes live in `packages/cli`. No public API breakages for other providers.

---

## Big-picture goals

1. **Feature-parity** with `/v1/chat/completions` while using `/v1/responses` for new models.
2. **Stateless _or_ stateful**: support _either_ full message history _or_ the new `{conversation_id,parent_id}` flow to minimise tokens.
3. **Tooling first**: expose `tools` & `tool_choice` and handle the new `finish_reason = "tool_calls"` branch.
4. **Streaming first**: use `openai.responses.stream` when available; fall back to `.create` without code duplication.
5. **No regressions** for legacy models or for non-OpenAI providers.

---

## Deliverables (across 22 A-E)

| Sub-phase | Key deliverables                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22 A      | • Constants & type updates.<br>• Minimal switching logic (model → endpoint).<br>• Streaming wrapper skeleton.                                                         |
| 22 B      | • Full request mapper: messages → request body (chat or by-ID).<br>• Param passthrough (`stop`, `temperature`, `tool_choice`, …).                                     |
| 22 C      | • Streaming parser incl. `conversation_id`, `parent_id`, `finish_reason = tool_calls`, usage capture.<br>• Provider-level cache for IDs (keyed by `sessionId+model`). |
| 22 D      | • Tool conversion helper re-using existing `ToolFormatter`.<br>• Multiple-choice support (pick index 0 for now).                                                      |
| 22 E      | • Tests: unit + integration happy-path & edge cases.<br>• Docs update in `docs/cli/providers.md`.                                                                     |

Each sub-phase has its own checklist and finishes with **STOP** to allow verification.

---

## 22 A – API bootstrap (split into A1 – A5)

_This first slice is intentionally very small but explicit. Nothing touches streaming
parsers or tool-calls yet; we just make it \_possible_ to call `/v1/responses` without
breaking anyone.\_

| Sub-phase | Focus                                | Key Deliverables                                                                                                                                                                                                                                                                           | Verification                                                                                                            |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **22 A1** | Model gating & feature flag          | • `RESPONSES_API_MODELS` constant.<br>• `OPENAI_RESPONSES_DISABLE` env flag that forces legacy flow even for listed models.                                                                                                                                                                | **Tests** `OpenAIProvider.shouldUseResponses.test.ts` – matrix across (model, env flag).                                |
| **22 A2** | Public type additions                | • Extend `IChatGenerateParams` with:<br> – `stream?: boolean` (default `true`).<br> – `conversationId?: string`.<br> – `parentId?: string`.<br> – `tool_choice?: 'auto'\|'none'\|'required'`.                                                                                              | **Compile-time tests**: `types/openai-responses.d.ts` exercises new fields; `npm run typecheck` must pass.              |
| **22 A3** | Stateless `callResponses()` skeleton | • New internal method `callResponsesEndpoint(params): AsyncIterable<IMessageDelta>`.<br>• Implementation _temporarily_ sends the full `messages` history (`stateless`).<br>• Handles both streaming (`.stream`) and non-stream (`.create`) paths behind a helper to avoid duplicate logic. | **Tests**: `OpenAIProvider.callResponses.stateless.test.ts` using nock to simulate OpenAI.                              |
| **22 A4** | Provider switch wiring               | • `OpenAIProvider.generateChatCompletion` now delegates via:<br>`if shouldUseResponses(model) ⇒ callResponsesEndpoint else legacyChatCompletion`.<br>• All error paths wrap native OpenAI errors in our `ProviderError` just like legacy flow.                                             | **Integration test** `OpenAIProvider.switch.test.ts` – asserts correct endpoint called for (responses-model vs legacy). |
| **22 A5** | Regression guard & docs stub         | • `doc/openai-responses.md` (placeholder) added.<br>• `npm run test:legacy` target that re-runs a subset of existing tests with `OPENAI_RESPONSES_DISABLE=1` to make sure feature flag works.                                                                                              | **CI gate** ensures `npm run test:legacy` passes plus coverage not reduced.                                             |

### Cross-cutting Acceptance Criteria

1. **Zero behaviour change** for Gemini/Claude providers (compile + tests).
2. Adding a new model name to `RESPONSES_API_MODELS` should be a **one-line diff** with no other code changes.
3. When `OPENAI_RESPONSES_DISABLE` is set, the new code-path is completely skipped (verified by test).

### Additional Notes

• _Error & retry policy_, _stateful caching_, and _tool-call parsing_ are **out of scope for 22 A** and will be addressed in later slices.

**STOP — merge upon successful review, then continue with 22 B.**

---

## 22 B – request mapping & param passthrough (split into B1 – B4)

**Goal:** create a _fully-formed_ `/v1/responses` request regardless of whether the caller
supplies a whole message history or relies on conversation IDs. Also forward all
tuning/formatting parameters we support today.

| Sub-phase | Focus                           | Key Deliverables                                                                                                                                                                                                    | Verification                                                                        |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **22 B1** | Helper + exhaustive types       | • `buildResponsesRequest(params): OpenAI.ResponsesCreateParams` util.<br>• Exhaustive mapping table (markdown doc in same folder) showing `IChatGenerateParams → responses` field names.                            | **Tests** `buildResponsesRequest.test.ts` – matrix-driven snapshot of request JSON. |
| **B2**    | Stateful trimming logic         | • If `conversationId` present, include **only the last 2 messages** (assistant+user) to give enough context per OpenAI guidance.<br>• Guard-rail: if caller _also_ includes >4 messages we log a warn & still trim. | Unit tests: verify message count in request body given various inputs.              |
| **B3**    | Prompt style fallback           | • Support `prompt:string` shortcut (no messages) by converting to single user-role message.<br>• Throws typed error if _both_ `prompt` and `messages` passed (ambiguous).                                           | Unit test + negative test.                                                          |
| **B4**    | Param passthrough & tool fields | • Pass `tools`, `tool_choice`, `stop`, `response_format`, etc.<br>• Enforce schema size limits (<16 tools, JSON < 32 KB) & throw `ProviderError` otherwise.                                                         | Unit tests for limit enforcement + param echo round-trip using fake OpenAI client.  |

Cross-cut AC: `npm run typecheck` passes; snapshot test redlines act as API-change detector.

**STOP — PR review, then continue.**

### New behaviour

- Accept _either_ full `messages` or {conversationId,parentId}+`messages[-2..]` and build the proper `/v1/responses` request body.
- Pass through all tuning params we already support for chat (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `stop`, `max_tokens`, `seed`, `user`).
- Expose `tool_choice` in our public `IChatGenerateParams`.

### Tasks

- [ ] Create helper `buildResponsesRequest(params): OpenAI.ResponsesCreateParams`.
- [ ] When `conversationId` supplied, omit earlier messages.
- [ ] Fallback to `prompt` style when caller gives `prompt: string` and no messages.
- [ ] **Tests** for param forwarding.

**STOP – await 22 B review.**

---

## 22 C – streaming parser & stateful cache (C1 – C5)

| Sub-phase | Focus                  | Key Deliverables                                                                                                                                                                                                           | Verification                                                                    |
| --------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **C1**    | Low-level SSE reader   | • `parseResponsesStream(rawStream): AsyncIterable<RawChunk>` that handles keep-alive lines, `data:` prefix stripping, JSON parse, `[DONE]`.                                                                                | Unit test with fixture file of mixed chunks.                                    |
| **C2**    | Delta adapter          | • Convert `RawChunk` into our `IMessageDelta` structure (supports `content`, `tool_calls`, `function_call`).<br>• Emits `onUsage(usage)` once `[DONE]` seen.                                                               | Snapshot test of exemplar stream → list of deltas.                              |
| **C3**    | ConversationCache util | • LRU cache (max=100, ttl=2h) keyed by `{sessionId,model}` storing `{conversationId,parentId}`.<br>• Public API: `get(sessionId,model)`, `set(...)`, `invalidate(sessionId,model)`.                                        | Unit tests: eviction order, ttl expiry via `vi.useFakeTimers()`.                |
| **C4**    | Provider integration   | • `callResponsesEndpoint` saves first-chunk IDs into cache; subsequent calls auto-inject IDs when caller omitted.<br>• Add `stateful?: boolean` param (default true). When false we skip cache look-up.                    | Integration test: sequence of two calls verifies token count drop & IDs reused. |
| **C5**    | Error / retry policy   | • Map new HTTP errors: 409→`ConflictError`, 410→`ThreadGoneError` (auto-invalidates cache), 422→`ValidationError`.<br>• Implement single-retry with exponential back-off for 5xx & rate-limit using existing retry helper. | Fault-injection tests via nock.                                                 |

Cross-cut AC: dropping network mid-stream should surface `ProviderStreamError` and consumer must receive `onError`. Existing providers compile.

**STOP.**

### New behaviour

- Parse each SSE chunk → emit `IMessageDelta`.
- On the **first** chunk that exposes `conversation_id`/`parent_id`, store it in an in-memory LRU keyed by `sessionId+model` (simple Map OK for CLI use).
- Recognise `finish_reason = 'tool_calls'` and convert to our internal tool-call representation.
- Capture `usage` from the `[DONE]` chunk and surface via existing hooks.

### Tasks

- [ ] Implement `parseResponsesStream()` generator.
- [ ] Add `ConversationCache` utility with max 100 live threads (configurable).
- [ ] Update provider to fetch cached IDs on next call when caller did not pass explicit history.
- [ ] Comprehensive streaming unit test (mocked SSE).

**STOP – await 22 C review.**

---

## 22 D – tool conversion, multi-choice & execution contract (D1 – D4)

| Sub-phase | Focus                                   | Key Deliverables                                                                                                                                                        | Verification                                                               |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **D1**    | Tool schema helper                      | • `ToolFormatter.toResponsesTool()` ensures names ≤90 chars, descriptions ≤256, argument schemas obey OpenAPI 3.1 subset.<br>• Throws `ProviderError` on violation.     | Unit tests with edge-case schemas.                                         |
| **D2**    | Multi-choice handling                   | • If `choices.length > 1`, provider selects index 0 by default, attaches `meta.skippedChoices=n`, and logs debug.<br>• TODO flag for future improvement.                | Mocked stream yielding 2 choices; test asserts first choice output & meta. |
| **D3**    | finish_reason = tool_calls              | • When parser sees `tool_calls`, accumulate until fully-formed and emit synthetic assistant-role delta with `toolCall` field set (array).                               | Stream fixture test.                                                       |
| **D4**    | Synchronous vs async execution contract | • Document + enforce that CLI _always_ returns delta with `toolCall` and waits for **caller** to execute tool synchronously before continuing thread (no auto-execute). | Contract test in CLI package using in-process fake tool.                   |

**STOP.**

### Tasks

- [ ] Extend `ToolFormatter` with `toResponsesTool()` (same schema except wrapper key names).
- [ ] Support `choices.length > 1`: emit index 0 and log a debug warning.
- [ ] Add tests: finish_reason `tool_calls`, multiple choices.

**STOP – await 22 D review.**

---

## 22 E – docs, samples & regression matrix (E1 – E3)

| Sub-phase | Focus         | Key Deliverables                                      | Verification |
| --------- | ------------- | ----------------------------------------------------- | ------------ |
| **E1**    | Provider docs | • `docs/cli/providers-openai-responses.md` including: |

– Stateless vs stateful usage examples
– Tool-call round-trip snippet
– Feature flag instructions
| MDX unit tests via `markdown-link-check`. |
| **E2** | Regression suite | • Add Vitest integration file that exercises:
– Legacy chat completion
– Responses stateless
– Responses stateful w/ cache
– Tool call path
| CI must pass with live key in nightly scheduled run. |
| **E3** | Performance benchmark optional | • Script printing tokens-sent / latency for same prompt under three modes; stored in `benchmark/`. | Manual run, numbers captured in PR description. |

**END OF PHASE 22**

### Tasks

- [ ] Update provider README / docs with usage examples for stateless vs stateful.
- [ ] Ensure other providers (Gemini, Claude) compile untouched.
- [ ] End-to-end manual test with real OpenAI key (env `OPENAI_API_KEY`).

**STOP – end of Phase 22.**
