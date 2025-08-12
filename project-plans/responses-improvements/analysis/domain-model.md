# Domain Model: OpenAI Responses Improvements

This document analyzes the domain for implementing the Formal Requirements in specification.md (REQ-001..REQ-010). It is analysis-only: no implementation details beyond articulating behavior and states.

Entities
- IMessage (existing):
  - role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  - content: string
  - tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  - tool_call_id?: string (for tool messages)
  - usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  - id?: string (provider response id, when available)
- OpenAIProvider (existing): orchestrates endpoint selection, request building, streaming/non-streaming parsing, conversation cache updates.
- ConversationCache (existing): stores last messages and accumulated token counts keyed by (conversationId, parentId).
- Responses Request/Response (OpenAI /v1/responses):
  - Request (we build): { model, input[] | prompt, tools[], previous_response_id?, store?, stream? }
  - Streaming events: response.output_text.delta, response.message_content.delta, response.output_item.added/done, response.function_call_arguments.delta/done, response.completed
  - Non-streaming: top-level object { id, object: 'response', model, usage?, output: [ items ] }
- ProviderConfig additions (new): flags and numeric limits (REQ-003, REQ-005, REQ-006)

State Transitions
1) Endpoint Selection
  - Input: currentModel, providerConfig, env
  - Output: Use /responses vs legacy chat/completions
  - Transition Rule (REQ-005, REQ-009):
    - If OPENAI_RESPONSES_DISABLE === 'true' → legacy
    - Else if providerConfig.openaiResponsesEnabled === true → responses (even for non-standard baseURLs)
    - Else if baseURL !== https://api.openai.com/v1 → legacy
    - Else if model in RESPONSES_API_MODELS → responses
    - Else → legacy

2) Request Build
  - Input: messages|prompt, tools, conversationId, parentId
  - Output: Responses request object
  - Rule (REQ-004): if previous_response_id provided, omit redundant history or ensure last-complete-turn only; do not send unsupported stateful fields.

3) Streaming Parse
  - Input: SSE stream
  - Output: Async sequence of IMessage
  - Rules:
    - Emit text chunks as assistant messages
    - Assemble function_call items from added + arguments.delta + done → yield tool_calls array message when complete
    - On response.completed, prefer usage from server (REQ-002)
    - Reasoning toggle (REQ-003): if disabled, never interpret JSON "reasoning" payloads; if enabled and model allowed, format Thinking + Answer

4) Non-streaming Parse (NEW)
  - Input: response JSON object with output[]
  - Output: Ordered IMessage[] of content chunks and tool_calls; final usage-bearing message

5) Cache Update
  - Input: conversationId, parentId, collected messages for this turn, usage
  - Output: Updated accumulated tokens and cached messages
  - Rule (REQ-002): use server usage if present; else estimator fallback

Business Rules
- BR1 (REQ-001): Non-streaming parser must traverse response.output items: for type 'message' collect text (preserve order); for type 'function_call' collect tool calls; map usage into final message.
- BR2 (REQ-002): Prefer server usage over estimators; emit usage message even when only streaming chunks were yielded.
- BR3 (REQ-003): Reasoning rendering is behind config showReasoningThinking (default false) and only for reasoningAllowedModels.
- BR4 (REQ-004): previous_response_id presence implies server-side state; either omit history or include a deterministic last-complete-turn slice; remove unsupported request fields (no arbitrary stateful flags if not part of spec).
- BR5 (REQ-005): Allow opt-in responses on custom gateways; env disable supersedes all.
- BR6 (REQ-006): Tools limits configurable; enforce precise size/count checks with DEBUG warnings before hard errors.
- BR7 (REQ-007): Documentation examples must match input/function_call/function_call_output and streaming SSE event types.
- BR8 (REQ-009): Legacy chat/completions path unchanged and remains default for non-supported models unless opt-in.
- BR9 (REQ-010): Add DEBUG logs for trimming decisions and token cache updates without leaking contents.

Edge Cases
- EC1: Non-streaming response with empty output[] but usage present → emit only usage message (REQ-002.3).
- EC2: Function call missing call_id → use item.id (already handled for streaming; mirror for non-streaming) (BR1).
- EC3: Interleaved message + function_call order in output → preserve input order in emitted IMessage sequence (BR1).
- EC4: Tools array too large or too many → configurable soft warning then hard fail with precise diagnostics (REQ-006).
- EC5: Base URL set to proxy that supports /responses → allow via config override; but if OPENAI_RESPONSES_DISABLE=true → must disable (REQ-005.2).
- EC6: Reasoning JSON embedded in text that is not complete JSON → if toggle enabled, only render when complete and model allowed; otherwise stream as plain text (REQ-003).
- EC7: Response.completed absent (abrupt stream end) → no usage; estimator fallback allowed; do not fabricate usage (REQ-002.2).
- EC8: previous_response_id with mismatched or partial local history → either drop local history or slice to last-complete-turn to avoid inconsistency (REQ-004.2).

Error Scenarios
- ES1: 422 context_length_exceeded → invalidate cache and retry stateless; if retry fails, surface provider error (existing behavior; maintain) (REQ-009).
- ES2: 4xx/5xx with JSON error → map to parseErrorResponse (existing); ensure descriptive message (REQ-009).
- ES3: Invalid tools schema or size → throw with clear message including KB size and limit (REQ-006).

Mapping Requirements → Behaviors
- REQ-001 → BR1, EC1, EC2, EC3
- REQ-002 → BR2, EC1, EC7
- REQ-003 → BR3, EC6
- REQ-004 → BR4, EC8
- REQ-005 → BR5, EC5
- REQ-006 → BR6, EC4
- REQ-007 → BR7
- REQ-009 → BR8, ES1, ES2
- REQ-010 → BR9

Notes
- No external HTTP in tests; simulate SSE and JSON payloads.
- Immutable patterns: treat emitted messages as new objects; do not mutate caches in-place (return new state where applicable).
