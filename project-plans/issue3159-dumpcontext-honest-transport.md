# Issue 3159: dumpcontext fabricates request headers, method and URL, hiding which transport was used

Status: Accepted behavior and test-first implementation plan
Date: 2026-08-21
Issue: https://github.com/vybestack/llxprt-code/issues/3159
Labels: Observability

## Purpose

Every dump written by the shared SDK dump helper reports hardcoded headers
(`Content-Type`, `User-Agent`), the method `POST`, and an `https://` URL
regardless of what was actually sent. A Codex WebSocket request is therefore
recorded as if it were an HTTP POST, hiding the single most useful fact a dump
can carry: which transport carried the request. This change makes the shared helper
record the real header map (credentials redacted), the true URL including the
`wss://` scheme, and a transport discriminator so WebSocket and HTTP dumps are
distinguishable. The plumbing is added once in the shared helper and threaded
through the four calling providers (gemini, anthropic, openai, openai-responses).

## Accepted behavior

### REQ-3159-001: Shared helper records observed metadata

- `dumpSDKRequestContext(providerName, endpoint, requestParams, baseURL?, options?)`
  accepts an optional request-metadata object:
  - `headers?: Record<string, string>` — real headers sent on the wire.
  - `transport?: { type: 'http' } | { type: 'websocket'; frameType: string }`
    — how the request was carried. Omitted means plain HTTP.
- When `headers` is provided, the dump records exactly those headers with values
  redacted for known credential names. When omitted, the current synthesized
  defaults continue to apply (backwards compatibility for direct callers).
- The recorded method for the WebSocket transport is not `POST`; the request
  shape carries `transport` alongside `method: 'POST'` for HTTP and the frame
  type (for example `response.create`) for WebSocket so the two paths are
  unambiguous.
- `dumpSDKContext`, `dumpSDKErrorRequestResponse`, and
  `wrapStreamWithSDKErrorDump` thread the same optional metadata through without
  changing their existing callers' behavior when it is omitted.

### REQ-3159-002: OpenAI Responses records real WS vs HTTP metadata

- The HTTP Responses path passes the headers built by `buildResponsesHeaders`
  (including Codex headers when Codex) and HTTP transport metadata.
- The Codex WebSocket path passes the headers built by
  `buildWebSocketHandshakeHeaders` (Authorization, ChatGPT-Account-ID,
  originator, session_id, OpenAI-Beta `responses_websockets=2026-02-06`) and
  WebSocket transport metadata with the frame type `response.create`.
- The dump URL for the WebSocket path uses the `wss://` scheme, not `https://`.
- Both error-dump paths (`openAIResponsesHttpStream.dumpErrorOnFailure` with no
  pre-existing base id and `wrapStreamWithSDKErrorDump`) produce the same honest
  metadata.

### REQ-3159-003: OpenAI Chat, Anthropic, Gemini pass observed headers

- OpenAI Chat request dumps record `mergedHeaders` when present.
- Anthropic request dumps record the custom headers built for the request.
- Gemini request dumps record the http options headers built for the request.
- When no real headers exist at a call site, the call site omits the metadata so
  the synthesized defaults remain authoritative there.

### REQ-3159-004: Credential redaction

- Dump files never contain real values for credential headers. The existing
  credential-name set in `dumpContext.ts` already covers `authorization`,
  `x-api-key`, `x-goog-api-key`, `api-key`, and `cookie`; the codex account
  id header `ChatGPT-Account-ID` is added to that set so it is redacted too.
- Header names are always preserved (a dump still shows which headers were present).

### REQ-3159-005: Distinguishability

- A dump written for a request that went over the Codex WebSocket is
  distinguishable from one that went over HTTP by:
  1. the `wss://` (WebSocket) vs `https://` (HTTP) scheme in `request.url`,
  2. the transport metadata / method on the request shape.

### REQ-3159-006: No scope expansion

- No new subsystems, workflows, agent memory, quality-tool config, dependency
  changes, or unrelated refactors. The shared helper stays in
  `packages/providers/src/utils/dumpSDKContext.ts`. Public exports are unchanged
  except the new optional parameter.

## Behavioral test plan (test-first)

### Phase 1: Shared helper redaction and transport shape

RED tests in `packages/providers/src/utils/dumpSDKContext.test.ts`:

1. `dumpSDKRequestContext` with headers containing `Authorization`,
   `ChatGPT-Account-ID`, `OpenAI-Beta`, `session_id`, and a benign
   `X-Debug` header writes a request dump whose `request.headers` preserves every
   name, redacts `authorization` and `ChatGPT-Account-ID` values, and keeps
   `OpenAI-Beta` and `session_id` readable.
2. `dumpSDKRequestContext` with `transport: { type: 'websocket', frameType:
   'response.create' }` and a `wss://` base URL writes a request dump whose
   `request.method` is not `POST` and/or `request.transport` distinguishes
   WebSocket from the default HTTP request, and whose `request.url` keeps the `wss://`
   scheme.
3. `dumpSDKContext` (combined helper) preserves the same metadata through the dump.
4. `dumpSDKErrorRequestResponse` forwards the metadata to `dumpSDKRequestContext`.
5. `wrapStreamWithSDKErrorDump` forwards the metadata to
   `dumpSDKErrorRequestResponse` and therefore to `dumpSDKRequestContext`.

GREEN: add the optional metadata parameter to the helper, thread it through, and
extend the dump request shape. Update the existing `toHaveBeenCalledWith` assertions
in `dumpSDKErrorRequestResponse` / `wrapStreamWithSDKErrorDump` tests that now
receive the extra argument.

### Phase 2: Provider call sites

RED tests:

1. `packages/providers/src/openai-responses/__tests__/openAIResponsesExecutor.liveness.test.ts`
   (adapting the existing `readDumpedRequest` to read the whole request, not just
   body): HTTP path passes real headers; Codex WebSocket path dump URL uses `wss://`,
   transport says WebSocket, and `OpenAI-Beta` contains `responses_websockets=2026-02-06`
   while `Authorization` is redacted.
2. `packages/providers/src/openai/OpenAIApiExecution.separateDump.test.ts`:
   `dumpSDKRequestContext` was called with the request `mergedHeaders`.
3. `packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts`:
   the request dump was produced with the custom headers built for the call.
4. `packages/providers/src/gemini/GeminiProvider.separateDump.test.ts`:
   `dumpSDKRequestContext` was called with the http options headers.

GREEN: thread the observed metadata through
`openAIResponsesExecutor.dumpFinalizedRequest` (using the WS-active predicate to
choose transport metadata), `buildResponsesHeaders` call sites in
`openAIResponsesHttpStream.dumpErrorOnFailure`, `OpenAIApiExecution`,
`AnthropicProvider.executeApiCall`/`AnthropicApiExecution.dumpAnthropicRequest`,
and `geminiGenerationExecution`. Add `ChatGPT-Account-ID` to the credential
redaction set in `dumpContext.ts`.

### Phase 3: Verification

Run the full workflow cycle on the candidate head:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

## Verification and review

Complete one deep technical review and no more than two local Open Code Review
rounds. Classify each finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`,
or `Defer`. Fix all `Blocker-Fix` and `In-scope-Fix` findings, then rerun
the verification cycle. Complete no more than two PR Open Code Review rounds after
pushing.

## Completion conditions

The issue is complete only when:

1. Every accepted requirement has behavioral evidence.
2. All local verification gates pass on the candidate commit.
3. Deep review and permitted Open Code Review rounds are complete and triaged.
4. Every Blocker-Fix and In-scope-Fix finding is resolved.
5. CI passes on the candidate head.
6. PR review threads are resolved.
7. The PR has correct ancestry, no conflicts, and is ready to merge.

Do not merge without explicit user approval. Stop when these conditions are met rather
than adding optional cleanup or hardening.
