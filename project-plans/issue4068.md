# Issues #4068 and #4067: token-usage log levels, retention, and compression usage

One change set covers both issues because both change what the token-usage
log writes, and #4067's compression records must fit #4068's summary rules.

## #4068: levels

- `token-usage-log` is an enum `off | summary | debug`, default `summary`
  (`packages/settings/src/settings/tokenUsageLogLevel.ts`, registry entry in
  `registry-entries-2.ts`).
- Legacy booleans: `validate` and `normalize` map `true`/`false` to
  `summary`/`off` for settings files and profiles; `parse` maps the words
  `true`/`false` typed at `/set`. Anything else fails validation with a message
  naming the valid levels.
- One accessor, `resolveTokenUsageLogLevel`, reads the stored value: unset
  means `summary`, invalid throws. `SessionSettingsOwner.readRuntimePolicy`
  uses it; the runtime context exposes `readTokenUsageLogLevel()`, a live
  read; `ChatSession` passes that reader to `createTokenUsageLogger`.
  `TokenUsageLogger` takes a level only (no boolean overload).
- The setting is `propagation: 'next-turn'`, so the level is resolved per
  request (see "Review fixes" below), not once per chat.
- Serialization: the logger builds the full record, then `debug` writes it and
  `summary` writes `toSummaryTurnRecord(full)` (`tokenUsageSummaryRecord.ts`),
  an explicit list of scalar fields. Omitted values stay omitted, never zero.
- New derived fields: `fixed_tokens` (instructions + tool schemas, only when
  both were measured), `new_tool_result_count`, `timing_source` (`raw` when
  `StreamTimingTracker` stamped from raw deltas, `visible` otherwise, absent
  when no token window was measured).
- `tool_calls` lists only results new in this request. The context field
  `toolCalls` now carries new results only and is attached at `debug` only.
- `off` writes nothing; every send-seam helper returns before any shape or
  estimate work. At `summary` the prefix fingerprint is not computed.
- Debug keeps the pre-existing detail fields the issue does not name
  (`effective_actual_tokens`, `user_turn`, `step`, `cache_read_tokens`,
  `tool_tokens`, `total_tokens`, `retry_reason`, `http_status`,
  `backend_profile`), so debug loses nothing it recorded before.
- Summary also keeps `finish_reason` and `raw_stop_reason` when reported.
  #4036 (closed) required refusals to be logged with the provider's stop
  reason, and its behavior tests assert that on the default log. #4068's list
  does not name them; dropping them would regress #4036 at the default level.
  They are two short scalars.
- Lifecycle records are unchanged in shape and written at both levels.

### Size target

The issue targets under 800 bytes per summary record. With the field list the
issue requires, the key names alone are about 500 bytes, and production
identifiers add 250 to 400 more (a subagent's session id is
`<root>::<root>#<name>#<hash>` and its prompt id embeds the session id). A
summary record measured 866 bytes for the main-session smoke-test request and
1.0 to 1.1 KB for a subagent request with production-length ids. Reaching 800 bytes needs a decision about
dropping or shortening identity fields, which the spec lists as required, so
it is reported rather than decided here. The test asserts the bound met with
production-length ids and production-magnitude timing, written in whole
milliseconds: under 1,150 bytes (it was 1,200 before rounding; see "Review
fixes").

## #4068: retention

- `cleanupTokenUsageFiles` (`packages/core/src/recording/janitor/tokenUsageRetention.ts`)
  runs inside the janitor sweep, under the global lease, after stale-lock
  cleanup.
- Age: `sessionRetention.maxAge`, the chat age policy (no default limit).
- Size: new setting `sessionRetention.tokenUsageMaxTotalSizeMB`, default 1024,
  registered in the CLI settings schema and resolved in `retentionPolicy.ts`.
  The 4 GiB `maxTotalSizeMB` belongs to recordings; reusing it would let
  token-usage logs grow to 4 GiB on their own, so it gets its own budget.
  1 GiB holds about a million summary records, and it is above the 653 MiB of
  full-detail logs on this machine today, so the first sweep after upgrading
  does not delete recent files the weekly analytics rollup has not collected.
  Eviction is oldest first; protected files count toward the total but are
  never evicted.
- Protection, reusing the janitor's checks: the file's root session (the part
  before `::`) is the current session, or holds a live lock in that project's
  `chats/` dir (`SessionLockManager.isLocked`, stale locks excluded), or the
  file was written within `minRetention`. Root ids outside the safe session-id
  grammar cannot be lock-checked and are left alone. Each deletion takes the
  root session's lock, re-stats the file under it, skips it if its identity,
  size or mtime changed since the scan, unlinks and releases (see "Review
  fixes").
- `token-usage/` directories are never removed, even when empty (see "Review
  fixes"). I/O failures are counted into the sweep's `failed` total, like the
  other janitor phases.

## #4067: compression usage

Root cause, confirmed: `applyFallbackCompressionResult` picked the summary with
`selectCompressionSummary(result.newHistory)`, which returned the first
`compression-state-snapshot` entry. From the second compression on, middle-out
keeps the earlier summary in its preserved head, and high-density and
truncation keep it in history without making a new one. Telemetry then read
`summary.metadata.usage` from that old entry.

Fix:

- Telemetry takes `AppliedCompressionTelemetry` from the strategy result:
  `metadata.strategyUsed`, `metadata.llmCallMade`, `metadata.usage`, plus the
  number of strategy invocations in this compression (primary retries, the
  one-shot route, the truncation fallback). The compression record gains
  `compression_strategy`, `llm_call_made`, `compression_attempts`, all
  scalars. Usage is absent when no LLM call was made.
- All four strategies already report consistently: middle-out and one-shot set
  `llmCallMade: true` and `usage` from the summary call; high-density and
  top-down-truncation set `llmCallMade: false` and no usage. No strategy
  change was needed. The optional verification pass's usage is not included in
  either LLM strategy's report (see open questions).

`selectCompressionSummary`'s other use was also wrong. The selected summary is
stored as `compressionSummary` and passed to `HistoryService.endCompression`,
which emits `compressionEnded`; the session recording writes it as the
`compressed` record, and replay resets history to `[summary]`. With the stale
pick, a second middle-out compression journaled the first summary, and a
high-density or truncation compression after an LLM compression journaled the
old summary, so a resume would collapse history onto it. The function now only
considers entries without a chronology marker: HistoryService stamps every
entry it stores, so carried entries have one and the summary a strategy just
generated does not. A compression that produced no summary emits no
`compressionEnded`, the same as a first high-density pass.

## Tests

- `packages/settings/src/__tests__/tokenUsageLogSetting.test.ts`: default,
  legacy mapping (validate, normalize, `/set` parse), invalid rejected.
- `packages/core/src/session/session-settings-owner.test.ts`: runtime policy
  level for unset, `true`, `false`, `debug`; invalid fails fast.
- `packages/agents/src/core/TokenUsageLogger.level.test.ts`: two-request tool
  session through the real send seam, timing tracker and usage mapping at each
  level; exact field sets; no arrays in summary; debug `tool_calls` only new;
  carried tokens; `fixed_tokens`; reasoning absent vs present; raw vs visible;
  size bound; `off` writes no file and does no shape work.
- `packages/core/src/recording/janitor/tokenUsageRetention.test.ts`: age,
  byte budget oldest first, active and locked sessions and their subagents
  kept, janitor sweep leaves chats to their own rules, nothing deleted without
  limits.
- `packages/agents/src/compression/__tests__/compressionTelemetryUsage.test.ts`:
  real handler, history and strategies. Two middle-out compressions with the
  first summary retained report 1007/103 then 2007/203; the recording receives
  each compression's own summary; a high-density pass after an LLM compression
  reports no usage, `high-density`, `llm_call_made: false`, and emits no
  `compressionEnded`. All three failed on the old code (logs in
  `tmp/verify4068/4067-red*.log`).

## Review fixes

An independent review returned four findings; all are fixed in the second
commit.

### Retention held no lock across deletion (high)

The scan checked `SessionLockManager.isLocked` for the root session, then
deleted later. A session could take its lock in between without changing the
file's inode or mtime, and its log was deleted. `deleteScanned` now follows
the chat reclamation engine (`reclamationEngine.ts`, `directDeleteRawUnderLock`):
it takes the root session's lock with `SessionLockManager.acquire` (no wait;
`SessionLockedError` means busy and skips the file, any other error is counted
in `failed`), revalidates under the lock (same dev, inode, size and mtime, and
`ownsLock()`), unlinks, and releases in `finally`. The root of a subagent file
is the part before `::`. The scan-time check stays as a cheap filter. Taking
the lock can create a project's `chats/` directory, where a starting session
would create the same lock.

Tests (`tokenUsageRetention.race.test.ts`) use a narrow scan-to-delete hook,
the twin of the janitor's existing scan-to-mutation hook, with real files and
the real lock manager: a lock taken after the scan keeps a root file and a
subagent file (both deleted by the old code, `tmp/verify4068/f1-red.log`); an
append after the scan keeps the file; a replacement with identical size and
mtime keeps it (inode differs; the replacement is staged before the rename so
the inode cannot be reused); an idle file is still deleted and its lock is
free afterwards.

### `/set token-usage-log` did not reach an existing chat (medium)

The runtime context captured the level once and the chat built its logger
once. Now:

- `AgentRuntimeContext.readTokenUsageLogLevel()` reads the owner's live
  policy, like the other `read*` policies.
- `TokenUsageLogger` keeps the current request's level and a reader.
  `beginRequest()` reads the live level and applies it; it is called once per
  provider attempt at the request boundary: the `apiCall` closure in
  `StreamProcessor._executeStreamApiCall` (where the per-attempt raw-delta
  bridge is minted) and before the send seam in
  `TurnProcessor._executeProviderCall`.
- Requests of one session are sequential and each attempt's actual usage is
  recorded before the next attempt begins, so an attempt is written at the
  level it started with. Pending attempts and request-shape memory are kept
  across level changes. `createTokenUsageLogger` resolves the log path even
  when the level starts at `off`.
- A request sent at `off` is not observed by the shape memory
  (`noteUnobservedRequest`). The next observed request cannot separate new
  from carried tool results, so it omits the split (and `tool_calls`) instead
  of over-counting new results, and its `prefix_fingerprint_changed` is
  `null`. The keys are set to undefined, not dropped, so a retry of the same
  prompt cannot inherit an earlier attempt's split. Between `summary` and
  `debug` nothing is lost.

Test (`tokenUsageLevelSwitch.test.ts`): one real `ChatSession` reading a real
`SessionSettingsOwner`, the level changed with the `/set` parser and a user
write. Summary → off writes nothing more → debug writes a debug record →
summary writes a summary record with the correct carried total; summary →
debug → summary keeps `tool_calls` to the new result and the carried total
equal to the previous request's new total. All three tests failed on the old
code (`tmp/verify4068/f2-red.log`).

### `off` still did logging-only work (medium)

`recordSendSeamTelemetry` now returns at entry when the request is not
logged, before the system instruction is extracted.

`StreamTimingTracker` and `RawTokenDeltaBridge` serve only the token-usage
record: the tracker's measurement reaches nothing but `attachStreamTiming`.
API-response telemetry (`logApiResponse`) times the call from its own start
time; the providers' `AttemptRecorder` gets raw deltas through its lifecycle
observer, which `resolveRawTokenDeltaNotifier` fans out independently of the
caller sink; refusal handling (#4036) reads finish reasons from chunks; no UI
reads either. So `beginTokenUsageAttempt` returns no bridge for an `off`
attempt (no sink in request metadata) and `startAttemptTiming` creates no
tracker. Because the decision is per attempt, a chat switched from off to
summary times its next request.

Tests: a counting getter on the system instruction is read at summary and not
at off; `beginTokenUsageAttempt`/`startAttemptTiming` install nothing at off
and a working bridge and tracker after switching on; in the session test the
provider sees no sink at off and a sink after switching on, and that request's
record has raw timing.

### Whole-millisecond timing (maintainer decision)

`ttft_ms`, `provider_request_ms` and `generation_ms` are rounded at both
levels. `generation_ms` is the difference of the rounded endpoints, so
`ttft_ms + generation_ms` never exceeds `provider_request_ms`. The size test
now uses production-magnitude fractional timing (a one-minute request) and
asserts the rounded values and a 1,150-byte bound; the records measure 1,060
and 1,136 bytes. Without rounding the fractional digits add about 27 bytes,
over the bound. The main-session smoke-test summary record now measures 830
bytes (866 before).

### Empty-directory removal raced a starting writer (CodeRabbit)

Retention used to remove a `token-usage/` directory it found empty, without a
lock. `TokenUsageLogger._appendJsonl` runs `mkdir` once, marks the directory as
ensured and then only appends. A session between those two steps lost the
directory, and every later append failed with ENOENT. Retention no longer
removes the directory: an empty directory costs nothing, and the writer needs
no retry logic. The age-policy test now asserts that the emptied directory is
kept.

### `::` fixtures on Windows (CodeRabbit)

Windows cannot create file names containing `::`, which subagent token-usage
logs use (the production problem is #4104). Tests whose fixtures use `::`
names are skipped on win32 with `it.skipIf(process.platform === 'win32')`:
in `tokenUsageRetention.race.test.ts` the subagent late-lock test and the idle
subagent deletion test; in `tokenUsageRetention.test.ts` the active-session
test was split into a root-session test (current session, live-locked root,
idle root deleted), which still runs on Windows, and a subagent test that is
skipped there.

## Open questions

- The 800-byte summary target (above).
- Compression verification passes make a second LLM call whose usage no
  strategy reports. Reporting it would mean summing two calls' usage in
  middle-out and one-shot.
