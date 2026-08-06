# Issue #3076 — A failed tool call must stay failed through OpenAI-Vercel and the ContentConverters round trip

## Problem

`buildToolResponsePayload` (`packages/providers/src/utils/toolResponsePayload.ts`) derives
`status: 'error'` from `ToolResponseBlock.error`. Anthropic, Gemini and the OpenAI
Chat/Responses builders all read that status. Two paths still discard it:

1. `packages/providers/src/openai-vercel/messageConversion.ts` builds the payload and then
   emits `output: { type: 'text', value: payload.result }`, throwing away `status` and
   `error`. Every failed tool call reaches a Vercel-AI-SDK provider as an ordinary success.
   The reverse path in the same file already decodes any output type starting with `error`,
   so the shape exists inbound but is never produced outbound.
2. `packages/core/src/services/history/ContentConverters.ts` logs the failure marker
   outbound and omits it from `functionResponse`, and reconstructs `tool_response` blocks
   inbound without `error`. Consumers: `contentGeneratorAdapters.ts` (Google code-assist
   request path — currently emits no failure signal at all) and
   `streamRequestHelpers.ts` (a `BeforeModel` hook that supplies `llm_request.messages`
   round-trips history `toGeminiContents` -> `toIContents`, which strips the marker). The
   second of those two consumer claims does not hold — see "Verified facts" below.

## Verified facts

- Installed AI SDK: `ai@5.0.206` -> `@ai-sdk/provider-utils@3.0.27`. `ToolResultPart.output`
  is `LanguageModelV2ToolResultOutput` (`@ai-sdk/provider`), whose union includes
  `{ type: 'error-text'; value: string }` and `{ type: 'error-json'; value: JSONValue }`.
  So `error-text` is type-safe with the installed version.
- `@ai-sdk/openai@dist` maps `error-text` to the same wire content string as `text` for both
  the Chat and Responses transports, so no OpenAI wire regression; providers that do
  distinguish failure (e.g. Anthropic through the SDK) gain the correct signal.
- `payload.result` is always a `string` (`buildToolResponsePayload` guarantees it, falling
  back to `EMPTY_TOOL_RESULT_PLACEHOLDER`), so `error-text` is the correct counterpart of the
  existing `text` output — `error-json` is not needed.
- `GeminiMessageConverter.convertToolContentToGeminiContents` already establishes the
  project's canonical Gemini-shaped failure encoding: `functionResponse.response` is an
  envelope carrying `status`, `result` and `error`. Part 2 follows that precedent.
- `#3063` (PR #3077) is now merged into `main`. `createErrorResponse` sets the top-level
  `ToolResponseBlock.error` via `toolFailureMarker(...)`, so `buildToolResponsePayload` now
  derives `status: 'error'` for a genuine tool failure and the blast radius of this change is
  real: every genuine tool failure takes the new code paths.
- `streamRequestHelpers.ts` is NOT a live consumer of the outbound encoding, contrary to the
  issue text. It only round-trips when `hookProvidedMessages()` is true, and in exactly that
  case `HookTranslator.fromHookLLMRequest` rebuilds contents as text-only `parts: [{ text }]`,
  discarding the converted contents — so a `functionResponse` part never reaches `toIContents`
  there. The only live outbound consumer is `contentGeneratorAdapters.ts` (the Google
  code-assist request path). The inbound decoder exists for symmetry/losslessness and has no
  other live consumer today.

## Decisions

### D1 — OpenAI-Vercel failure output

A `tool_response` whose payload `status` is `'error'` is emitted as
`output: { type: 'error-text', value }`. Success is unchanged (`{ type: 'text', value }`).

`value` stays the model-facing remedy (`payload.result`), because that is the text the model
must act on. Only when `payload.result` is the `[no tool result]` placeholder — i.e. the block
carried no result at all — does the value fall back to `payload.error`, so a failure never
reaches the model as the bare placeholder with no explanation.

### D2 — Canonical legacy (Gemini-shaped) encoding of a failed tool response

`ContentConverters.toolResponseBlockToPart` emits, **and only when the block carries a
failure marker**, a part that carries BOTH the model-facing envelope inside `functionResponse`
AND a part-level discriminant `llxprtToolFailure: true`:

```
{
  functionResponse: {
    name: <toolName>,
    response: {
      status: 'error',
      error: <error string>,
      result: <original block.result>,   // key omitted when result is undefined
    },
    id: <callId>,
  },
  llxprtToolFailure: true,
}
```

A successful tool response is encoded exactly as today (`response` is the raw result, no flag),
so no existing success payload — on the wire to Google or anywhere else — changes.

`ContentConverters.processFunctionResponsePart` decodes that envelope **only when the part
carries `llxprtToolFailure === true`**; a part without the flag keeps today's behaviour
exactly, whatever its `response` shape. This is required because a SUCCESSFUL tool whose
result merely happens to be `{ status: 'error', error: '...', ...payload }` (third-party MCP
servers do produce such shapes, and `convertToFunctionResponse` copies them verbatim) would
otherwise be misdecoded into a spurious failure with its payload destroyed, and it would also
misdecode the different envelope produced by `GeminiMessageConverter` (whose `result` is a
serialized string). The flag follows the existing `llxprt*` part-extension convention
(`llxprtSourceField`, `llxprtThoughtBlockId`, …).

**`result` null/undefined semantics (verified by full round trip):** the `result` key is
omitted outbound only when `result === undefined`, and the decoder then yields `{}`. A
`result` of `null` — exactly what `historyToolPairing.ts` / `historyToolNormalization.ts`
produce on a failed block — is written through and comes back as `null` verbatim (NOT coerced
to `{}`). The decoder does NOT therefore always yield `{}`; it yields `{}` only for the
omitted/undefined case and `null` for the explicit-`null` case.

**What the legacy representation preserves:** `callId`, `toolName`, `result`, and the failure
marker `error`. **What it deliberately does not preserve:** `isComplete` and
`providerMetadata`. Those are local bookkeeping with no Gemini wire representation; encoding
them would pollute the payload sent to Google for zero model benefit. This is a recorded
decision, not an oversight, and is documented at the conversion site.

Non-goal (explicitly out of scope): making the *success* round trip lossless for non-object
results (`'hello'` still returns as `{ output: 'hello' }`). That is pre-existing behaviour
relied on by the success path and is not what this issue is about.

## Acceptance criteria

### Part 1 — `packages/providers/src/openai-vercel/messageConversion.ts`

- AC1.1 `convertToVercelMessages` on an `IContent` whose `tool_response` block has `error`
  set produces a `tool-result` part with `output.type === 'error-text'`.
- AC1.2 The `error-text` value is the model-facing result text (`payload.result`).
- AC1.3 When the block has `error` set and no result, the `error-text` value is the error
  text, not `[no tool result]`.
- AC1.4 A `tool_response` block with no `error` is unchanged: `output.type === 'text'` with
  the same value as before (regression guard, including the empty-result placeholder case).
- AC1.5 Round trip: `convertToVercelMessages` -> `convertFromVercelMessages` on a failed
  tool response yields a `tool_response` block that is still marked as a failure
  (`isError === true`). Note the pre-existing inbound decoder (`parseToolResultPart`) sets the
  reconstructed `error` to the OUTPUT TEXT rather than the original error string, so the exact
  error text is NOT preserved by this path; only the failure MARKER is. The test asserts the
  exact observed values (`error === result === <output text>`).
- AC1.6 One tool `IContent` with multiple `tool_response` blocks (mixed success/failure)
  produces one tool message whose parts carry `error-text` and `text` respectively, in order.
- AC1.7 A failed block with `result: null` (falls through to the empty-result placeholder)
  yields the error text as the `error-text` value.
- AC1.8 Failed blocks with `result: undefined` or `result: null` remain marked failed via
  the canonical `error` property after a full Vercel round trip.

### Part 2 — `packages/core/src/services/history/ContentConverters.ts`

- AC2.1 `toGeminiContent` on a `tool_response` block with `error` set produces
  `functionResponse.response` containing `status: 'error'` and the `error` string.
- AC2.2 That envelope also carries the original `result` verbatim under `result`.
- AC2.3 `toGeminiContent` on a `tool_response` block without `error` is byte-identical to
  today (`response` is the raw result object; no `status`, no `error` key added).
- AC2.4 `toIContent` on a functionResponse carrying the envelope reconstructs a
  `tool_response` block with `error` set and `result` equal to the original value.
- AC2.5 `toIContent` on an ordinary (non-envelope) functionResponse is unchanged, including
  the existing string/JSON coercion behaviour.
- AC2.6 Full round trip `toGeminiContents` -> `toIContents` preserves the failure marker,
  the result, the tool name and the call id for a failed tool response, and preserves the
  absence of a marker for a successful one.
- AC2.7 Full round trip of a failed block with `result: undefined`: `undefined` is omitted
  outbound and decodes to `{}` (the pre-existing empty-response convention) and still carries
  the failure marker.
- AC2.8 Full round trip of a failed block with `result: null`: `null` is written through and
  comes back as `null` verbatim (NOT `{}`), and the marker survives.
- AC2.9 A SUCCESSFUL tool whose `result` is shaped like a failure envelope
  (`{ status:'error', error:'...', ...payload }`) round-trips completely intact: no failure
  marker, payload preserved. This is the F2 discriminant regression guard.
- AC2.10 A failed block with a non-object `result` (a string and an array) round-trips with
  the result preserved verbatim.
- AC2.11 One `IContent` containing multiple `tool_response` blocks (mixed success/failure)
  round-trips with each block's marker/absence correct (the discriminant is per-part).

### Part 3 — `packages/core/src/code_assist/contentGeneratorAdapters.ts` (the only live outbound consumer)

- AC3.1 `toGenerateContentParameters` on a request whose contents contain a failed
  `tool_response` emits a `functionResponse` whose `response` carries the explicit failure
  signal (`status: 'error'` and the error text).
- AC3.2 The same for a SUCCESSFUL `tool_response`: the emitted `functionResponse.response` is
  byte-identical to the raw result (regression guard).
- AC3.3 `toCountTokensParameters` counts the same failure-shaped response.

## Test plan (behavioural, written first, no mock theatre)

New Bun (`bun:test`) files — no existing Vitest suite is modified:

1. `packages/providers/src/openai-vercel/messageConversion.toolFailure.test.ts`
   covers AC1.1 – AC1.8 by driving the real exported converters with real `IContent`
   fixtures and asserting on the produced `ToolResultPart` / reconstructed blocks.
   Must be registered in `scripts/bun-test-manifest-data-providers.ts` (curated file list).
2. `packages/core/src/services/history/ContentConverters.toolFailure.test.ts`
   covers AC2.1 – AC2.11 by driving `toGeminiContent(s)` / `toIContent(s)` directly.
   The core workspace runner auto-discovers `*.test.ts`, so no manifest edit is needed.
3. `packages/core/src/code_assist/contentGeneratorAdapters.toolFailure.test.ts`
   covers AC3.1 – AC3.3 by driving the real adapter with real `ModelGenerationRequest` /
   `CountTokensRequest` fixtures (no mocks of ContentConverters). The core workspace runner
   auto-discovers `*.test.ts`, so no manifest edit is needed.

No mocks are required in any file: all three units are pure functions over plain data.

## Out of scope

- Changing the success-path encoding anywhere.
- `providerMetadata` / `isComplete` transport (decision D2 records why).
- Anything in `#3063` / PR #3077.
- Emitting `error-json`, or restructuring `buildToolResponsePayload`.
