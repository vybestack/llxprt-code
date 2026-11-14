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
  uses it; the runtime context carries `tokenUsageLogLevel`; `ChatSession`
  passes it to `createTokenUsageLogger`. `TokenUsageLogger` takes the level
  only (no boolean overload).
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
production-length ids (under 1,200 bytes).

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
  grammar cannot be lock-checked and are left alone. Before unlinking, the file
  is re-stat'ed and skipped if its identity or mtime changed since the scan.
- Empty `token-usage/` directories are removed (ENOTEMPTY from a concurrent
  first write is not a failure). I/O failures are counted into the sweep's
  `failed` total, like the other janitor phases.

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

## Open questions

- The 800-byte summary target (above).
- Compression verification passes make a second LLM call whose usage no
  strategy reports. Reporting it would mean summing two calls' usage in
  middle-out and one-shot.
