# Plan: Bound telemetry outfile growth and redact prompt content from exported API events

Plan ID: PLAN-20260824-TELEMETRYBOUND
Generated: 2026-08-24
Source issue: #3315
Total Phases: 7
Requirements: REQ-3315.1 through REQ-3315.7

## Acceptance criteria (from issue)

1. `api_request` and `api_response` export events carry sizes and counts
   (for example `request_chars`, token counts), not full bodies.
2. Full body capture, if retained at all, sits behind an explicit opt-in that
   defaults to off and truncates to a documented cap.
3. `logPrompts: false` keeps prompt and conversation content out of every
   exported event, including `request_text`.
4. The outfile rotates with a configurable size cap and retained-file count;
   defaults are documented.
5. Metric export does not re-serialize unbounded cumulative state every
   interval (delta temporality or bounded series).
6. The outfile tree stays bounded under interleaved writers: each session
   keeps the active file at cap + at most one in-flight record per writer
   (best-effort cap; the filesystem, not the process, arbitrates concurrent
   appends, so no stronger per-write bound is possible without a shared
   lock file, which telemetry cannot justify).
7. Behavioral test: enable telemetry with an outfile, run a conversation with
   large context and `logPrompts: false`, assert bounded file size and no
   verbatim prompt content in the file.

## Scope

In scope:
- `packages/telemetry/src/telemetry/loggers.ts` (gate `request_text` /
  `response_text`, add `request_chars` / `response_chars`)
- `packages/telemetry/src/telemetry/file-exporters.ts` (rotation + retention,
  DELTA temporality)
- `packages/telemetry/src/telemetry/sdk.ts` (pass rotation config to exporters)
- `packages/telemetry/src/internal/interfaces.ts` (TelemetryConfig getters)
- `packages/core/src/config/configTypes.ts`, `configConstructor.ts`,
  `configBaseCore.ts` (new settings + getters)
- `schemas/settings.schema.json` (new telemetry keys)
- `docs/telemetry.md`, `docs/telemetry-privacy.md`,
  `docs/cli/configuration.md` (documented defaults)
- Tests next to each changed unit, plus one behavioral end-to-end test

Out of scope:
- Changing the agent loop (`turnLogging.ts`) — the logger gates at export
  attribute construction; the in-process event shape stays intact for local
  aggregation (`/stats`) consumers.
- Hook I/O logging (`hook_call` events) — documented separately, unchanged.
- Conversation log (`logConversations`/`logResponses` +
  ConversationFileWriter) — separate opt-in layer, unchanged.
- Any OTLP/network exporter work.

## Design decisions

- Body emission policy: `request_text`/`response_text` are exported only when
  the new `telemetry.logApiBodies` opt-in is true AND
  `telemetry.logPrompts` is true. `logPrompts: false` wins unconditionally
  (privacy). When bodies are omitted, `request_chars`/`response_chars` carry
  the size instead. Truncation cap `telemetry.logApiBodyMaxChars` (default
  4000) applies whenever a body is emitted.
- Rotation: `FileExporter.writeToFile` stats the current file, rotates via
  atomic `rename` to `<outfile>.<rotation-token>` when the next record would
  exceed `telemetry.outfileMaxBytes`, then enforces retention of at most
  `telemetry.outfileMaxFiles` rotated files (oldest deleted first).
  Defaults: 100 MiB and 10 files. Rotation failures fail open (fall back to
  plain append) — filesystem is external; telemetry must never break the
  caller path. Single records larger than the cap are still written (JSONL
  records cannot be split); this overshoot is documented.
- Metrics: `FileMetricExporter.getPreferredAggregationTemporality()` returns
  DELTA so each 10s export carries only changes since the previous export.
  No bounded-series guard unless tests show delta alone is insufficient.
- Concurrency: atomic rename makes rotation safe across concurrent sessions;
  ENOENT races on rename/unlink are tolerated. Concurrent writers bound the
  active file at cap + at most one in-flight record per writer.

## Phase 0.5: Preflight verification

Dependencies, types, call paths, and test infrastructure verified against the
working tree on branch issue3315 (see issue comment plan; all confirmed):

- `AggregationTemporality` imported in `file-exporters.ts` — OK
- `node:fs` append/rename/stat available — OK
- Config accessors `getTelemetryOutfile`, `getTelemetryLogPromptsEnabled`
  exist in `configBaseCore.ts` — OK
- `ApiRequestEvent.request_text` / `ApiResponseEvent.response_text` optional — OK
- Test patterns exist: `file-exporters.test.ts`, `loggers.basic.test.ts`
  (core), `loggers.localAggregation.test.ts` — OK

## Phase 1: Redact prompt content from exported API events

Requirements: REQ-3315.1, REQ-3315.3

- `loggers.ts` `logApiRequest`: do not spread `request_text` into attributes;
  emit `request_chars` always; emit `request_text` only when body opt-in +
  `logPrompts` are both true (truncated to cap once Phase 2 lands).
- `buildApiResponseAttributes`: same treatment for `response_text` /
  `response_chars`.
- Local aggregation (`aggregateLocally`) is untouched (in-memory `/stats`).
- Tests: update `packages/core/src/telemetry/loggers.basic.test.ts`
  expectations; add gating tests (body omitted by default, omitted when
  `logPrompts: false` even with opt-in, `*_chars` present, token counts
  intact).

## Phase 2: Explicit opt-in for full body capture with truncation

Requirements: REQ-3315.2

- New settings: `telemetry.logApiBodies` (default false),
  `telemetry.logApiBodyMaxChars` (default 4000).
- Config getters for the four new settings live on `configBase.ts` (the
  `ConfigBase` layer) to keep `configBaseCore.ts` under the 800 effective-line
  lint cap; the older telemetry getters remain on `configBaseCore.ts`.
  `TelemetryConfig` extension + per-key `??` defaults in
  `resolveTelemetrySettings` (configConstructor.ts), which materializes
  defaults even for explicitly-passed `undefined` keys (the CLI builder
  emits every key).
- Truncation applied in `loggers.ts` when emitting bodies.
- Docs: `docs/telemetry.md`, `docs/cli/configuration.md`,
  `schemas/settings.schema.json`.

## Phase 3: Bounded outfile rotation with configurable cap and retention

Requirements: REQ-3315.4, REQ-3315.6

- New settings: `telemetry.outfileMaxBytes` (default 104857600 = 100 MiB),
  `telemetry.outfileMaxFiles` (default 10).
- `FileExporter` accepts rotation options; `writeToFile` performs
  stat→rename→append; retention deletes oldest rotated files beyond
  `outfileMaxFiles`; fail-open on rotation errors. Rotated files are named
  `<outfile>.llxprt-rot-<ms>-<6 base36 chars>` — an explicit namespace plus
  fixed-width token so the retention predicate (`^llxprt-rot-\d+-[0-9a-z]{6}$`)
  can never match a user file that merely shares the prefix (e.g.
  `telemetry.jsonl.backup` or `telemetry.jsonl.2026-notes`), and every name
  this module generates is guaranteed to match it. Span and log exporters
  write one record per `writeToFile` call (not a joined batch), so the
  active file overshoots the cap by at most one record even for multi-record
  export batches.
- `sdk.ts` passes config-derived options into all three file exporters.
- Tests: rotation after cap, retention convergence (oldest-first, mtime then
  name incl. the equal-mtime tie-break), cap + one-record overshoot
  semantics (single record and multi-record batches), interleaved writers
  sharing a file (best-effort bound), fail-open on a rotation error
  (read-only directory), retention foreign-file survival (including the
  `2026-notes`-shaped name that a naive `<digits>-<word>` predicate would
  delete), and rotation wiring for the metric and span exporters.

## Phase 4: Delta metric temporality

Requirements: REQ-3315.5

- `FileMetricExporter.selectAggregationTemporality(_instrumentType)` →
  DELTA. This is the method the OTel `MetricExporter` contract defines;
  `PeriodicExportingMetricReader` binds it per instrument. (A
  differently-named method leaves the reader silently on CUMULATIVE — the
  exact trap the first implementation fell into; a real
  MeterProvider→reader→exporter pipeline test guards it.)
- Test that repeated exports of a delta stream carry only interval changes:
  add(5) → flush → add(3) → flush must export 5 then 3, never 5 then 8.

## Phase 5: Cross-package boundary checks

Requirements: REQ-3315.6

- `runtimeAdapters.ts` continues to forward `requestText`/`responseText` on
  the in-process event (local aggregation contract) — export gating happens
  in the telemetry logger, which is the single choke point. Add a regression
  test asserting provider-owned events (telemetryEmitter) never set body
  fields and that the adapter path exports no body text with defaults.

## Phase 6: Behavioral end-to-end test

Requirements: REQ-3315.7

- New `packages/telemetry/src/telemetry/telemetryBoundary.behavior.test.ts`:
  initialize the real SDK with a temp outfile, `logPrompts: false`, default
  body opt-in off; emit many large `ApiRequestEvent`/`ApiResponseEvent`
  records with a distinctive verbatim prompt string; flush/shutdown; assert
  the outfile tree stays within cap + one record and contains no verbatim
  prompt string; assert `request_chars`/`response_chars` present.

## Phase 7: Documentation and verification sweep

- Document rotation defaults, body opt-in + cap, delta temporality in
  `docs/telemetry.md`; clarify `logPrompts: false` redaction of API bodies
  in `docs/telemetry-privacy.md`; settings reference in
  `docs/cli/configuration.md`; schema entries.
- Full verification cycle (test, lint, typecheck, format, build, smoke).
  Smoke note: the cycle-1 smoke (stepfun-37, haiku prompt) passed. A later
  re-run failed with a provider-side `400 you have no active step plan
  subscription` from stepfun before any code path beyond startup executed;
  the CLI booted, loaded the profile, built config, and reached the
  provider. No provider/auth code changed between the two runs, so this is
  an external account condition, not a regression.

## Policy invariance

- No new suppression directives, ESLint severity downgrades, complexity or
  size threshold increases, or `ignores:` blocks.

## Accepted residuals (review findings rated LOW, documented not fixed)

- The REQ-3315.7 boundary test drives the telemetry loggers directly with
  large sentinel bodies rather than running a full conversation through
  `turnLogging.ts`/`runtimeAdapters.ts`. The adapter path is verified by
  inspection (adapters preserve in-process bodies by design; gating is at
  the logger choke point) and stays unmodified, but no automated test pins
  the adapter→logger chain end to end.
- The interleaved-writers test exercises two exporter instances in one
  process, not true cross-process races (overlapping stat/rename/append).
  The rotation algorithm is designed for that (atomic rename, ENOENT
  tolerance) but a child-process race harness is out of scope here.
- OCR round 1, declined with rationale: (a) writeToFile performs one
  statSync per record while rotation is enabled; an in-memory size cache
  would drift from disk truth under the multi-writer scenarios this design
  supports, and telemetry export is batched rather than hot, so the syscall
  stays. (b) Exporter constructors throw RangeError on non-positive tuning;
  persisted settings are schema-bounded (minimum/multipleOf), sdk.ts catches
  constructor errors by disabling telemetry, and fail-fast on programmatic
  misuse is intentional. (c) Test-fixture duplication (makeConfig in two
  behavior-test files) follows the repo's per-file fixture convention.
