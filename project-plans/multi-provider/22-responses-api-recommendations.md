# Phase 22 Responses API – Updated Alignment (July 2025)

The production **openai-node** SDK (v5.9+) now ships a dedicated **`openai.responses`** namespace that surfaces the new `/v1/responses` endpoint. It supports both streaming (`openai.responses.stream`) and non-stream (`.create`) helpers and returns `conversation_id` & `parent_id` on the first SSE chunk. Our plan therefore embraces this API directly and drops any language suggesting it is “missing” or “beta”.

Key facts (SDK v5.9):
• `openai.responses.create(params)` — non-stream call returning a full `Response` object.  
• `openai.responses.stream(params)` — returns an `AsyncIterable` of incremental chunks terminating with `[DONE]`.  
• Request body uses the familiar `messages: Array<{role, content}>` syntax.  
• Optional `{conversation_id, parent_id}` may be sent to achieve stateful threading and token savings.  
• Tool calling schema and multimodal image items are identical to Chat Completions.

Everything below reconciles our implementation slices with that reality while keeping audio out of scope.

---

## 1 Correct API Calls

| Concern             | Reality                                                                                                 | Plan Action                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Endpoint helper** | `openai.responses.{create                                                                               | stream}`                                                    | Call these directly for models in RESPONSES_API_MODELS; fall back to `chat.completions` otherwise. |
| **Thread IDs**      | Request: caller **may** send `conversation_id` & `parent_id`.<br>Response stream returns updated IDs.   | Keep these names in our types; drop `previous_response_id`. |
| **Retrieve by ID**  | `openai.responses.retrieve(id)` exists but is intended for audit/logging, not live thread continuation. | Not required in CLI flow; keep local cache strategy.        |

---

## 2 Schema & Content Handling

| Topic                 | SDK Schema                                                                                   | Implementation Note                                              |
| --------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Request messages**  | `messages: Array<{role, content}>`                                                           | Retain; we optionally prune to last 2 when IDs provided.         |
| **Multimodal**        | Each `content` item can be `{type:'text',text:...}` or `{type:'image_url',image_url:{url}}`. | Multimodal left for **Phase 23**; current Phase 22 is text-only. |
| **Tools / Functions** | Same JSON-schema as Chat Completions.                                                        | Keep existing `ToolFormatter`; no new built-ins.                 |
| **Audio**             | Separate `audio.*` helpers, unrelated to chat.                                               | Out of scope for CLI coding tool.                                |

---

## 3 Stateful Conversation Cache

- We keep an **in-memory LRU (100 entries, 2 h TTL)** in Phase 22.
- A disk-backed cache can ship in Phase 24 if we see practical benefit.

---

## 4 Revised Extra Phases

| Phase                      | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| **23 – Multimodal**        | Add support for `image_url` content items once needed.             |
| **24 – Disk Cache & Perf** | Persist conversation map across CLI sessions; add perf benchmarks. |

Audio endpoints, built-in `web_search`, citation annotations or automatic tool
execution remain **unscheduled** until they appear in a stable OpenAI release.

---

## 5 Testing Updates

- Unit tests already enumerated per slice (see primary 22-plan).
- Remove references to multimodal and `.retrieve()` tests from Phase 22.
- Add negative test: passing unknown top-level fields (`input`, `previous_response_id`) throws `ProviderError`.

---

## 6 Documentation

- Update `docs/cli/providers-openai-responses.md` to clarify that the API
  surface is still `chat.completions` and that “Responses” is just a naming
  convention inside our codebase.
- Emphasise that statefulness is _optional_ and controlled via
  `conversationId`/`parentId`.

---

### Summary

This file now reflects the **GA Responses API** in the `openai-node` SDK. Our
Phase-22 implementation will:

1. Call `openai.responses.{stream|create}` for supported models.
2. Maintain optional state via `conversation_id` / `parent_id` with an in-memory
   LRU cache.
3. Continue using the familiar `messages[]` schema and existing tool-call JSON.
4. Defer multimodal images and disk-backed cache to later phases.
5. Keep audio and speculative built-in web/file search tools out of scope for a
   coding-centric CLI.

With this alignment, we avoid inconsistencies and fully leverage the officially
supported Responses endpoint without unnecessary detours.

This approach provides practical improvements without chasing undocumented APIs.
