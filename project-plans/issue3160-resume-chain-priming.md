# Issue #3160 — Prime the Codex stateful chain on resume

Follow-up optimization to #3134. Scope shaped from the issue's three proposed
optimizations; only optimization 1 is accepted for implementation.

## Current behavior (verified by reading the code on `main` @ f80a695f31)

Codex statefulness is transport-scoped. `computeStatefulConversation`
(`packages/providers/src/openai-responses/openAIResponsesStateful.ts`) scans the
outgoing history backwards for the newest AI entry with
`metadata.responsesStored === true` and a matching `metadata.providerBaseURL`,
and sends that entry's `metadata.id` as `previous_response_id`.

`responsesStored` reaches history like this:

1. `buildRequestContext` sets `responsesStored: request.store === true || (isCodex && stateful.enabled)`.
2. `parseResponsesStream` stamps `metadata.responsesStored = true` on the
   terminal AI IContent.
3. `mergeTurnMetadata` (`packages/agents/src/core/ConversationManager.ts:85`)
   folds it into the AI turn added to `HistoryService`.
4. `RecordingIntegration`'s `contentAdded` handler calls
   `SessionRecordingService.recordContent(content)`, which enqueues the whole
   `IContent` — metadata included — as a `content` event in the session JSONL.
5. `ReplayEngine.handleContent` pushes the deserialized object into
   `acc.history` verbatim (`isSpeakerContent` only checks `speaker` + `blocks`).

So a stale `responsesStored` marker **does** survive the resume boundary today.
Every replay-derived history — `--continue` at startup, `/continue`,
`/chat resume <tag>` (an alias of `/continue`), checkpoint fork, and ACP
`session/load` — funnels through `replaySession` / `replaySessionThroughSequence`
and can hand the provider a parent id that belongs to a WebSocket connection
owned by a previous process. That id is dead by construction.

The compression half of the issue is already handled:
`applyCompressionWithAnchor` (`packages/agents/src/compression/cacheAnchor.ts:83`)
and `densityValidation.ts:119` already call `invalidateResponsesStatefulChain`
(#3134 Fix 3). No change is needed there; it only needs a regression guard.

## Triage of the issue's three proposed optimizations

### 1. Strip `responsesStored` from AI turns when history is loaded for a resumed session — ACCEPTED

Concrete, testable, and it removes a real wasted round trip. This is the whole
deliverable.

### 2. Compact before the first request of a resumed session — DEFER

The issue words this as "investigate". Forcing a compaction to shrink the seed
costs its own full-history summarization request, so it is net negative unless
the session is already at the auto-compression threshold — in which case the
existing threshold already fires. Acting on it means changing compression
trigger policy, which is a different subsystem from chain priming and carries
real regression risk. Not implemented; recorded here so the decision is visible.

### 3. Prewarm the socket with a `generate=false` `response.create` — DEFER

Prewarming does not deliver the issue's stated goal. Codex CLI's prewarm carries
no conversation input, so the response it establishes is not a parent that holds
the transcript; the first real turn must still send the full history. Sending the
full history *in* the prewarm would spend the same bytes plus an extra request.
The measurable win is handshake latency (the transport's 15 s connect budget),
not payload size. It also requires a new public `prewarm` method on the
`WebSocketTransport` interface and an unverified `generate: false` request field.
Adding a public abstraction for a benefit the issue did not ask for is outside
the accepted scope. Not implemented.

## Accepted behavior

**AC-1 — Replay-derived history carries no stateful-chain marker.**
`replaySession` and `replaySessionThroughSequence` return a history in which no
entry carries `metadata.responsesStored`, regardless of what the recording file
contains. All other metadata on those entries (`id`, `model`,
`providerBaseURL`, `usage`, `chronology`, `isSummary`, `cacheAnchor`, …) is
preserved byte-for-byte, and non-AI entries are untouched.

Rationale for the placement: `finalizeReplay` is the single funnel both public
replay entry points return through, so one strip covers `--continue`,
`/continue`, `/chat resume`, checkpoint fork, and ACP `session/load`. A
checkpoint fork replays a rewound prefix, so its markers are invalid for the same
reason compression's are, even when the socket is still live in-process.

**AC-2 — A resumed Codex WebSocket session never sends a dead parent.**
Given a session recording whose AI turn carries
`{ id, responsesStored: true, providerBaseURL: <codex> }`, the first Codex
WebSocket turn after resuming that recording sends **no** `previous_response_id`
and sends the full history. The turn is still chainable: its own completion is
stamped `responsesStored`, so the following turn sends
`previous_response_id` and a trimmed input.

**AC-3 — Compression invalidation is unchanged.**
Post-compression histories still send full history with no
`previous_response_id`. Existing coverage in
`OpenAIResponsesProvider.codex.stateful.remediation.test.ts` stands; no
behavioral change is introduced there.

## Boundary cases the tests must cover

- Recording whose AI entry has `responsesStored: true` **and** other metadata →
  only `responsesStored` is dropped.
- Recording whose AI entry has `responsesStored: false` or no `responsesStored`
  → entry is returned unchanged (identity preserved, no gratuitous rewrite).
- Recording whose **human** or **tool** entry somehow carries
  `responsesStored: true` → untouched (the marker is meaningless off an AI turn
  and `invalidateResponsesStatefulChain` is already speaker-scoped).
- Entry with no `metadata` at all → untouched, and `metadata` is not
  materialized.
- `replaySessionThroughSequence` (checkpoint fork) → stripped identically.
- A `compressed` event resets `acc.history` to `[summary]`; the summary entry is
  also subject to the strip.
- Empty history → empty result, no throw.

## Tests that will prove it

All new tests are `bun:test`, TypeScript, behavioral (real replay of a real
JSONL file on a temp dir — no mocking of the replay engine).

1. `packages/core/src/recording/ReplayEngine.statefulChain.test.ts` (new)
   - Writes a real session JSONL containing `session_start` plus `content`
     events, one of which is an AI turn with
     `metadata: { id, responsesStored: true, providerBaseURL, model }`.
   - Asserts `replaySession` returns that entry with `responsesStored`
     undefined and `id` / `providerBaseURL` / `model` intact.
   - Asserts a human entry carrying the marker is returned untouched.
   - Asserts an entry with no metadata still has no `metadata` key.
   - Asserts `replaySessionThroughSequence` strips identically.
   - Asserts a `compressed` summary carrying the marker is stripped.

2. `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.codex.resumedChain.test.ts` (new)
   - Uses the existing `SocketHarness` + `createCodexResponsesWebSocketTransport`
     + `executeOpenAIResponsesRequest` harness (same pattern as the #3134
     remediation suite, real SSE bytes through `parseResponsesStream`).
   - RED-first: history in the shape a resume produces **after** the strip sends
     no `previous_response_id` and the full history; the same history **with**
     the marker (i.e. a live in-process chain) still sends the parent, proving
     the provider rule itself did not change.
   - Turn-2 chaining still works off the resumed turn's own completion id.

## Implementation

Single production change in
`packages/core/src/recording/ReplayEngine.ts`: `finalizeReplay` returns
`invalidateResponsesStatefulChain(acc.history)` instead of `acc.history`.
`invalidateResponsesStatefulChain` already exists in
`packages/core/src/services/history/IContent.ts` and already implements exactly
the required semantics (AI-only, `responsesStored`-only, entries without the
marker returned by reference). It returns `readonly IContent[]`; `ReplayResult.history`
is `IContent[]`, so the result is spread into a fresh mutable array.

No provider-side change. No new public abstraction. No new dependency.

## Out of scope

- Optimizations 2 and 3 above.
- `/chat restore <N>` rewind chain invalidation (a separate path from replay;
  not named in this issue).
- Any change to HTTP Codex statelessness or the ZDR trade-off.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the `stepfun-37` startup smoke.
