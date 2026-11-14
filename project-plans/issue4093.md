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
- Cancelling: the wait is `delay(ms, signal)`; an abort ends the turn with `UserCancelled`.
- Partial output: the orchestrator already discards on `Retry`; the stream finalizer never commits an aborted stream.
- Unchanged: subagents (`subagentNonInteractive`) and `DirectMessageProcessor` keep their own idle handling.
- Budget scope: per `Turn.run` call. Continuations under one prompt id each get a fresh budget; each is still bounded.

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
