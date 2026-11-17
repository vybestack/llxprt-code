# Issues 4092, 4093, 4094: stream and shell timeouts

One branch (`issue4093`), one commit per issue.

## 4092: first-response timeout off by default

`DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS` is now `-1`. The watchdog treats any value of 0 or below as disabled, so
an unset setting arms nothing. The env var `LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS`, `/set`, `--set` and profiles
still override. The resolver returns the built-in default as `-1` (explicit values of 0 or below still normalise to 0);
both mean disabled.

Changed text: registry description, CLI schema `documentedDefault`, generated `schemas/settings.schema.json` and
`docs/cli/configuration.md`, `docs/agent-api.md`, a new "Stream timeouts" section in `docs/reference/ephemerals.md`,
and the two code comments that named the 5-minute timeout.

Tests changed (red before the change, green after):
- `streamIdleTimeout.test.ts`: default is -1, resolver returns -1 for unset, invalid and empty inputs (9 red).
- `turn.preRequestTimeout.test.ts`: a never-answering stream is not interrupted after 10 minutes by default.
- `turn.abort-timeout.test.ts`: the two tests about an armed watchdog now arm it explicitly.
- `settingsSchema.test.ts`: documented and generated default is -1.

## 4094: shell inactivity timeout defaults to 300 s, profiles control it everywhere

- The default lives in the registry entry (`default: 300`); `Config.getShellExecutionConfig` reads it with
  `getSettingSpec` instead of the literal `120`.
- Finding: the CLI builds its `Config` before the profile is applied, and `Config.getShellExecutionConfig()` read only
  the construction-time snapshot. The agent's shell tool was fine (its host overlays the live session policy), but
  commands the user runs with `!` and shell prompt substitutions used the snapshot, so a `--profile-load` or
  `/profile load` value was ignored there. `Config.bindLiveSettingsReader` now lets the CLI hand the Config a live
  view (`loadCliConfig` binds it to the preflight's settings capture).
- Known limit: a subagent runs its commands through the parent session's shell tool (the child catalog inherits the
  parent's tools), so the shell inactivity value in a subagent's own profile is not applied to those commands. The
  child's settings do receive the value. Fixing it needs per-child shell tool construction, which is a larger change
  than this issue. `docs/reference/ephemerals.md` says so.

Tests:
- `shell-session-settings.test.ts`: registry default 300, startup snapshot value, live reader (red: default test,
  120000 expectation).
- `shell-inactivity-profile.behavior.test.ts` (agents): `/profile load` of 900 and -1 reaches the shell host, and the
  next profile without a value returns to 300 (characterisation, already green).
- `profileOverridePrecedenceParity.test.ts`: `--profile` at startup reaches both the session policy and
  `config.getShellExecutionConfig()` (red before `bindLiveSettingsReader`).

## 4093: resend the request after a stream timeout

Design. The watchdogs live in `Turn`, above the chat session, so the retry lives in `Turn.run` rather than in
`TurnProcessor` (which never sees the timeout; the Turn aborts it and abandons its stream).

- `turnTimeoutRetry.ts`: `retryOnStreamTimeout` wraps one attempt. When an attempt ends with a `StreamIdleTimeout`
  event it holds the event back, yields `Retry` (the same signal a content retry and a refusal retry give, which the
  orchestrator turns into "discard partial output"), yields a notice, waits (abortable) and runs the attempt again
  with the identical request. After the retries it yields a "timed out on all N attempts" notice and the original
  timeout event, so the turn ends as before.
- `Turn.run` now delegates to it; the old body is `runAttempt`. A fresh `IdleFlag` and watchdog per attempt.
- Settings: `retries`/`retrywait` do not fit (they drive provider-level retries of HTTP failures, default 6, and a user
  who sets `retries 0` for that would silently lose timeout recovery). New registry key `stream-timeout-retries`
  (0 to 10, default 2, profile persistable). The wait reuses `refusalBackoffMs` with `refusal.backoff-ms` as the base
  (15 s, 60 s, 180 s by default). Both are read from the live stream-timeout policy when a request starts.
- Notice text: `Request timed out (first response, 300 s); retrying in 15 s (attempt 1 of 2).` and
  `Request timed out on all 3 attempts. Stopping.` They carry the new source `stream-timeout-retry`; hosts that showed
  `refusal-recovery` notices now show any sourced notice (CLI UI, headless text/stream-json, a2a, public schema).
- Token log: `abortForStreamTimeout` aborts the turn's controller with `StreamTimeoutAbortReason`, a `DOMException`
  named `AbortError` (so providers treat it like any abort) that `isStreamTimeoutAbort` recognises. A module-level
  `WeakSet` was tried first and rejected by `check:runtime-boundary`. `TurnProcessor` watches the signal and logs the
  attempt at the moment of the abort (`attempt_outcome: error`, `retry_reason: stream-timeout`, prompt tokens from usage or 0), so the
  record is written before the resend; logging from the abandoned attempt's catch block lost a race with the
  successful attempt that consumes the pending entry.
- Cancellation review: `Turn.handleRunError` checks the parent/user signal before interpreting the attempt's watchdog flag. Watchdog aborts become `StreamIdleTimeout` through the per-attempt `IdleFlag`; parent aborts become `UserCancelled`. The backoff uses `delay(ms, signal)`, so cancellation during the wait ends the turn without another request.
- Partial-output review: the retry wrapper withholds intermediate timeout events and emits `Retry` before notice/backoff; the orchestrator discards that attempt's uncommitted response, and the cooperative HTTP-provider tests commit only the successful answer. Noncooperative-provider behavior requires the separate lifecycle remediation below. After retry exhaustion, only the final timeout reaches the orchestrator.
- Scope review: interactive subagent turns also use `Turn.run` and receive the same per-call retry budget. `subagentNonInteractive` and `DirectMessageProcessor` direct generation retain their existing timeout handling; this change does not add retries to those separate paths.
- Request and attempt review: each retry closes over the original `TurnRequest` and model parameters. The behavior test compares the complete captured wire-request objects across attempts, while token records distinguish attempt 0 failure and attempt 1 success. Budget is per `Turn.run`; continuations under one prompt id each get a fresh, independently bounded budget. A retry resends the provider request, so a timed-out request may still have incurred provider-side work or billing before the connection stalled.

Tests (all through the public `agent.stream()` against a local HTTP endpoint that stalls; the first-response
watchdog is armed at 1 s):
- stall once then answer: completes with no user action, identical wire request, one `retry` event, notice text,
  history holds the prompt once and the answer once, token log has attempts 0 (`error`) and 1 (`success`).
- stream that goes silent after some text (idle watchdog): partial text shown, then `retry`, only the full answer
  committed.
- always stall: 3 requests, one `idle-timeout`, `done: error`, notices end with the count, nothing in history; with
  `stream-timeout-retries` 0 it stops at the first timeout.
- abort during a 120 s wait: ends `aborted`, one request sent.
- Unit tests for the retry loop (`turnTimeoutRetry.test.ts`) and the setting (`streamTimeoutRetries.test.ts`).
- Fixture change: `createTurnStreamPolicy` and `createChatPolicyFixture` default `stream-timeout-retries` to 0 so
  the older Turn tests, which observe one attempt, keep their meaning.

Red then green: the behavior file was run before any production change (8 of 10 red, the two green cases were the
history and retries-0 assertions that hold without a resend). The settings unit test and the retry-loop unit test were
written after the code (disclosed deviation).

## Retry behavior review

- Parent/user cancellation wins over a watchdog result in `Turn.handleRunError`; cancellation while waiting for a resend
  yields `UserCancelled` and never starts another attempt. The integration tests cover cancellation during a stalled
  stream and during backoff. They do not force an exact simultaneous abort/watchdog race; precedence is determined by
  whether the parent signal is aborted when the error is handled.
- A watchdog abort is mapped to `StreamIdleTimeout`, then retained until retries are exhausted. Each timeout retry
  emits `Retry`, so the orchestrator drops that attempt's partial output. UI-visible partial text can have appeared
  before the retry signal; only completed output is committed to history. The behavior tests check this history
  boundary.
- The retry passes the same `TurnRequest` into each `runAttempt`. The wire test now compares the entire captured
  request object, covering model, messages, and all other serialized request fields.
- Token records verify attempt indexes 0 and 1 and outcomes `error` then `success` across a timeout and recovery.
- Interactive subagent turns use `Turn.run`, so they share the timeout retry behavior. Noninteractive subagent runs
  and `DirectMessageProcessor` direct-generation handling are separate paths and were not changed or claimed as covered
  by this retry behavior. Each `Turn.run` has its own bounded budget, including continuations.
- A resent provider request can still incur provider-side work or billing if the provider processed it before its
  response stalled. The cooperative-provider tests keep abandoned output out of local history. The independent review below found gaps for providers that ignore cancellation; a retry cannot undo remote provider work.

## Independent review and remediation

Review of committed `c0b5fda0a4` identified three gaps that the cooperative HTTP tests do not establish. Each is fixed
on this branch (`b1f4aff2cf`, `ef0612fd54`), test first.

1. Blocked resend. A provider stream that ignores the abort kept its semantic-media-purge lease, its user media
   admission and the send queue, so the replacement never reached the provider. `releaseWhenAttemptAborted`
   (`turnMediaAdmissionLifecycle.ts`, called from `TurnProcessor.sendMessageStream`) releases all three when the
   attempt's signal aborts, without waiting for the provider iterator. `SemanticMediaPurgeAttempt.retire()` during an
   in-flight purge commit rolls the commit back once it settles. `releaseIfUncommitted` is idempotent and
   `transferToHistory` has a `transferring` state.
2. Late EOF. A late chunk or EOF from the abandoned attempt could finalize partial output after the replacement
   started. `StreamProcessor` passes the attempt signal to `processStreamResponse`, `_convertIContentStream` and the
   finalizer, and throws before sending a request prepared late, on each chunk, at EOF, before purge completion and
   inside the history publication hook, so the batch is rolled back through the existing history machinery.
3. Rebuilt request. Reopening the chat send reran the preparation hooks and rebuilt the request. `Turn.run` now creates
   one `LogicalSend` (`logicalSend.ts`) holding the `SendRequestState` and the turn id. A resend uses `replayOptions`
   (`requestReplay.ts`): the options the provider was handed, bound to the new attempt's signal, observers, raw-token
   sink and request context, with `prepareAtSendSeam` run again for a new one-shot transport token. Hooks and live
   settings are not read again. System prompt assembly still runs at the start of every send
   (`ChatSession._withResolvedSystemPrompt`); the kept system prompt is the one transmitted. This holds for direct
   routes: a load-balancer route selects a member on every request.

Deviations from the remediation design: `providerRequestContext` is not shared across attempts (sharing it made the
replacement look already committed), and no abort signal was added to `HistoryBatchOptions`.

Known remaining window: an abort that lands between the last check and the history assignment publishes the batch and
then rolls it back, so history observers see an add followed by a rollback.

Regression tests and their results against `c0b5fda0a4` source:

| Test file | Before the fix | After |
| --- | --- | --- |
| `core/turn.timeout-lifecycle.behavior.test.ts` (real `Turn`, `ChatSession`, `HistoryService`; provider ignores every signal) | 0 of 6 pass | 6 of 6 |
| `api/__tests__/streamTimeoutReplay.behavior.test.ts` (real hook subprocesses that answer differently each run) | 1 of 4 pass | 4 of 4 |
| `api/__tests__/streamTimeoutLifecycle.behavior.test.ts` (agent level) | 4 of 4 pass | 4 of 4 |

The agent-level file mostly characterises: registered providers go through `guardStream`, which already races a stream
against the abort, so an abort-ignoring stream cannot be reproduced there. The `Turn`-level file is the reproducing
test.

Integration findings on this branch:

- The remediation commits removed `_applyToolSelectionHook` from `TurnProcessor` and `StreamProcessor`.
  `toolSelectionHook.allowedFunctionNames.test.ts` calls that method on all three processors and failed 20 of 30 tests
  in the remediation worktree. Both methods are restored as thin wrappers over the shared helpers.
- `origin/main` gained refusal diagnostics (#4116, #4118) in the same `StreamProcessor` code. The merge keeps both:
  main's dump attempt context, refusal audit fingerprint and extracted helpers, and this branch's attempt signal and
  kept-request replay.

## Second review and remediation

A second review of `863dba0ea4` (after the merge of `origin/main`) read the source only and ran no tests. It reported
2 HIGH, 7 MEDIUM and 1 LOW findings. Six were reproduced with a failing test and fixed, each in its own commit:

| Commit | Finding | What the failing test showed |
| --- | --- | --- |
| `9993a05874` | An attempt abandoned while its `BeforeModel` hook ran resumed later and wrote its unsent request over the kept one, so the next resend replayed a request that never reached the provider. | The resend carried `hook pass 1` (the abandoned request) in place of `hook pass 2`. |
| `eebb64da0d` | The idle watchdog stays armed through history finalization. A slow cleanup after the commit ended the attempt with a timeout and the turn resent. | 2 provider requests; the user message and the answer each in history twice. |
| `90edfb0291` | `admitRefusalAuditChunk` (added on main in #4118) returned only the admitted content, so the chunk's original AFC history reached history. | An inline image in a streamed AFC history was stored as `base64`, expected `reference`. |
| `63c55dcb44` | `Config.getShellExecutionConfig` fell back from an unset live value to the startup snapshot. | With 900 at startup and the setting cleared by a profile, `!` commands used 900 s where the agent's shell tool used 300 s. |
| `a717c1d471` | The attempt signal was checked between admitting a chunk's media and registering the admission for release. | An attempt aborted as its output image was reserved left 1 reservation owner; 1 of 2 objects could be reclaimed. |
| `f01f9721cc` | An attempt abandoned before the provider call never released its prompt-envelope projection. | A first attempt and a resend, each timed out inside its estimate, released their projection 0 times. |

After `eebb64da0d` a timeout that lands once the answer is in history ends the turn with the timeout event and does
not resend; the answer stays in history once.

`5bebb2d0ce` replaces the relaxed replay assertions from `a09b99b789`. The cause stated in that earlier commit was not
measured. A diagnostic over 14 runs measured it: with a 1 s first-response watchdog, the first attempt's own preparation
(two hook subprocesses, then prompt estimation and context enforcement) took 0.76 to 1.4 s at load 40 to 50, so in 6 of
14 runs the watchdog fired after dispatch and before the request reached the endpoint. The scenario now arms the idle
guard, which starts at the first streamed text, uses the default budget of 2 retries and asserts exactly: two requests
for the first prompt, one run of each hook, attempts 0 (`error`, `stream-timeout`) and 1 (`success`). That scenario no
longer covers the first-response guard; `streamTimeoutRetry.behavior.test.ts` does.

`retry_reason` is written only at the `debug` level of the token-usage log. The default `summary` record of a
timed-out attempt has `attempt_outcome: error` without it.

Known follow-ups. Each was found by reading the code and has no reproducing test:

- Load-balancer profiles: every request selects a member (`LoadBalancingProvider.selectNextSubProfile`), so a resend
  can reach a different member, model and re-rendered system prompt. The identical-resend guarantee covers direct
  routes.
- An idle watchdog shorter than `refusal.backoff-ms` can fire during a refusal backoff, because the watchdog is rearmed
  only by provider liveness and model chunks. On main that ends the turn with an idle timeout; on this branch it also
  spends a timeout retry and resends the refused request. Both stream watchdogs are off by default.
- A reviewer rewrite of the pending turn followed by a stream timeout: the kept wire request carries the rewrite, but
  the outer retry starts from the original turn, so the turn committed to history is the original. The content-retry
  counter restarts on an outer retry as well.
- An abandoned attempt's failure path calls `clearProviderCompressionCallback`, which may detach the callback of the
  attempt that replaced it.
- `snapshotSentOptions` copies the outer arrays and the metadata record; nested content blocks and tool schemas stay
  shared with the first attempt.
- The fix in `9993a05874` is tested for the hook window. The same fence before `keepOptions` on the replay path and
  after context enforcement has no test of its own.

## Verification

Commands run in the issue4093 worktree after merging `origin/main`:

| Command | Result |
| --- | --- |
| `bun test --timeout 120000 packages/agents/src/api/__tests__/streamTimeoutRetry.behavior.test.ts` | Passed: 13 tests, 0 failures, 30 expectations. |
| `npm run format` | Passed (exit 0). |
| `npm run lint` | Failed (exit 1): branch max-lines violation in `packages/core/src/session/session-settings-owner.ts` at line 876; file has 801 lines against the 800-line limit. Policy readers have since been extracted without changing rule limits; focused tests and targeted ESLint pass, with the complete lint rerun still running. |
| `npm run check:runtime-boundary` | Failed (exit 1). Runtime-state scan completed but reported widened/stale `runtime-service-bundle` baseline entries for `packages/core/src/runtime/AgentRuntimeLoader.ts`. The service-shape scan was `blocked-by-compiler` and ambient-delegation results were `provisional-compiler-errors`; diagnostics include missing `@ai-sdk/google` and `@ai-sdk/google-vertex` modules and incompatible `google-auth-library` `Headers` types in the Google Gemini plugin. |
| `npm run typecheck` | Passed (exit 0). |
| `npm run build` | Passed (exit 0), including the compiled lazy-MCP registry coherence check. |
| `bun scripts/check-test-file-coverage.ts` | Passed: zero uncovered and zero doubly-executed test files. |

The stalled-stream cancellation regression is covered by the behavior test in this verification run. The table preserves the initial verification results. The final remediation run is still active, including runtime-boundary after a successful build; these checks are not yet claimed green. The API-surface declaration guard timed out at both its default and extended deadlines under concurrent load and must be rerun after contention subsides.
