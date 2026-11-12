# Issue #4036: Recover from classifier refusals

Retry with backoff, then have a review model check the recent context and
rewrite it, then retry the original model.

## Evidence (real-disunity observer data, 5 to 11 Nov 2026)

Source: `/home/acoliver/projects/real-disunity/observer/findings/classifier/`
and the token-usage logs under `~/.local/state/llxprt-code/tmp/*/token-usage/`.
Fixed cutoff 2026-11-11 21:12 UTC.

- 150 refusal-like completions (`attempt_outcome: success`, `output_tokens: 0`,
  no `ttft_ms`), all `claude-opus-5-5` through the `claudecode` provider: about
  0.93% of 16,180 Opus attempts. Zero on Sonnet 5.5 (14,118), GPT (10,406) or
  Fable (1,197). They form 24 consecutive Opus-only runs.
- The historical logs never saved the provider stop reason, so these are a
  proxy. LLxprt already maps Anthropic `stop_reason: "refusal"` to canonical
  `finishReason: 'refusal'`; it just does not record it.
- Retrying works often: 8 of 24 runs recovered on a similar-size request 4.4
  to 18.5 s later. One gitium pair has the same prompt id, turn id and token
  counts, refused on attempt 0 and answered 402 tokens on attempt 1.
- Compression is associated: on 11 Nov, 5 of 38 Opus-written summaries were
  immediately followed by a refusal, 0 of 12 written by other models.
- Content audit: nothing genuinely disallowed was found in the 28 context
  extracts or the summaries. Sensitive-looking wording is ordinary: mutation
  tests ("kills", "KILLED/SURVIVED"), `pkill` rules for owned processes,
  Blender mesh fitting ("attach the head", "points inside a forearm"),
  shader culling, clean-room source rules ("contaminated candidates").
- There is no trigger phrase. The UQM summary labelled blocked is byte
  identical (SHA-256 `00f51f5c…`) to two summaries labelled ok, and every
  distinct blocked summary also appears in passing requests. The classifier is
  not deterministic on its input.

Consequences for the design:

1. Retrying the identical request is the cheapest recovery and must come
   first.
2. The rewrite cannot target "the bad words". It rewrites the content that
   changed since the last successful call (usually a compression summary) in
   plain, explicit technical wording, which changes the request the
   classifier sees while keeping every fact.
3. The review model must still be allowed to say "this is genuinely
   disallowed" and stop. That has been zero so far, but the path must exist.

## Current behavior (code)

- `packages/providers/src/anthropic/finishReasonMapping.ts` maps `refusal` to
  canonical `refusal` with `rawStopReason`, on OAuth and API-key paths.
- An empty refusal reaches `validateStreamCompletion`
  (`agents/src/core/streamValidationHelpers.ts`) and throws
  `InvalidStreamError('NO_RESPONSE_TEXT')`. `TurnProcessor` then retries once
  after 500 ms with a changed temperature (`applyRetryTemperature`), and
  `MessageStreamTerminalHandler` may append `System: Please continue.`. None of
  this is an identical retry.
- `streamTelemetryLogger.emitStreamTelemetry` records `attemptOutcome:
  'success'` before validation runs. `tokenUsageRecords.ts` has no `refusal`
  outcome and no finish-reason fields.
- `/stats` (`telemetry/uiTelemetry.ts`, `sessionMetricsAggregator.ts`) counts
  requests and errors only; `ApiResponseEvent.finish_reasons` is ignored.
- The interactive CLI treats public `notice` events as a no-op
  (`agentEventDispatcher.ts`), so a new notice needs host wiring.
- The `compressed` journal record replays to `[summary]` only, so it cannot
  carry a rewrite.

## Design

### Settings (profile-persistable ephemerals)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `refusal.retries` | integer 0 to 10 | `2` | Extra identical retries after a refusal, before review. |
| `refusal.backoff-ms` | integer >= 0 | `15000` | Wait before retry *n* is `min(base * 4^(n-1), 180000)`: 15 s, 60 s, 180 s. `0` retries immediately. |
| `refusal.rewrite` | boolean | `true` | Run the review and rewrite step when retries are exhausted. |
| `refusal.review-profile` | string | unset | Saved profile used for review. Unset falls back to `compression.profile`, then to the session's current model. |
| `refusal.max-rewrites` | integer 0 to 3 | `1` | Rewrite rounds per logical request. |

All five are registered in the settings registry (`cli-behavior`,
`persistToProfile: true`) so `/set` validates them, they save into profiles,
and they never leak into provider `modelParams`. The recovery policy is
captured when a request is admitted so a mid-flight `/set` does not change an
in-progress recovery.

Review profile resolution reuses the isolated auxiliary resolution the
compression profile uses (`CompressionProfileResolver`), extracted into a
shared resolver: its own settings service and runtime id, request-scoped
fetch, session identity, load-balancer members, and the Claude Code-required
system prompt. It never loads the profile into the foreground session. A
misspelled explicit profile is an actionable error, not a silent fallback.
Using the same model that refused is allowed (that is the default when
`compression.profile` is unset); the notice names the reviewer so the user can
see it, and the stop message recommends a different review profile when the
review call is itself refused.

### Detection

A refusal is a provider attempt whose terminal canonical `finishReason` is
`refusal`. Zero output tokens alone is not a refusal. `safety` (Gemini/OpenAI
content filters) stays a separate category and is not recovered by this
feature.

Classification happens at the shared attempt boundary, before
`validateStreamCompletion`, before history commit, and before success token
logging. Visible refusal text (for example "I cannot help with that.") is
discarded with the attempt, the same way a retried stream's partial output is
discarded, so it never enters history.

### Recovery state machine (`packages/agents/src/refusal/`)

One request-owned `RefusalRecovery` coordinator, composed by `ChatSession` and
driven from `TurnProcessor`, so foreground turns, headless runs and subagents
all get it:

1. Attempt → refused → record a refusal (token log, journal, telemetry).
2. While retries remain: emit a notice ("Model refused; retrying in 15 s,
   attempt 1 of 2"), wait (abortable, injectable clock), resend the **same
   prepared request**: same history, same pending user/tool input, same
   provider, model and parameters. No retry temperature, no "Please continue",
   no recompression, no profile reselection.
3. Retries exhausted, `refusal.rewrite` on and rewrites remaining: run review.
   - `disallowed`: stop. Show the reviewer's explanation. No rewrite, no retry.
   - `no_change` (including `insufficient_context:`): stop with explanation.
   - `rewrite`: validate, apply, record, then resend the original model once
     with the rewritten history; that resend gets the same retry budget again
     only if `max-rewrites` allows another round.
   - Reviewer refused, errored, timed out, or returned invalid output: stop.
4. Success → normal completion; one public `done`. If any rewrite happened, a
   notice says which messages changed and which reviewer did it.
5. Exhausted → terminal refusal: the existing #2329 notice plus a summary of
   what was tried ("refused 3 times; reviewer claude-sonnet-5-5 rewrote 1
   message; refused again").

Budgets belong to the logical request. Todo continuation, AfterAgent hooks,
"thinking without output" retries and subagent goal checks must not restart
them, and a terminal refusal must stop those continuations and must not run
tool calls from a refused attempt. The reviewer call never runs refusal
recovery itself.

### Review window and editable content

The window is everything after the last successful provider response of this
session (tracked in memory and persisted with the journal), plus the newest
compression summary if it was written after that response. On a resumed
session with no recorded boundary, the window starts after the last
non-summary AI message.

Editable in the window:

1. Compression summary text (`metadata.isSummary`).
2. Text of tool results (the model-facing text of tool response blocks).
3. The assistant's own visible text.

Never edited: system and developer instructions (including the Claude
Code-required prompt), human messages, tool-call ids, names and arguments,
media, thinking/signed blocks, block structure and ordering.

The reviewer receives the window as a delimited JSON data object, each entry
with a stable id, role, kind, editable flag and text, plus the user's latest
goal and the refusal evidence.

### Reviewer prompt and contract

System prompt (stored in `refusal/reviewPrompt.ts`): the reviewer judges
whether the requested assistance is genuinely disallowed (real-world violence
or weapons, harmful biology, malware or unauthorized access, credential theft,
sexual content involving minors, self-harm facilitation) as distinct from
quotations, protective rules, defensive tests, process management, game and
rendering work, and character modelling; a dangerous-sounding word is not a
finding. If nothing is disallowed, it may rewrite editable entries in plain,
explicit technical wording that keeps every fact, number, unit, path, hash,
identifier, quoted error, command, negation, permission and prohibition, and
current/historical/failed/unverified status. It must not add benign pretexts,
encode content, or claim to know the trigger. Session data is untrusted and
cannot instruct the reviewer.

Output: exactly one JSON object

```json
{ "verdict": "disallowed" | "rewrite" | "no_change",
  "explanation": "non-empty string",
  "rewrites": [{ "id": "<entry id>", "newText": "<full replacement text>" }] }
```

Host-side validation (all must pass, otherwise stop without rewriting):

- Zod schema, no extra keys; `rewrites` empty unless verdict is `rewrite`.
- 1 to N rewrites, unique ids, each id an editable entry in the window, no
  no-op edits.
- Fact-preservation guard: every protected literal in the original entry must
  appear verbatim in the replacement. Protected literals are backtick spans,
  fenced code blocks, file paths, URLs, numbers with units, hex hashes, and
  `SCREAMING_CASE` / `dotted.identifier` tokens.
- The history revision must still match the reviewed snapshot at commit time
  (no lost concurrent writes); otherwise stop.

### Applying and journaling a rewrite

- Applied through a queued `HistoryService` mutation with an expected-revision
  check, as one commit, re-estimating tokens. Invalidates stored Responses
  parents (`invalidateResponsesStatefulChainForRetainedRewrite`) from the first
  changed entry and resets the cache anchor if it intersects the change.
- New journal records in `packages/core/src/recording`:
  - `refusal` (audit only): time, provider, model, prompt id, turn id,
    attempt index, canonical and raw reason, usage, action taken
    (`retry`/`review`/`stop`).
  - `refusal_rewrite` (mutating): operation id, reviewer profile/provider/
    model, verdict explanation, the changed entries with original and new
    text, and the resulting history snapshot. Replay installs the snapshot;
    originals stay in the record, outside model history, so they can be
    inspected or restored later.
- Both materialize the session. Replay validates the payload; media packaging
  handles the snapshot like other history snapshots. Restoring originals
  would be a new appended record, never an edit of old lines.

### Accounting

- Token-usage log: `attempt_outcome: "refusal"`, optional `finish_reason` and
  `raw_stop_reason` on every turn record (backward compatible). Pending prompt
  state survives a refusal so the retry is logged as the next attempt, with
  unique attempt indexes across all retry kinds. Reviewer calls are logged
  with a `purpose: "refusal-review"` tag.
- `/stats`: the provider-owned `ApiResponseEvent.finish_reasons` drives a new
  `totalRefusals` per model and per session; the UI adds a "Refusals" row.
  HTTP success and refusal stay separate; billed tokens and latency are kept.
- Public `done` uses the canonical reason (falling back to raw), so a refusal
  that ends a turn reports `reason: 'refusal'`.

### User-visible notices

Internal `SystemNotice` → public `notice` for retry progress, review start,
rewrite summary and terminal stop. Wire consumers: interactive CLI (render as
an info item; today it is a no-op), headless text (stderr, suppressed by
`--quiet`), stream-json (warning event), A2A (append to status), ACP
(already handled). The rewrite summary names the reviewer model and lists the
changed entries (role/kind, short first-line preview of old → new) and the
operation id stored in the journal.

## Implementation phases

1. **Detection and accounting.** Typed refusal at the attempt boundary
   (before `NO_RESPONSE_TEXT`), token-log outcome and fields, `refusal`
   journal record, `/stats` counter and row, `eventAdapter` canonical reason.
   With recovery disabled (`retries 0`, `rewrite false`) behaviour equals
   today except for correct recording and no temperature/"Please continue"
   retry of refusals.
2. **Settings, backoff and stop guards.** Registry keys, runtime policy
   capture, identical-request retry with abortable backoff, notices and host
   wiring, terminal-refusal guards in the orchestrator, agentic loop and
   subagents. Docs in `docs/reference/ephemerals.md` and
   `docs/reference/profiles.md`.
3. **Review and rewrite.** Shared auxiliary-profile resolver, review prompt
   and contract, validation and fact guard, transactional rewrite with
   `refusal_rewrite` journal and replay, rewrite notice, `max-rewrites`.

## Acceptance tests (Bun, behavioral, local protocol providers)

1. Provider refuses N times then answers: N `refusal` token records, one
   success, identical request bodies (same messages, model, temperature),
   backoff waits observed through the injected clock, no user action, one
   final `done` with `stop`.
2. Empty metadata-only refusal and visible-text refusal both classify as
   refusal; neither enters history; neither triggers `NO_RESPONSE_TEXT`,
   retry temperature or "Please continue".
3. Provider refuses until a nominated summary is rewritten: retries, one
   review call to the configured review profile's endpoint/model, rewritten
   history in the next wire request, success, a `refusal_rewrite` journal
   record holding the original text, the rewrite notice, and `--continue`
   replay restoring the rewritten history without the originals in model
   context.
4. Reviewer returns `disallowed`: no rewrite, no further call to the original
   model, the user sees the explanation, terminal `done` reason `refusal`.
5. Reviewer returns malformed JSON, an unknown or non-editable id, a rewrite
   that drops a protected literal, or is itself refused: no rewrite, bounded
   stop with explanation.
6. Rewritten history also refused with `max-rewrites 1`: stop with the
   summary of attempts; no infinite loop.
7. Abort during backoff cancels promptly; refused attempts never execute tool
   calls; todo continuation does not restart the budget.
8. `/stats` and the token log count refusals separately from successes and
   errors; reviewer usage is tagged.
9. `refusal.review-profile` unset uses `compression.profile`; both unset use
   the current model; an unknown explicit profile gives an actionable error.
10. Subagent: refusal recovery applies to the child chat and an exhausted
    refusal stops the child without running its goal check or tools.

## Out of scope

- OpenAI Responses `response.refusal` events and incomplete content-filter
  normalisation (provider parser gap noted in research).
- Gemini `SAFETY` and OpenAI `content_filter` recovery.
- Offering an automatic model switch.
- Full request fingerprinting for diagnostics.

## Phase 1 implementation notes

Phase 1 ("Detection and accounting") is implemented; behaviour with no
recovery is: a refusal ends the logical request, nothing from the refused
attempt reaches history, and nothing restarts the request.

### The seam

Shared types and helpers live in `packages/agents/src/refusal/`:

- `refusalTypes.ts`: `RefusalEvidence` (what the finalizer saw),
  `RefusalAttempt` (evidence placed in a request: prompt id, attempt index,
  provider, model), `RefusalDecision` (Phase 1: `{ action: 'stop' }`),
  `RefusalRecovery` (`decide(attempt)`), and `ModelRefusalSignal`, the typed
  outcome thrown in place of the history commit.
- `refusalDetection.ts`: `isRefusalFinishReason`, `throwIfRefused`,
  `toRefusalAttempt`. Only the canonical reason `refusal` counts. `safety`
  and zero output tokens do not.
- `terminalRefusalRecovery.ts`: the Phase 1 policy (always stop).
- `refusalJournal.ts`: builds the `refusal` journal payload and writes it
  through `AgentChatRecordingExecution.recordRefusal` (fail-open).

Flow of one refused attempt:

1. `StreamProcessor._convertIContentStream` tracks the terminal canonical and
   raw finish reasons and passes them to `logStreamTelemetry`, which writes
   the token-log record with `attempt_outcome: 'refusal'` (real usage, no
   invented `ttft_ms`) instead of `'success'`.
2. `StreamProcessor.processStreamResponse` calls `throwIfRefused` on the
   accumulated output before `_finalizeStreamProcessing`, so
   `validateStreamCompletion` (`NO_RESPONSE_TEXT`), the history commit and the
   success accounting never see the attempt. The existing `failStreamProcessing`
   path releases the attempt's media admissions.
3. `TurnProcessor._runStreamAttempt` catches `ModelRefusalSignal` before
   `shouldRetryStreamAttempt` and hands it to `_settleRefusal`, which calls
   `RefusalRecovery.decide`, journals the decision, finalizes the prompt's
   pending token state (`TokenUsageLogger.finalizePrompt`) and returns
   `{ error: null, action: 'stop' }`. The content-retry loop in
   `_createStreamGenerator` therefore ends without `applyRetryTemperature` and
   without an `InvalidStream` event, so `MessageStreamTerminalHandler` never
   sends "System: Please continue.".
4. The consumers see the same chunks as before, including the canonical
   `finishReason: 'refusal'` chunk, and stop:
   - `Turn` emits `Finished{reason:'refusal'}`. `MessageStreamOrchestrator`
     records it as `AttemptState.refused` (reset by `discardAbandonedAttempt`),
     and `_evaluatePostTurn` routes to `_finishWithRefusal` before the
     tool-call, thinking-only and todo-continuation branches.
   - `AgenticLoop.streamAndCollect` drops tool calls from a refused attempt and
     reports `shouldScheduleTools: false`.
   - `eventAdapter.mapFinishReason` maps canonical `refusal` (or raw
     `refusal`) to public `done.reason: 'refusal'`.
   - Subagents: non-interactive `readStreamToCompletion` reads the chunk's
     canonical reason; interactive `consumeInteractiveTurnOutput` reads
     `Finished`. Both return `refused`, and `terminateOnRefusal` ends the run
     with the new `SubagentTerminateMode.REFUSAL` (final message is the #2329
     notice text) before tools and the goal check.

### Decisions

- `SubagentTerminateMode.REFUSAL` was added instead of reusing `ERROR`: a
  refusal is neither a crash nor a goal, and callers print the mode verbatim.
- `AgentChatRecordingExecution.recordRefusal` is optional (absent when a host
  keeps no journal). The bridge is `SessionControl.recordRefusal`, which is
  deliberately not on the public `AgentSessionControl`: the public
  `recordRecordingEvent` union is host-authored and was not widened.
- `refusal` is a materializing event type (`SessionRecordingService`), so a
  refusal on the first request still creates the transcript. `ReplayEngine`
  validates the payload with `RefusalPayloadSchema` and otherwise ignores it:
  no history change, no unknown-type warning; a malformed payload reports
  `malformed refusal event`.
- `/stats`: `UiTelemetryService.recordApiEvent` derives `isRefusal` from the
  provider-owned `ApiResponseEvent.finish_reasons`; there is no second
  ingestion path. A refusal stays an HTTP success (tokens and latency kept,
  not an error). New fields: `ModelBreakdown.totalRefusals`,
  `SessionMetricsSnapshot.totalRefusals`, `ModelMetrics.api.totalRefusals`,
  public `SessionStats.apiRefusals`. `ModelStatsDisplay` shows a "Refusals"
  row only when some model has a non-zero count, like the optional token rows.
- Token log schema is backward compatible: optional `finish_reason` and
  `raw_stop_reason` on turn records; `refusal` joins the outcome enum.
  Successful stream and non-stream turns record `finish_reason` too.
  `isRetriedOutcome` includes `refusal` so pending prompt state survives for a
  retry; the terminal stop calls `finalizePrompt`.
- The refused attempt's visible text (if any) has already been streamed to the
  host when the finish chunk arrives, so a Phase 1 terminal refusal leaves that
  text on screen; it is not in history, the token log or later requests.
- As with any failed stream, the user message of a terminally refused request is
  not committed to history (it is committed together with the model reply).
- Tests use the real OpenAI provider against a local OpenAI-compatible HTTP
  endpoint, because the FakeProvider has no prompt-envelope projection and so
  never writes token-log records. The OpenAI mapping turns `finish_reason:
  "refusal"` into canonical `refusal`; the Anthropic parser maps
  `stop_reason: "refusal"` to the same canonical value, so the agents layer sees
  the same shape.

### What Phase 2 should hook

- Policy: replace `terminalRefusalRecovery` with the `RefusalRecovery`
  coordinator (compose it in `ChatSession`, pass it to `TurnProcessor` in place
  of the `refusalRecovery` field default) and widen `RefusalDecision` with
  `retry` (delay) and later `review`.
- Resend: `TurnProcessor._settleRefusal` must return a new outcome (for
  example `action: 'retry-same-request'`) and `_createStreamGenerator` must
  loop on it with the same `requestParams` and the same `prepared` turn.
  `applyRetryTemperature(params, attempt)` in `_runStreamAttempt` derives the
  temperature from the attempt counter, so refusal retries need a separate
  counter (content-retry index for temperature, request-attempt index for
  logging) or an unmodified `params`. The existing `StreamEventType.RETRY`
  yield at `attempt > 0` already makes `Turn`, `MessageStreamOrchestrator`
  (`discardAbandonedAttempt` clears `refused`) and `AgenticLoop` discard the
  refused attempt.
- Attempt indexes: `StreamProcessor.currentAttemptIndex` is the content-retry
  counter. Unique indexes across content and refusal retries are needed so each
  refused attempt keeps its own token record. Call `finalizePrompt` only when
  recovery gives up.
- Subagents: the non-interactive consumer ignores `StreamEventType.RETRY`; it
  must reset `refused`, text and function calls on it before refusal retries
  can work there.
- Stop guards for the logical request budget: `_finishWithRefusal` already
  bypasses todo continuation, thinking-only continuation and AfterAgent
  follow-ups; Phase 2 must keep the retry budget on the logical request (the
  orchestrator-level loops create new `Turn.run` calls).
- Notices: the CLI shows the #2329 notice from `Finished.stopReason` or the
  canonical reason through `buildFinishReasonMessage`; retry-progress notices
  still need host wiring (`notice` is a no-op in `agentEventDispatcher.ts`).
- Not covered in Phase 1: the non-streaming `TurnProcessor.sendMessage` path
  commits whatever the provider returned (it only records `finish_reason`).

## Phase 2 implementation notes

Phase 2 ("Settings, backoff and stop guards") is implemented. A refused
request is resent unchanged after an abortable backoff, within a retry budget
that belongs to the logical request. Review and rewrite are not implemented;
they resolve to a stop at one clearly marked branch (see "What Phase 3 fills").

### Settings

- `refusal.retries`, `refusal.backoff-ms`, `refusal.rewrite`,
  `refusal.review-profile` and `refusal.max-rewrites` are registered in
  `packages/settings/src/settings/registry/registry-entries-4.ts`
  (`cli-behavior`, owner `model`, propagation `next-turn`, like
  `compression.profile`, `persistToProfile: true`). Custom validators reject
  non-finite, non-integer and out-of-range numbers and an empty or blank
  profile name, each with a message naming the key and the allowed range.
  `/set` reaches them through `parseEphemeralSettingValue`.
- Typed `EphemeralSettings` fields (`profiles/types.ts`), the session runtime
  policy projection (`session-settings-owner.ts`, `runtimePolicySchema`), the
  `ReadonlySettingsSnapshot` fields and the `AgentRuntimeContext.ephemerals.refusal`
  accessors (`retries()`, `backoffMs()`, `rewrite()`, `reviewProfile()`,
  `maxRewrites()`). The accessors read the live setting and fall back to the
  registry default when the live value is absent or fails the registry
  validator, so a corrupt profile cannot make recovery unbounded.
- They stay out of provider `modelParams`: `separateSettings` files them under
  `cliSettings`, a saved profile carries them in `ephemeralSettings`, and the
  wire request never contains them (tests assert all three).
- Docs: `docs/reference/ephemerals.md` (new "Refusal Recovery" section) and a
  mention in `docs/reference/profiles.md`.

### Coordinator and budget semantics

`packages/agents/src/refusal/` now has:

- `refusalPolicy.ts`: pure. `captureRefusalPolicy`, `refusalBackoffMs`
  (`min(base * 4^(n-1), 180000)`) and `decideRefusal(policy, progress)`, which
  returns `retry`, `review` or `stop`.
- `refusalNotices.ts`: the notice texts.
- `refusalRecovery.ts`: `RefusalRecoveryCoordinator`, which replaces
  `terminalRefusalRecovery` (deleted). It owns the per-request budgets and the
  injectable abortable `wait`.
- `refusalWait.ts`: the production wait is `delay` from core. A process-wide
  test seam, `installRefusalWaitForTesting`, lets end-to-end tests observe the
  requested backoffs without sleeping.
- `refusalSettlement.ts`: `settleRefusal` now returns `retry-same-request`
  (with `delayMs` and a notice) or `stop` (with an optional notice), journals
  the decision and finalizes the token-usage prompt only on a stop.

Exact budget semantics:

- The logical request is the **prompt id**. `TurnProcessor._createStreamGenerator`
  calls `recovery.admit(promptId)`; the first time an id is seen the coordinator
  captures the whole policy (all five settings read once) next to a zeroed
  budget. A later `/set`, even during a backoff, changes only requests admitted
  afterwards.
- One budget per prompt id is shared by everything that reuses the id:
  task-list continuation, thinking-only retries, AfterAgent decision
  follow-ups, the 413 and boundary recovery sends (`MessageStreamTerminalHandler`
  passes `ctx.prompt_id` to all of them). A recovered refusal does not refund
  its retry: success never resets the budget.
- A tool round trip in the agentic loop (`generateContinuationPromptId`) and
  each subagent turn (`<session>#<subagent>#<turn>`) carry their own prompt ids,
  so each is its own logical request with its own budget and policy. Their
  content differs (new tool results), and a long autonomous run must not run
  out of retries after the first few refusals. If a stricter per-user-prompt
  scope is wanted later, key the budget by the initial prompt id instead.
- Budgets are held in an insertion-ordered map capped at 64 prompt ids; the
  oldest is dropped. ChatSession serializes sends, so only the most recent ids
  are ever live.
- The retry count is per round. Phase 3 resets `retriesUsed` after a rewrite
  and increments `rewritesUsed`; Phase 2 never gets there.

### Retry flow

`TurnProcessor._createStreamGenerator` keeps two counters in `AttemptCounters`:
`contentAttempt` (retry temperature and the content-retry budget, as before)
and `requestAttempt` (every request sent for the turn). `requestAttempt` is the
attempt index given to `makeApiCallAndProcessStream`, the token log and the
journal, so refused and content-retried attempts never share an index.

On a refusal that has retries left the loop yields `StreamEventType.RETRY`
(so `Turn`, the orchestrator, `AgenticLoop`, the CLI and the headless consumers
discard the refused attempt), then a `NOTICE`, waits through
`recovery.wait(delayMs, abortSignal)`, and calls `_runStreamAttempt` again with
the same `requestParams` and the same `PreparedUserTurn`. `applyRetryTemperature`
still receives `contentAttempt`, which a refusal retry does not advance, so the
temperature is untouched; there is no "Please continue", no recompression and
no profile reselection. The request is rebuilt from `HistoryService` at send
time, which is also why a Phase 3 rewrite needs no special resend path.

An abort during the wait rejects the wait, finalizes the pending token-usage
prompt and rethrows, which `Turn.handleRunError` turns into `UserCancelled`
and the public `done` reason `aborted`. No further request is sent.

Journal actions are `retry` for each retried attempt and `stop` for the last.
With rewrite on, Phase 2 still journals `stop`: `review` is only recorded once
a review is really started. The terminal-stop summary notice is emitted only if
at least one retry ran, so `refusal.retries 0` is byte-for-byte the Phase 1
behavior.

### Notices

`RefusalDecision.notice` → `refusalNotice()` in `TurnProcessor` →
`StreamEventType.NOTICE` (new, `{ message, source: 'refusal-recovery' }`) →
`Turn.dispatchStreamEvent` → internal `AgentEventType.SystemNotice` (new
optional `source`) → `eventAdapter` → public `notice` event with the optional
`source` field (`event-types.ts`, `event-schema.ts`).

There were no earlier `SystemNotice` producers. The only other public `notice`
is the MCP discovery failure in `foregroundRunLifecycle.ts`, which has no
`source`. The hosts therefore render only notices that carry
`source: 'refusal-recovery'`; the interactive CLI used to ignore every notice
and rendering the MCP one on every prompt would have been noise.

- Interactive CLI (`agentEventDispatcher.ts`): info item, after committing any
  pending refused text.
- Headless (`nonInteractiveCliSupport.ts`): text mode writes to stderr;
  stream-json emits a `warning` error event (the shape the refusal warning
  uses); plain JSON writes nothing (the JSON result has no warnings field);
  `--quiet` suppresses all of it.
- A2A (`executor.ts`): `\n\n[recovery notice] <message>` appended to the task,
  like the `[safety notice]`.
- ACP already forwards every `notice` as an agent message chunk, so it shows
  these (and, as before, the MCP one).

### Other consumers

- Non-interactive subagent: `readStreamToCompletion` now resets the collected
  function calls, text, hook restrictions and the `refused` flag on
  `StreamEventType.RETRY` (Phase 1 risk 4). The interactive subagent consumer
  already handled `AgentEventType.Retry`.
- CLI hooks (Phase 1 risk 5): the interactive CLI no longer schedules model
  tool calls or continues todos itself; `AgenticLoop` and the orchestrator do,
  and both already drop a refused attempt (Phase 1). The CLI's own
  `scheduleToolCalls` runs only for client-initiated slash-command tools. No
  new guard was needed. A public-API test now proves that only the tool call of
  the attempt that was not refused runs, and that none runs when retries are
  exhausted.
- Non-streaming `TurnProcessor.sendMessage` (Phase 1 risk 6): its only callers
  are tests and the `clientContract.sendMessage` declaration. No user-facing
  flow uses it, so refusal classification was not added there. It still commits
  whatever the provider returned; add the classification if a caller appears.

### Tests

- `settings/src/__tests__/refusalSettings.test.ts`: registration, defaults,
  validation messages, no model-param leakage.
- `agents/src/refusal/refusalPolicy.test.ts`: pure policy and backoff cap.
- `agents/src/api/__tests__/refusalRecovery.behavior.test.ts`: public
  `agent.stream()` over the real OpenAI provider and a local HTTP endpoint:
  recovery, exhaustion, retries 0, abort, shared budget, tool calls,
  admission-time policy.
- `refusalRecovery.anthropic.behavior.test.ts`: the real Anthropic provider
  (API-key path) against local Anthropic SSE with a metadata-only
  `stop_reason: "refusal"` stream.
- `refusalSettings.behavior.test.ts`: profile capture and wire body.
- `subagentNonInteractive.refusal.test.ts`, `agentEventDispatcher.notice.test.ts`,
  `nonInteractiveCliSupport.refusalNotice.test.ts`, `setCommand.refusal.test.ts`
  and the a2a `executor.refusalNotice.test.ts`.
- The Phase 1 helper `refusal-endpoint.ts` now takes options. It sets
  `refusal.retries 0` unless a test says otherwise, so the Phase 1 tests keep
  their single-request shape.

### What Phase 3 fills

The decision branch is `RefusalRecoveryCoordinator.decide()` in
`packages/agents/src/refusal/refusalRecovery.ts`. When `decideRefusal` returns
`review` (retries used, `refusal.rewrite` on, `rewritesUsed < maxRewrites`) the
coordinator today calls `this.stop(...)`. Phase 3 replaces that line.

What it receives: the `RefusalAttempt` (prompt id, request attempt index,
provider, model, finish reasons, usage, turn id), the captured `RefusalPolicy`
(including `reviewProfile` and `maxRewrites`) and the request budget. `decide`
may already be async (`RefusalRecovery.decide` returns a value or a promise).
The history window is not in the coordinator yet. Add a `reviewer` dependency
to `RefusalRecoveryDeps`, built where the coordinator is constructed in
`ChatSession` (the constructor call added next to the `TurnProcessor`
construction), which has `this.historyService` and the compression profile
resolution.

How to resend after a rewrite: return `{ action: 'retry', delayMs: 0, notice }`
after applying the rewrite, with `budget.rewritesUsed += 1` and
`budget.retriesUsed = 0` so the resend gets a fresh retry round. The turn loop
then yields `RETRY` and the notice and resends the same prepared request. It
needs no other change because the provider request is rebuilt from
`HistoryService.getCuratedForProvider` at each send, so it sees the rewritten
history. A review that ends in a stop returns `{ action: 'stop', notice }`; the
journal action `review` should be recorded when the review is started (add it
to `RefusalDecision`) and `stop` when it gives up.

Also for Phase 3: the review call must not run refusal recovery itself (it does
not pass through `TurnProcessor.sendMessageStream`, so it cannot as long as it
uses the isolated auxiliary path), and the docs for `refusal.rewrite` currently
say review is not available yet.
