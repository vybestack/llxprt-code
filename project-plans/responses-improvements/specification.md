# Feature Specification: OpenAI Responses Improvements

## Purpose
Improve our OpenAI Responses API integration for correctness, configurability, and testability. Specifically: correct non-streaming parsing, prefer server-provided usage in accounting, make reasoning rendering opt-in, clarify stateful handling, allow Responses on custom base URLs with explicit opt-in, make tool limits configurable, and align docs/tests.

## Architectural Decisions
- Pattern: Provider adapter with separate request builder, stream/non-stream parsers, and conversation cache. Configuration-driven behavior toggles.
- Technology Stack: TypeScript (strict), Vitest, Node.js 20.x. No new runtime deps.
- Data Flow:
  1) OpenAIProvider decides endpoint (responses vs chat) based on model + config
  2) Request built via buildResponsesRequest
  3) /v1/responses:
     - Streaming: parseResponsesStream → IMessage iterator
     - Non-streaming: new parseResponsesNonStreaming → IMessage[] iterator
  4) Usage handling updates ConversationCache (prefer server usage)
  5) Optional reasoning rendering gate via provider config
- Integration Points: OpenAI /v1/responses endpoint, existing ConversationCache, ToolFormatter, Provider configuration.

## Project Structure

packages/core/src/providers/openai/
- OpenAIProvider.ts           # Switch, call endpoints, cache integration
- buildResponsesRequest.ts    # Request mapper
- parseResponsesStream.ts     # Streaming parser
- parseResponsesNonStreaming.ts  # NEW: Non-streaming parser for /responses
- providerConfig.ts           # NEW/EXTEND: Config typings and defaults
- RESPONSES_API_MODELS.ts
- syntheticToolResponses.ts

docs/
- cli/providers-openai-responses.md (updated)

## Technical Environment
- Type: Library (CLI-embedded provider)
- Runtime: Node.js 20.x
- Testing: Vitest
- No network in unit tests; streams simulated

## Formal Requirements
[REQ-001] Non-streaming Responses parsing
  [REQ-001.1] When OpenAI /v1/responses returns non-streaming response, the provider MUST parse the top-level response object, not chat/completions shape.
  [REQ-001.2] MUST collect text content from response.output/message items into ordered IMessage chunks.
  [REQ-001.3] MUST map function_call items into IMessage.tool_calls with correct id/name/arguments.
  [REQ-001.4] MUST emit a final IMessage containing usage mapped to {prompt_tokens, completion_tokens, total_tokens} when usage exists.

[REQ-002] Usage-driven accounting
  [REQ-002.1] In streaming mode, when response.completed contains usage, cache MUST update using server usage for accumulated tokens.
  [REQ-002.2] When usage not provided, MAY fall back to estimator; estimator MUST NOT override server usage when present.
  [REQ-002.3] Stream MUST emit a usage-bearing IMessage even when only text/tool chunks were yielded earlier.

[REQ-003] Reasoning rendering toggle
  [REQ-003.1] Add provider config flag showReasoningThinking (default false).
  [REQ-003.2] When false, parser MUST NOT attempt to interpret arbitrary JSON deltas as reasoning.
  [REQ-003.3] When true, parser MAY render “Thinking” for recognized reasoning payloads only for allowed models list.

[REQ-004] Stateful handling and trimming
  [REQ-004.1] If previous_response_id is set, the request SHOULD omit redundant history; no heuristic trimming required.
  [REQ-004.2] If history is sent with previous_response_id, it MUST be last-complete-turn consistent (user→assistant(tool_calls)→tool outputs→user), not partial.
  [REQ-004.3] The request MUST NOT send unsupported stateful fields.

[REQ-005] Base URL override for Responses
  [REQ-005.1] Introduce providerConfig.openaiResponsesEnabled to force-enable Responses even when baseURL != https://api.openai.com/v1.
  [REQ-005.2] Env var OPENAI_RESPONSES_DISABLE=true MUST still disable Responses regardless of override.

[REQ-006] Configurable tool limits
  [REQ-006.1] Make max tools and max tools JSON size configurable via provider config with defaults (16, 32KB).
  [REQ-006.2] When exceeding soft threshold, log DEBUG warning; when exceeding hard cap, throw with precise size/count info.

[REQ-007] Documentation alignment
  [REQ-007.1] Update docs to show input array with function_call/function_call_output, not tool_calls within assistant messages.
  [REQ-007.2] Replace chat/completions streaming examples with Responses SSE events.

[REQ-008] Behavioral tests per requirement
  [REQ-008.1] Each requirement MUST be covered by behavioral tests that assert input→output behavior (no mock theater), referencing @requirement tags.

[REQ-009] Backward compatibility
  [REQ-009.1] Legacy chat completions MUST remain unchanged.
  [REQ-009.2] OPENAI_RESPONSES_DISABLE MUST be honored.

[REQ-010] Logging & Debug
  [REQ-010.1] Add DEBUG logs for request size trimming decisions and cache tokens updated, without leaking sensitive content.

## Data Schemas (TypeScript types)
```ts
// Non-streaming Responses shape (simplified)
interface ResponsesNonStreaming {
  id: string;
  object: 'response';
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  output?: Array<
    | { id: string; type: 'message'; content?: Array<{ type: 'text'; text?: string }> }
    | { id: string; type: 'function_call'; name: string; call_id?: string; arguments?: string }
  >;
}

// Provider config additions
interface OpenAIProviderConfig {
  openaiResponsesEnabled?: boolean; // REQ-005
  showReasoningThinking?: boolean;  // REQ-003
  reasoningAllowedModels?: string[]; // REQ-003
  toolsMaxCount?: number;           // REQ-006
  toolsMaxJsonKB?: number;          // REQ-006
}
```

## Example Data
```json
{
  "id": "resp_123",
  "object": "response",
  "model": "o3",
  "usage": { "input_tokens": 62, "output_tokens": 23, "total_tokens": 85 },
  "output": [
    { "id": "msg_1", "type": "message", "content": [{ "type": "text", "text": "Hello" }] },
    { "id": "fc_1", "type": "function_call", "name": "get_weather", "call_id": "call_abc", "arguments": "{\"location\":\"SF\"}" }
  ]
}
```

## Constraints
- No external HTTP in unit tests; simulate streams and responses
- Strict TypeScript, immutable patterns, schema-first where applicable
- No console logs in production; DEBUG gated logging only

## Performance Requirements
- Streaming throughput unchanged (baseline parity)
- Non-streaming parse latency: < 2ms for typical outputs (unit-level)
- No extra allocations in hot streaming loops beyond current
