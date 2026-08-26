# `@ai-sdk/google` v2 parity for the Gemini adapter

Spike for issue [#2761](https://github.com/vybestack/llxprt-code/issues/2761).
Question: can AI SDK v5-generation `@ai-sdk/google` replace `@google/genai` as
the wire adapter inside the optional Gemini plugin without losing behavior
llxprt depends on?

## Decision

**Retain `@google/genai` inside the plugin.**

`@ai-sdk/google@2.0.85` matched or improved on `@google/genai@1.30.0` in every
behavior area that was probed, and it has no Vertex AI or Application Default
Credentials path at all. llxprt supports a `vertex-ai` auth mode today
(`GeminiProvider.determineBestAuth`, `geminiAuth.ts`,
`buildGoogleGenAIOptions`, and both server tools in `geminiServerTools.ts`).
Switching adapters would either delete that mode or require one of the two
things this issue names as non-goals: hand-written Google auth, or adopting
`@ai-sdk/google-vertex`. That is accepted behavior loss, and the issue's rule is
to select the AI SDK only when there is none.

The chat-path evidence is nevertheless favourable, so this is a decision about
auth, not about the AI SDK's Gemini support. The section
[What a future revisit would buy](#what-a-future-revisit-would-buy) records what
becomes available if the Vertex question is ever settled separately.

## How the evidence was produced

Fourteen probes in
[`research/issue2761/`](../../research/issue2761/README.md) send the same
logical request through both adapters against the live Gemini API and record
what each one actually did:

- `@google/genai` through `GoogleGenAI.models.generateContent` /
  `generateContentStream`, which is what
  [`geminiGenerationExecution.ts`](../../packages/providers/src/gemini/geminiGenerationExecution.ts)
  calls today.
- `@ai-sdk/google` through the low-level `LanguageModelV2` interface
  (`doGenerate` / `doStream`), which is where an llxprt adapter would sit. The
  `ai` package is not used, which also establishes that adopting
  `@ai-sdk/google` would not require it.

Each probe writes `results/<ID>.json` with the observations behind its verdict;
[`results/summary.json`](../../research/issue2761/results/summary.json) is the
roll-up this table is built from. Reproduce with `bun run all` in that
directory.

Verdicts mean: `parity`, the AI SDK delivers what llxprt depends on; `partial`,
it delivers it only with extra adapter-side work or lossily; `gap`, it cannot at
this pin.

## Dependency and protocol facts

Machine-recorded by
[`src/dependency-facts.ts`](../../research/issue2761/src/dependency-facts.ts)
into
[`dependency-facts.json`](../../research/issue2761/dependency-facts.json). None
of it is hand-typed.

| Fact                                                 | Value                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Pinned candidate                                     | `@ai-sdk/google@2.0.85`                                                         |
| Its provider protocol                                | `@ai-sdk/provider@2.0.3` (major 2)                                              |
| Its other runtime dependency                         | `@ai-sdk/provider-utils@3.0.30`                                                 |
| Its peer requirement                                 | `zod ^3.25.76 \|\| ^4.1.8`, Node `>=18`                                         |
| Incumbent                                            | `@google/genai@1.30.0`                                                          |
| Incumbent's runtime dependencies                     | `google-auth-library ^10.3.0`, `ws ^8.18.0`, Node `>=20`                        |
| Already resolved in the llxprt root tree             | `ai@5.0.206`, `@ai-sdk/openai@2.0.109`, `@ai-sdk/provider@2.0.3`, `zod@3.25.76` |
| Protocol majors match (candidate vs root tree)       | yes, both 2                                                                     |
| `@ai-sdk/google` `dist-tags.latest` at time of probe | `4.0.53`, which depends on `@ai-sdk/provider@4.0.8`                             |

Two things follow.

First, `@ai-sdk/google@2.0.85` is protocol-compatible with the AI SDK stack
llxprt already ships. It adds no new protocol generation and no new peer
requirement: `zod@3.25.76` is already resolved at the root, and every workspace
that declares zod declares a compatible range.

Second, **provider-protocol v4 mixing is rejected.** The current `latest` of
`@ai-sdk/google` sits on `@ai-sdk/provider` major 4 (the AI SDK v6 generation),
while `ai` and `@ai-sdk/openai` in this repository sit on major 2. Adopting
`latest` would put a v4-protocol language-model object into the same process as
v2-protocol providers. The 2.0.85 pin exists precisely to avoid that, and any
future revisit has to move the whole AI SDK stack together rather than upgrading
the Google provider alone.

One nuance the fact file records rather than hides: the root `node_modules`
hoists `@ai-sdk/provider-utils@2.2.8` (which itself depends on
`@ai-sdk/provider@1.1.3`) for other consumers, while `ai` and `@ai-sdk/openai`
resolve `@ai-sdk/provider-utils@3.0.27` nested under themselves. The
`@ai-sdk/provider` major that matters for a language-model object is 2 in both
the probe context and the root tree, but the hoisted older copy is real and is
recorded in `llxprtRootTree` so nobody reads the top-level entry as the whole
story.

## Decision table

Every row links the probe source and the recorded artifact. Models used:
`gemini-3.1-flash-lite` for the general behaviors, `gemini-3.5-flash` for the
Gemini 3 thought-signature behavior.

| ID  | Area                        | `@google/genai@1.30.0`                                                                                                                         | `@ai-sdk/google@2.0.85`                                                                                                                                                                          | Verdict   | Evidence                                                                                                                         |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P01 | API-key auth                | Key on the `x-goog-api-key` header; llxprt `User-Agent` and custom headers reach the wire.                                                     | Same header carrier; same headers reach the wire; invalid key rejected the same way.                                                                                                             | `parity`  | [probe](../../research/issue2761/src/probes/p01-api-key-auth.ts) / [result](../../research/issue2761/results/P01.json)           |
| P02 | Non-streaming               | Text, finish reason, usage, and a `responseId`.                                                                                                | Text, finish reason, usage; `response.id` is null, and it returns the request body it sent.                                                                                                      | `partial` | [probe](../../research/issue2761/src/probes/p02-non-streaming.ts) / [result](../../research/issue2761/results/P02.json)          |
| P03 | Streaming and usage         | Incremental text; `usageMetadata` on every chunk.                                                                                              | Incremental text; usage once, on the terminal `finish` stream part.                                                                                                                              | `partial` | [probe](../../research/issue2761/src/probes/p03-streaming-usage.ts) / [result](../../research/issue2761/results/P03.json)        |
| P04 | Parallel tools and call IDs | Two calls in one turn, each with a `functionCall.id`; ids accepted on replay.                                                                  | Two calls in one turn, each with a `toolCallId`; ids accepted on replay.                                                                                                                         | `parity`  | [probe](../../research/issue2761/src/probes/p04-parallel-tools-ids.ts) / [result](../../research/issue2761/results/P04.json)     |
| P05 | Tool schemas                | Forwards an uncleaned schema verbatim, including `$schema`, `title`, `additionalProperties`, `format`, `exclusiveMinimum`, `anyOf`, `default`. | Drops all of those except `format` and `anyOf`. Neither adapter adds a missing top-level `type`; both are rejected with HTTP 400 for that case.                                                  | `partial` | [probe](../../research/issue2761/src/probes/p05-schemas.ts) / [result](../../research/issue2761/results/P05.json)                |
| P06 | Thought signatures          | Surfaces `part.thoughtSignature`; a replay without one is rejected with HTTP 400.                                                              | Surfaces it under `providerMetadata.google.thoughtSignature`, replays it, and injects the same `skip_thought_signature_validator` sentinel when it is missing.                                   | `parity`  | [probe](../../research/issue2761/src/probes/p06-thought-signatures.ts) / [result](../../research/issue2761/results/P06.json)     |
| P07 | Thinking configuration      | `config.thinkingConfig` reaches `generationConfig.thinkingConfig`; thought parts and `thoughtsTokenCount` returned.                            | `providerOptions.google.thinkingConfig` reaches the same wire field; `reasoning` content parts and `usage.reasoningTokens` returned, for both the budget and level forms.                        | `parity`  | [probe](../../research/issue2761/src/probes/p07-thinking-config.ts) / [result](../../research/issue2761/results/P07.json)        |
| P08 | Media                       | Inline base64 PNG accepted as `inlineData`; an arbitrary HTTPS `fileData.fileUri` is refused by the endpoint.                                  | Same on both sub-cases; a control call proved the `fileUri` refusal is endpoint behavior, not quota.                                                                                             | `parity`  | [probe](../../research/issue2761/src/probes/p08-media.ts) / [result](../../research/issue2761/results/P08.json)                  |
| P09 | Executable code             | Part sequence `executableCode`, `codeExecutionResult`, `text`.                                                                                 | Content sequence `tool-call`, `tool-result`, `text`, with `toolName: code_execution` and `providerExecuted` set.                                                                                 | `parity`  | [probe](../../research/issue2761/src/probes/p09-executable-code.ts) / [result](../../research/issue2761/results/P09.json)        |
| P10 | Errors, safety, finish      | `ApiError` with status and message; raw error body not exposed; `MAX_TOKENS`; four candidate `safetyRatings`.                                  | `AI_APICallError` with status, message and the raw `responseBody`; finish reason normalized to `length` with the raw value in `response.body`; `safetyRatings` present, `promptFeedback` absent. | `partial` | [probe](../../research/issue2761/src/probes/p10-error-safety-finish.ts) / [result](../../research/issue2761/results/P10.json)    |
| P11 | Abort                       | An already-aborted signal does not stop the request leaving the process; mid-stream abort throws `AbortError`.                                 | An already-aborted signal short-circuits before any request leaves; mid-stream abort throws `AbortError`.                                                                                        | `partial` | [probe](../../research/issue2761/src/probes/p11-abort.ts) / [result](../../research/issue2761/results/P11.json)                  |
| P12 | baseURL, fetch, dumps       | `httpOptions.baseUrl` works; no `fetch` member on `GoogleGenAIOptions` or `HttpOptions`; no raw wire body on the response.                     | `baseURL` works; a custom `fetch` intercepts both directions; `doGenerate` returns `request.body` and `response.body`.                                                                           | `parity`  | [probe](../../research/issue2761/src/probes/p12-baseurl-fetch-dumps.ts) / [result](../../research/issue2761/results/P12.json)    |
| P13 | Grounding and URL context   | `candidate.urlContextMetadata` with one `URL_RETRIEVAL_STATUS_SUCCESS` entry.                                                                  | `providerMetadata.google.urlContextMetadata` with the same entry. Google Search grounding was not exercised.                                                                                     | `partial` | [probe](../../research/issue2761/src/probes/p13-grounding-url-metadata.ts) / [result](../../research/issue2761/results/P13.json) |
| P14 | Model listing               | `models.list` returns a page of model names.                                                                                                   | No listing method on the provider or the model object.                                                                                                                                           | `parity`  | [probe](../../research/issue2761/src/probes/p14-model-listing.ts) / [result](../../research/issue2761/results/P14.json)          |

Totals: 8 `parity`, 6 `partial`, 0 `gap`.

P14 is `parity` despite the missing listing API because
[`geminiModels.fetchModelsFromApi`](../../packages/providers/src/gemini/geminiModels.ts)
already lists models with a bare `fetch` against `/v1beta/models` and never
calls the SDK. The probe reproduced that path and it returned 50 models.

## What an AI SDK adapter would have to absorb

The six `partial` rows are all adapter work rather than lost capability. Listed
so a future estimate is grounded:

1. **Response id** (P02). `response.id` is null, so an adapter would read
   `responseId` out of `response.body` to keep the first-class `ModelOutput`
   field.
2. **Streaming usage placement** (P03).
   [`geminiResponseMapper`](../../packages/providers/src/gemini/geminiResponseMapper.ts)
   stamps usage onto every chunk it maps. The AI SDK reports usage once, on the
   terminal stream part, so an adapter would hold it and attach it itself.
3. **Schema dialect cleaning** (P05). The AI SDK removes most of what
   `cleanGeminiSchema` removes but leaves `format` and `anyOf` on the wire, and
   it does not add a missing top-level `type` the way
   [`buildGeminiTools`](../../packages/providers/src/gemini/geminiRequestBuilding.ts)
   does. Both helpers shrink; neither disappears.
4. **Raw finish reason** (P10). The AI SDK normalizes `MAX_TOKENS` to `length`.
   The raw value is reachable in `response.body` but not in
   `providerMetadata.google`, so the neutral `rawStopReason` passthrough would
   read the body.
5. **`promptFeedback`** (P10). Present on the `@google/genai` response object,
   absent from `providerMetadata.google` in the observed run. Recoverable from
   `response.body`.
6. **Server-tool response shape** (P13).
   [`geminiServerTools.ts`](../../packages/providers/src/gemini/geminiServerTools.ts)
   hands `web_search` and `web_fetch` callers the raw `GenerateContentResponse`.
   The AI SDK repackages grounding under `providerMetadata.google` and also
   emits web chunks as `source` content parts, so an adapter would rebuild the
   shape those callers consume.

One cross-cutting detail that is not its own row: `doGenerate` returns a tool
call's `input` as a JSON **string**, while the request side needs a parsed
object. Replaying the SDK's own output requires an explicit `JSON.parse`;
sending the string through produces an `INVALID_ARGUMENT` on
`function_call.args`. This showed up in both P04 and P06 and is recorded in
their artifacts.

## What a future revisit would buy

Recorded because it is the other half of an honest comparison:

- **Thought signatures** (P06). `@ai-sdk/google` already implements the same
  workaround as
  [`thoughtSignatures.ts`](../../packages/providers/src/gemini/thoughtSignatures.ts),
  down to the identical `skip_thought_signature_validator` sentinel string. That
  module would become redundant on the AI SDK path.
- **Tool-call ids** (P04). Every call carries an id, so the synthetic
  `call_<timestamp>_<random>` fallback in `geminiResponseMapper` would no longer
  be reached.
- **Dumps** (P12). `@google/genai` exposes no `fetch` hook and no raw wire body,
  which is why
  [`dumpSDKContext.ts`](../../packages/providers/src/utils/dumpSDKContext.ts)
  dumps the SDK parameter object rather than what was actually sent. The AI SDK
  gives both a `fetch` middleware and `request.body` / `response.body`, so dumps
  would carry the real wire payload.
- **Abort** (P11). An already-aborted signal short-circuits before any request
  leaves the process, which is what
  [`geminiAbort.ts`](../../packages/providers/src/gemini/geminiAbort.ts) exists
  to do by hand for `@google/genai`.
- **Errors** (P10). `AI_APICallError` carries the raw provider error body, which
  the `@google/genai` `ApiError` does not expose, so the neutral
  `ProviderApiError` mapping would get a real `raw` slot.

## Vertex AI decision

Recorded separately, and this is what drives the outcome.

**What llxprt has today.** `GeminiProvider.determineBestAuth` selects a
`vertex-ai` auth mode when `hasVertexAICredentials` finds either
`GOOGLE_CLOUD_PROJECT` plus `GOOGLE_CLOUD_LOCATION`, or
`GOOGLE_APPLICATION_CREDENTIALS`. `buildGoogleGenAIOptions` then constructs the
client with `vertexai: true` plus project and location, `setupVertexAIAuth` sets
`GOOGLE_GENAI_USE_VERTEXAI`, and `@google/genai` resolves credentials through
its `google-auth-library` dependency. Both server tools in
`geminiServerTools.ts` have an explicit Vertex branch. This is live
functionality, not a stub.

**What `@ai-sdk/google@2.0.85` provides.** Nothing for Vertex.
`dependency-facts.json` records its complete runtime dependency closure as
`@ai-sdk/provider` and `@ai-sdk/provider-utils`, with
`aiSdkGoogleDeclaresGoogleAuthLibrary: false`. Its
`GoogleGenerativeAIProviderSettings` exposes only `baseURL`, `apiKey`,
`headers`, `fetch`, `generateId` and `name`. There is no project, no location,
no ADC, and no credential resolution of any kind.

**Why `@ai-sdk/google-vertex` is not the answer here.** The issue names it as a
non-goal, and the recorded facts show why that is the right call rather than a
formality. Its current `latest`, 5.0.65, is on `@ai-sdk/provider@4.0.8`, so
taking it means the v4-protocol mixing this spike already rejects. The newest
release still on protocol major 2, 3.0.165, brings in `@ai-sdk/google@2.0.90`,
`@ai-sdk/anthropic@2.0.96`, `@ai-sdk/openai-compatible@1.0.49` and
`google-auth-library@^10.5.0`. Pulling an Anthropic provider and an
OpenAI-compatible provider into the Gemini plugin to obtain Google credentials
is not a smaller dependency footprint than the one `@google/genai` already
carries; it is a larger one wearing a different name.

**Decision.** Vertex support stays on `@google/genai`. Hand-writing Google
credential resolution is an explicit non-goal, and there is no third option at
this pin.

## Limits of this evidence

Stated so the table is not read as covering more than it does.

- **No Gemini 2.x generation.** Every probe ran against Gemini 3 models.
  `gemini-2.5-pro` and `gemini-2.5-flash-lite` answer "no longer available to
  new users" on every key available for this work, and the one key with
  `gemini-2.5-flash` access is on a free tier capped at 20 generate-content
  requests per day, which was exhausted during the run. Set
  `LLXPRT_PROBE_MODEL_GENERAL` to a 2.x model and re-run to extend the evidence.
- **Google Search grounding was not exercised** (P13). The key has no
  Search-grounding quota; both adapters were refused before reaching the
  behavior. URL context was exercised and matched. If the Vertex question is
  ever revisited, this row needs a key with grounding quota.
- **Vertex was not exercised live.** No Vertex project or ADC credentials were
  available. The Vertex section rests on package exports and dependency
  closures, which is sufficient to establish absence but does not describe how
  `@google/genai` behaves against a real Vertex endpoint.
- **Safety blocking was not forced.** P10 records whether the safety surfaces
  are reachable, not how a real block is reported.

## What would change the answer

Any one of these:

1. `@ai-sdk/google` gaining a Vertex or ADC path on a protocol major that
   matches the rest of the llxprt AI SDK stack.
2. llxprt dropping Vertex support for a separate, deliberate reason, which would
   remove the only accepted behavior loss found here.
3. The whole AI SDK stack in this repository moving to provider protocol v4
   together, at which point the pin and the mixing constraint both need
   re-deriving.
