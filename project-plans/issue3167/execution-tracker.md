# Execution Tracker — Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167

> **Decisions D1–D8 applied** across AC/domain/pseudocode/phase artifacts this pass
> (source-verified blockers resolved; preflight corrected). P03 remains COMPLETE.

| Phase | ID | Status | Verified | Semantic? | Notes |
|---|---|---|---|---|---|
| 01 | P01 | DONE (planning) | yes | N/A | Preflight — seams verified; child-id AgentEvent claim FALSIFIED (D1); D1–D8 recorded |
| 02 | P02 | DONE (planning) | yes | N/A | Analysis + 9 pseudocode files + acceptance-criteria.md (D1–D8 applied) |
| 03 | P03 | DONE | yes | yes | IntervalUnion extracted (incremental O(1) durationMs) — UNAFFECTED by D1–D8 |
| 04 | P04 | COMPLETE | yes | yes | P04A+P04B: tightened schema boundaries + streaming reader API + PerfSink (serialized no-drop chain, exclusive 0600 day files, fail-open rate-limited diagnostics via fs port) + D5 benchmark — all 225 Bun behavioral tests green |
| 05 | P05 | COMPLETE | yes | yes | Stdout observer seam + Ink onRender wiring (observer fails fast — D8); 27 Bun behavioral tests green |
| 06 | P06 | COMPLETE | yes | yes | Operation lifecycle registry + identity (no child ids — D1; claims — D3); 38 Bun behavioral tests green. **Remediation:** D8 fail-fast finalisation (internal errors propagate, not swallowed); prep-rejection gaps (begin before prepareQueryForAgent/prepareTurnForQuery now finalise 'error' + preserve original rejection); queueWrite chain propagates internal rejections (fail-fast, no permanently non-rejecting shared chain). 41 Bun behavioral tests green |
| 07 | P07 | COMPLETE | yes | yes | Client phase measurement + record assembly (no capAndCount — D1). Default-off event dispatch (no timing when no observer), stale terminal cancellation evidence cleared on provider start. 26 contract + 32 behavior + 4 default-off tests green |
| 08 | P08 | COMPLETE | yes | yes | Retention (eventual bound, live-writer safe, claim files — D3/D5/D6); 44 Bun behavioral tests green; constants derived from D5 benchmark. **Remediation:** dispose() now propagates in-flight tick internal error after cleanup (try/finally); dual tick+cleanup internal errors aggregate via AggregateError; external errno remain fail-open. 47 Bun behavioral tests green |
| 09 | P09 | COMPLETE | yes | yes | Settings (opt-in, default-off, nested — D2); 64 Bun behavioral tests green; hierarchy fact-checked |
| 10 | P10 | COMPLETE | yes | yes | Memory trend (zero timers, ring, slopes); 31 Bun behavioral tests green |
| 11 | P11 | COMPLETE | yes | yes | Reader/consumer + report + /perf + inspect + delete (baseline — D7; join — D1); self-health (lastWriteErrorCode/evictionCount); injected live snapshot; shared artifact protection; 72 Bun behavioral tests green |
| 12 | P12 | COMPLETE | yes | yes | Integration wiring + overhead harness. Constructible InteractivePerfRuntime owner at CLI composition boundary; disabled returns null before any construction (AC-2 zero side effects). Owner owns PerfRetention+PerfSink+OperationLifecycleRegistry+optional MemoryTelemetryController+observers+snapshot capability. Startup installs observers BEFORE inkRenderOptions(). Ordered disposal with AggregateError. Threading through interactiveUI→AppWrapper→AppContainer→useAppInput→useAgentStream→useSubmitQuery (operationLifecycle) and useAppBootstrap→useMemoryMonitor (memoryController). Schema geometry corrected (terminal_cols/rows nonNegInt — unknown is zero). MemoryTelemetryController serialized write chain + drain(). useMemoryMonitor disabled path uses rss() not full memoryUsage(). OperationLifecycleRegistry getActiveOperationSnapshot(). BuiltinCommandLoader factory wiring (createPerfCommand with owned snapshot capability). Overhead harness prints p50/p95/p99/deltas (evidence, no wall-clock gate). **P12 Remediation:** PerfSink.dispose always runs writeChain drain + retention cleanup (try/catch per step, AggregateError); pre-start replacement via replacePreviousInstanceAndOwner() before buildAndStartPerfOwner (no observer conflict); shared production helper session/interactiveUiLifecycle.ts (cleanupInstanceAndOwner + rollbackInteractiveFailure) called by interactiveUI.tsx for pre-start replacement, registered global cleanup, AND post-render/setup-failure rollback — every cleanup step (clear/unmount/dispose; on rollback also owner.dispose, raw disableMouseEvents, mouse+restore listener removal, restoreTerminalProtocolsSync) runs independently even if a prior step throws, single Error or AggregateError, primary failure preserved first, no swallowing catches; render rollback now UNCONDITIONAL + non-swallowing (raw disableMouseEvents instead of swallowing mouseEventsExitHandler); setup-failure transactional catch added so a rendered instance/owner cannot leak if setupInstanceLifecycle/registerCleanup throws; startup rollback timer cleanup proven via counting scheduler (PerfScheduler seam); createIdentityProviderFromGetters takes immutable + mutable args (getter-based dynamic identity); buildAndStartPerfOwner typed to real TelemetrySettings (not unknown); disabled path test proves only getTelemetrySettings called; dynamic identity persistence test (provider/model/geometry mutate between operations); IS_REACT_ACT_ENVIRONMENT=true in all React test files (no act warnings); overhead harness uses REAL createInteractivePerfRuntime owner with owner.start() (genuine stdout/render/phase observer installation + claim + maintenance timer), deterministic disposal ordering (owner disposed BEFORE disabled workload; observers null, claim removed, timer clearCount >= 1 via CountingScheduler), disabled workload asserted via REAL on-disk artifact diff (no new JSONL/artifacts) not an empty local array, no operationLifecycle/observers in disabled, renderHook harnesses unmounted under act, accepted render mode (incremental) + `${process.platform}-${process.arch}` fixture, same deterministic fixture async stream + useSubmitQuery workload, prints p50/p95/p99/delta, no timing threshold; behavior tests call ACTUAL production helpers (replacePreviousInstanceAndOwner via tracked-state test seam __setTrackedInstanceAndOwnerForTesting, cleanupInstanceAndOwner, rollbackInteractiveFailure) — no mirrored/mock-theater code; slash runtime + BuiltinCommandLoader snapshot confirmed. 592 tests green across 34 files; CLI/telemetry/core typechecks clean; ESLint+Prettier clean; git diff --check clean. **P12 Focused Correctness Pass:** extracted shared session/interactiveUiLifecycle.ts helper; render rollback made unconditional/non-swallowing; setup-failure transactional leak fixed; behavior tests rewritten to exercise actual production helpers (no mirror/mock-theater); overhead harness rewritten to use real owner+owner.start with genuine observer install/dispose + real on-disk artifact diff; lifecycle (8) + overhead (1) + startInteractiveUI (9) tests green with clean stderr; CLI+telemetry typechecks clean; touched-file ESLint+Prettier clean; git diff --check clean. |
| 13 | P13 | COMPLETE | yes | yes | Definitive final-tree suite green (including 368/368 core, 561/561 providers, 365/365 agents, and 706/706 CLI files); final lint, typecheck before/after build, format, build, StepFun smoke, mechanical/scope guards, and real tmux `/perf`/`/perf inspect`/`/perf report` validation all green; evidence refreshed in `.completed/P13.md` |

## Recommended next implementation phase
**P04 — Schema + PerfSink + tolerant reader + record-size benchmark.** P03
(IntervalUnion) is COMPLETE. P04 lands the writer/reader contract and **first**
adds the Bun record-size benchmark (D5) whose output P08 uses to derive retention
constants. P04 depends on P03 only; P05/P09 may follow in parallel once the schema
lands, then the registry (P06) is the integration spine.

## P04 progress — schema + derivation + reader + join + PerfSink + benchmark (COMPLETE)

**Scope delivered (P04A only):**
- Single Zod schema source in `packages/telemetry/src/perf/perfRecords.ts`;
  writer/reader/types all derive from it. `PERF_SCHEMA_VERSION=1`.
- `operation` + `memory_sample` discriminated record types; all operation
  fields, identity/build/comparison fields, optional memory fields, and the
  seven terminal statuses (incl. `superseded`). NO `prompt_ids`/`turn_ids`/
  true-count/cap fields (D1); NO `contended`, `records_dropped`, gzip, or size
  rolling. Empty identity strings rejected at the schema boundary.
- `deriveOperationId`/`joinKeyFromPromptId` remove ONLY the exact terminal
  `#continuation#<positive integer>` marker; an initial id is byte-identical.
- Tolerant streaming reader (`readPerfRecords`): streams without reading whole
  files, tolerates malformed/truncated final lines with explicit counters
  (parsed/malformed/futureVersion/unversioned/truncated/blank), ignores unknown
  fields, skips+counts future versions without coercion, never throws on
  malformed external JSONL, distinguishes malformed complete lines from a
  truncated final line, counts unversioned records rather than fake-normalizing.
- Read-time join helper proven by behavioral tests: N continuation rows join to
  one perf operation without copying child ids into the perf record (D1).
- Bun/bun:test behavioral tests only (real temp JSONL files; no mocks).
- Exported via `packages/telemetry/src/perf/index.ts` → package index +
  `package.json` deep-import exports.

**Deferred to P04B (NOW COMPLETE):** PerfSink (serialized no-drop promise chain,
D4), exclusive-create day files, fail-open + rate-limited diagnostics (D6/D8),
roundtrip/exclusive/failopen sink tests — all delivered in P04B.

**P04B deliverables:**
- `PerfSink` in `packages/telemetry/src/perf/PerfSink.ts`: constructible,
  non-singleton, does NOT inherit FileOutput. Serialized no-drop promise chain.
  One exclusive-created 0600 file per run UUID per UTC record day
  (`perf-YYYYMMDD-<runUuid>.jsonl`). Day from each record's `ts`; rolls on next
  serialized record. Empty sink creates no file. Drain on dispose. No gzip, size
  sub-roll, bounded queue, drop counter, retry threshold, or extra timer.
- Schema/programming/serialization errors fail fast (synchronous throw before
  queueing). Only filesystem create/append/close errors fail-open (rate-limited).
  Narrow package-private `PerfSinkFilesystem` port for deterministic
  EACCES/EROFS/ENOSPC fault injection; default uses real `node:fs/promises`.
- Safe state transitions: failed exclusive open does not advance day/file state.
  Concurrent `write()` calls preserve enqueue order and produce untorn JSONL
  lines. A filesystem failure in one write does not poison later writes. Dispose
  blocks further writes deterministically and drains all accepted writes.
- `FaultInjectingPerfFilesystem` exported for fault-injection tests (D6).

**P04A corrections (delivered this pass):**
- A. Schema tightened to encode value boundaries: ISO 8601 `ts`; all durations
  except `unclassified_elapsed_ms` finite + non-negative; `unclassified_elapsed_ms`
  finite (may be negative); counts/tokens/index and terminal geometry are
  non-negative integers (unknown geometry is zero); `concurrent_instances` is
  an integer ≥ 1; bytes/memory/uptime/sample ages are finite + non-negative.
  Unknown-field tolerance preserved. Boundary tests are in
  `perfSchema.boundary.behavior.test.ts`.
- B. Genuinely streaming public reader API (`streamPerfRecords`): async generator
  yielding `PerfStreamEntry` outcomes incrementally without accumulating the
  file. Its `streamPerfFromReadable` test seam is package-private in the
  non-exported `perfRecordsStream.ts` module. `readPerfRecords` delegates to the
  streaming API as a bounded convenience collector. Large-file streaming and
  incremental-yield evidence is in `perfReader.streaming.behavior.test.ts`.

**D5 benchmark observed bytes** (`perfRecordSize.bench.ts`, actual v1 schema):
- `operation` record (WITH memory columns): **1220 bytes/line**
- `memory_sample` record: **242 bytes/line**
- combined per-operation pair: **1462 bytes**
- P08 derives retention constants (max-bytes/max-files/maintenance-interval/
  diagnostic-rate-limit) from these figures.

## P05 progress — stdout observer seam + Ink onRender wiring (COMPLETE)

**Scope delivered:**
- `packages/core/src/utils/stdio.ts`: `StdoutWriteObserver` interface +
  optional `observer` param on `createInkStdio`. No observer ⇒ the Proxy
  returns `writeToStdout` directly (same function identity/behaviour as today).
  With an observer, a single `createObservedStdoutWrite` wrapper counts encoded
  bytes (`Uint8Array.byteLength` / `Buffer.byteLength` with the supplied
  encoding) and measures only the synchronous `writeToStdout` invocation
  duration. Observer is called directly after the write returns — **no
  try/catch** (D8: internal/programming errors fail fast). If the underlying
  write throws synchronously, no observer sample is produced. Stderr remains
  unobserved. No CLI import in core.
- `packages/cli/src/ui/inkRenderOptions.ts`: replaced the eager module-scope
  `createInkStdio()` with a lazy cached interactive stdio seam
  (`getInteractiveStdio` / `setInteractiveStdoutObserver`). Setting a different
  observer invalidates the cache; the same value reuses the cached instance.
  Zed's direct `createInkStdio()` call remains observer-free and uncounted. No
  global `process.stdout` monkey patch.
- Ink `onRender` wiring (verified against installed
  `@jrichman/ink@6.4.8`): `RenderOptions.onRender` is
  `(metrics: { renderTime: number }) => void` — Ink **does** provide a real
  render duration (`renderTime`, computed as `performance.now()` delta around
  the render computation). The pseudocode's `renderDurationMs` field name is
  corrected to `renderTime`. `InteractiveRenderObserver` + setter wired
  conditionally (default-off: no observer ⇒ no onRender field in the returned
  RenderOptions). Render passes stay distinct from stdout writes.
- Default-off: no observer setter call means no stdout/render observer
  installed and no counter allocation. P09 owns persisted settings; no settings
  wired yet.

**Ink API correction (verified this pass):** the installed Ink package provides
`RenderMetrics = { renderTime: number }` (not `renderDurationMs`). The onRender
callback fires once per render pass (throttled by Ink's maxFps) with a real
duration. This is recorded in pseudocode `05-client-phases.md` line 22 and the
P05 phase file. Pseudocode `03-stdout-observer.md` is otherwise accurate (the
stdout seam signatures match the installed code).

**Bun/bun:test behavioral evidence** (27 tests, 2 NEW files — no Vitest/Node
suites modified):
- `packages/core/src/utils/stdio.observer.behavior.test.ts` (16 tests):
  multibyte UTF-8 byte counting with encoding, Uint8Array byteLength, write-call
  count, finite/nonnegative duration, true/false backpressure passthrough
  through the package-private `createObservedStdoutWrite` seam, both write
  overloads, observer throw propagates (D8), underlying write throw ⇒ no sample,
  absent observer identity unchanged, stderr uncounted, Zed path
  characterization.
- `packages/cli/src/ui/inkRenderOptions.observer.behavior.test.ts` (11 tests):
  lazy cache reuse, different-observer invalidation, same-observer reuse,
  null-when-null no-op, default-off identity, onRender default-off, onRender
  renderTime forwarding, onRender clear, render passes distinct from write
  calls, existing options preserved.

Artifacts outside `project-plans/issue3167/`: `packages/core/src/utils/stdio.ts`,
`packages/cli/src/ui/inkRenderOptions.ts`, and the two new test files. `.llxprt`
untouched. Authoritative design records NOT rewritten.

## Pseudocode → phase map (line ranges)
| Pseudocode | Lines | Phase |
|---|---|---|
| 01-schema-and-reader | 10-66 (schema+derivation) | P04, P06 |
| 01-schema-and-reader | 67-102 (reader) + 104-115 (read-time join, D1) | P04, P11 |
| 02-perfsink-and-interval-union | 10-35 (IntervalUnion) | P03 |
| 02-perfsink-and-interval-union | 50-108 (PerfSink, D4) | P04 |
| 03-stdout-observer | 10-58 | P05 |
| 04-operation-lifecycle | 10-66 (D1: no child ids; D3: claims at finalise) | P06 |
| 05-client-phases | 10-74 (D1: no capAndCount) | P07 |
| 06-retention | 10-72 (D3 claim files; D5 overshoot) | P08 |
| 07-memory-trend | 10-93 | P10 |
| 08-consumer-and-perf-command | 10-24 (settings, D2) | P09 |
| 08-consumer-and-perf-command | 30-99 (reader/perf, D1 join + D7 baseline) | P11 |
| 09-overhead-harness | 10-64 | P12 |

## Implementation status (this task)
P04 implementation COMPLETE (schema + derivation + tolerant reader + streaming
reader API + read-time join + PerfSink + D5 benchmark). Production code and Bun
behavioral tests land in `packages/telemetry/src/perf/`. 225 tests across 7
files green. Artifacts outside `project-plans/issue3167/` are limited to the
`packages/telemetry/src/perf/` module, its package index/exports, and this
tracker. `.llxprt` untouched. Authoritative design records (`specification.md`,
`PLAN.md`, `decision.html`, `design.html`) NOT rewritten. P06–P13 remain TODO.

**This pass (D1–D8 decision task):** source fact-checking found blockers in the
original artifacts and **falsified** the claim that child continuation ids arrive
in the CLI via `AgentEvent`. The resolved implementation contract is recorded as
decisions D1–D8 across `acceptance-criteria.md`, `analysis/domain-model.md`, the
nine pseudocode files, the thirteen phase files, and this tracker, while
preserving P03 as COMPLETE. Where a resolved decision diverges from a
`specification.md` detail (notably D1 — child-id arrays removed, and D2 — nested
`telemetry.perf.enabled`/`.memory` rather than a boolean `telemetry.perf`), the
divergence is recorded in the companion artifacts, not by editing the
authoritative spec. Contradictions between PLAN.md REQ text and spec §9 remain
resolved in favour of spec §9.

## P09 progress — settings (opt-in, default-off, nested — D2) (COMPLETE)

**Scope delivered:**
- `packages/core/src/config/configTypes.ts`: added `PerfTelemetrySettings`
  interface (`{ enabled?: boolean; memory?: boolean }`); added `perf?:
  PerfTelemetrySettings` to `TelemetrySettings`.
- `packages/core/src/config/configConstructor.ts`: exported
  `resolveTelemetrySettings` (was private); added `resolvePerfSettings(settings):
  { enabled: boolean; memory: boolean }` with master-gates-memory and
default-false semantics; `resolveTelemetrySettings` defensively clones perf
(`withClonedPerf`) on every ingress and egress so `Config.getTelemetrySettings()`
shallow copy
  cannot leak nested mutable state.
- `packages/core/src/index.ts`: exports `resolvePerfSettings` +
  `PerfTelemetrySettings` type for downstream phases (P06/P10/P12).
- `packages/core/src/config/config.ts`: **unchanged** (0 lines — the cloned perf
  in the stored `telemetrySettings` prevents mutation through the shallow copy
  returned by `getTelemetrySettings()`).
- `packages/cli/src/config/configBuilder.ts`: `buildTelemetryConfig` passes
  `perf: telemetrySettings?.perf` through to Config.
- `packages/cli/src/config/settingsSchema.ts`: `TelemetrySettings` $def gains
  `perf` property (type: object, additionalProperties: false, properties:
  enabled/memory booleans with descriptions).
- `schemas/settings.schema.json`: regenerated `TelemetrySettings` $def with perf.
- `docs/telemetry-privacy.md`: added "Client Performance Telemetry" section
  (default-off, local-only, master-gates-memory, settings JSON example).

**Hierarchy fact-check (corrected):** the original plan's "CLI flag > env >
workspace > user > default" claim conflates persisted settings merge with
CLI/env mapping. Source fact-checking found:
- Persisted settings merge (`mergeSettings()`): shallow spread at the telemetry
  level via `mergeObjectSection` — a higher-precedence layer's `perf` REPLACES
  the lower-precedence `perf` entirely (not a deep merge of `perf.enabled` /
  `perf.memory` across layers). Precedence: schema defaults < system defaults <
  user < workspace (trusted) < system.
- CLI/env: yargs exposes ONLY flat flags (`--telemetry`,
  `--telemetry-log-prompts`, `--telemetry-outfile`). There are **no CLI flags
  or env vars for `telemetry.perf.*`** and none were added (the issue spec does
  not require them). Perf is configured only via persisted settings files.
- `resolveTelemetrySettings` (core) does NOT implement a settings-layer
  hierarchy — it applies per-field defaults and defensively clones perf
(`withClonedPerf`) on ingress and egress.

**Bun/bun:test behavioral evidence** (44 tests, 4 NEW files — no Vitest/Node
suites modified):
- `packages/core/src/config/perfSettings.behavior.test.ts` (16 tests):
  default-off, enabled-only, memory-gated-off, both-on, false-overrides, input
  immutability (3), nested-return copy isolation (2), return type safety.
- `packages/core/src/config/telemetrySettingsCopy.behavior.test.ts` (6 tests):
  perf is a copy not caller reference, resolved perf is a mutable isolated copy
  (isolation by cloning, not freezing), input mutation isolation, caller not
  mutated, undefined perf, field preservation.
- `packages/cli/src/config/perfSettingsMerge.behavior.test.ts` (8 tests): real
  `mergeSettings` behavior — absent/user-only/workspace-replaces-user/
  both-set-wins/telemetry-scalar-coexist/untrusted-ignored/system-wins/
  system-defaults-overridden.
- `packages/cli/src/config/perfSettingsValidation.behavior.test.ts` (14 tests):
  real Zod validation — 6 accepted shapes (object with enabled/memory, only
  enabled, only memory, empty, both false, no perf), 8 rejected shapes (boolean
  true/false, non-boolean enabled/memory, unknown properties, string/number/
  array).

**Existing relevant tests verified unmodified:** `settings-validation.test.ts`
(69 tests) and `settingsSchema.previewFeatures.test.ts` (1 test) pass under Bun.

Artifacts outside `project-plans/issue3167/`: `packages/core/src/config/
configTypes.ts`, `configConstructor.ts`, `src/index.ts`; `packages/cli/src/
config/configBuilder.ts`, `settingsSchema.ts`; `schemas/settings.schema.json`;
`docs/telemetry-privacy.md`; 4 new test files. `config.ts` **unchanged**.
`.llxprt` untouched. Authoritative design records NOT rewritten.

## P08 progress — retention + claim lifecycle (eventual bound, live-writer safe — D3/D5/D6) (COMPLETE)

**Scope delivered:**
- `packages/telemetry/src/perf/retention.ts`: constructible `PerfRetention` owner
  (non-singleton). Owns exactly one coarse maintenance interval that touches
  this run's UUID claim file AND performs oldest-first retention. Timer is
  `unref`'d so it does not hold the CLI process open. No drift timer, no memory
  timer.
- **Constants (D5)** derived from the P04 benchmark (1220-byte operation,
  242-byte memory_sample, 1462-byte combined pair):
  - `PERF_MAX_BYTES = 64 MiB` (67,108,864) — ~45,902 operation pairs at 1462
    bytes/pair.
  - `PERF_MAX_FILES = 128` — one file per writer per UTC day = 128 days at
    single-writer volume. Claim files (0 bytes) count toward file count.
  - `PERF_MAINTENANCE_INTERVAL_MS = 60,000` (60 s) — the owned coarse interval
    and the live-writer protection window.
  - `PERF_CLAIM_LEASE_MS = 180,000` (3 × interval) — a crashed run's claim
    becomes stale within 3 minutes (bounded crash overshoot — D3).
  - `PERF_DIAG_RATE_LIMIT_MS = 60,000` (60 s) — at most one diagnostic per
    window for retention filesystem errors.
  - **Cap binding at representative single-writer volume:** crossover is
    MAX_BYTES / MAX_FILES = 524,288 bytes/file ≈ 359 operation pairs/day (memory
    on). Below ~359 pairs/day, the **file cap binds** (128 days of data). Above
    ~359 pairs/day, the **byte cap binds** (64 MiB reached before 128 days). At
    typical interactive use (~50–200 ops/day), the file cap is the binding
    constraint.
- **Claim lifecycle (D3):** claim created exclusively (`wx`, 0600) at `start()`;
  touched every interval by `tick()`; removed on clean `dispose()`. A crash (no
  dispose) leaves a stale claim until the next sweep. `countNonStaleClaims(now)`
  for P06 derives `concurrent_instances` from non-stale claims (lease-window
  semantics with bounded crash overshoot).
- **Retention (AC-7):** scans only owned artifacts (`perf-YYYYMMDD-*.jsonl` +
  `*.claim`). Claims counted toward count/bytes but never JSONL-parsed. Evicts
  oldest-first until BOTH caps satisfied. Protects a perf file only if its
  filename day is today UTC AND mtime within maintenance interval. Protects every
  non-stale claim. Stale claims eligible. Future mtimes remain protected until
  eligibility. Decrement accounting ONLY on successful unlink. Stable
  deterministic tie-break by name. Re-scan on later interval gives eventual
  convergence.
- **Error policy (D8):** internal/programming errors fail fast. Only genuine
  filesystem persistence/maintenance errors (create/touch/stat/readdir/unlink)
  fail open and are rate-limited.
- **Filesystem port (D6):** narrow package-private `PerfRetentionFilesystem`
  port + `FaultInjectingRetentionFilesystem` for deterministic
  EACCES/EROFS/ENOSPC fault injection — never real-disk fill or chmod.
  `PerfScheduler` / `PerfTimerHandle` package-private scheduler seam for
  deterministic interval firing in tests.
- **PerfSink wiring:** optional `retention?: PerfRetention` on `PerfSinkOptions`;
  `PerfSink.start()` starts the retention; roll boundary triggers
  `maybeMaintain`; `dispose()` drains writes, then stops maintenance and removes
  the claim. Backward-compatible: PerfSink without retention works without
  `start()`. `FileOutput` unchanged.
- **Barrel cleanup:** removed `FaultInjectingPerfFilesystem` from the public
  perf barrel (tests deep-import it from `PerfSink.js`); added retention
  constants + `PerfRetention` / `PerfRetentionOptions` to the barrel. Kept
  package-private fault/scheduler types out of the public barrel.
- **P05 comment correction:** fixed the inaccurate comment in
  `packages/cli/src/ui/inkRenderOptions.ts` that claimed the render observer
  "reads the current observer at invocation time" — it actually captures a local
  closure at options-construction time, so a later clear does NOT take effect
  without rebuilding the options object.

**Bun/bun:test behavioral evidence** (44 tests across 3 NEW files — no Vitest/Node
suites modified):
- `retention.behavior.test.ts` (33 tests): constants (D5), claim lifecycle
  (create/touch/dispose/crash-stale), countNonStaleClaims, live-writer safety,
  claim handling (stale/fresh/future), oldest-first cap convergence + tie-break,
  failed-unlink accounting intact + rate-limited diagnostics (D6), one coarse
  interval touches claim + sweeps without restart, maybeMaintain rate-limiting,
  future-mtime protection, claims never parsed as JSONL.
- `retention.capSelection.behavior.test.ts` (2 tests): file cap binds at
  representative volume; byte cap binds at high volume.
- `perfSink.retention.behavior.test.ts` (9 tests): start creates only claim,
  start-then-write, roll-boundary maintenance, disposal drains + stops +
  removes claim, backward compatibility without retention, concurrent overshoot
  convergence, countNonStaleClaims.

All 269 perf tests green (225 P04/P05 + 44 P08). Typecheck, ESLint, Prettier
clean. Benchmark confirms constants. `git diff --check` clean.

Artifacts outside `project-plans/issue3167/`: `packages/telemetry/src/perf/
retention.ts` (new), `PerfSink.ts` (modified), `index.ts` (modified), 3 new test
files; `packages/cli/src/ui/inkRenderOptions.ts` (comment-only fix). `.llxprt`
untouched. Authoritative design records NOT rewritten.

## P06 progress — operation lifecycle registry + identity (D1 no child ids, D3 claims) (COMPLETE)

**Scope delivered:**
- `packages/cli/src/ui/hooks/agentStream/operationLifecycle.ts`:
  `OperationLifecycleRegistry` — constructible CLI-owned registry keyed by
  AbortSignal (not a global singleton). Disabled mode is the runtime not
  constructing it (AC-2).
- `begin(signal, promptId)`: derives `operation_id` via `deriveOperationId`
  (`promptId.split('#continuation#')[0]` — D1 binding correction), snapshots
  immutable identity/build/dimensions through a narrow `OperationIdentityProvider`,
  initializes monotonic per-session index, and creates a mutable per-operation
  measurement state for P07. Returns a typed `OperationHandle`. No
  prompt_ids/turn_ids collected (D1). A superseded sweep finalises every prior
  still-active signal as `superseded` exactly once before admitting the new op.
- `finalise(signal, status)`: exactly-once async finalise. Atomically claims/
  removes the pending op (mark `finalised` WeakSet + delete from active map)
  before awaiting external work. Derives `concurrent_instances` from
  `PerfRetention.countNonStaleClaims(now)` (D3 lease semantics), clamped to a
  schema-valid minimum 1 if filesystem fail-open yields zero. Builds one
  schema-valid v1 operation record and writes through PerfSink. Duplicate/late
  finalise no-ops. All seven statuses including `superseded`.
- `drain()`: awaits the serialized lifecycle chain so the runtime/tests can
  deterministically flush pending writes before sink dispose.
- Identity: `OperationIdentitySnapshot` contract for session/runtime/project/
  build/provider/model/terminal/render fields. P12 supplies the provider;
  tests use a fixture. No new CLI flags/env vars. Tokens begin at zero and
  update through the typed P07 measurement handle. Timestamp uses wall-clock
  ISO; elapsed/uptime uses monotonic clock. Memory columns omitted in P06.
- Record assembly: honest residual (`unclassified_elapsed_ms = elapsed −
  directly-measured phases`) with zero/default P06 measurements equals elapsed.
  Provider/tool sums and unions report zero. No P07 phase math.

**Integration into real useSubmitQuery turn path:**
- `useSubmitQuery.ts`: optional `operationLifecycle?: OperationLifecycleRegistry`
  dep (supplied by P12). `begin` after prompt ID resolution (after `initTurn`)
  and before `prepareQueryForAgent`/send. `finalise` on normal completion
  (`completed`), error (`error`), and pre-send-abort (`cancelled_before_send`)
  paths. Fire-and-forget with error surfacing via `debugLogger.error` (AC-8:
  no throw escapes to the operation path). The superseded sweep is triggered by
  the new turn's `begin` — the stale turn's guarded `finally` (isCurrentTurn
  false) never runs but cannot lose its record. Each consumed turn has its own
  operation. No user-visible behavior change.

**Bun/bun:test behavioral evidence** (38 tests across 2 NEW files — no Vitest/Node
suites modified):
- `operationLifecycle.behavior.test.ts` (32 tests): D1 split rule (5 — initial,
  continuation #1/#2, non-terminal marker, CLI-fallback), no child arrays,
  seven terminal statuses (7), duplicate finalise (3), superseded sweep (3),
  concurrent_instances/D3 claims (3), session index monotonic, measurement
  handle, record assembly (5 — identity/residual/subtracted-phases/wall-vs-
  monotonic/memory-omitted), error policy (2 — schema fail-fast, filesystem
  fail-open), each turn distinct operation.
- `useSubmitQuery.lifecycle.test.tsx` (6 tests): completed, error, pre-send-
  abort, superseded (real useSubmitQuery control flow with deferred runStream +
  terminal event displacement + new turn begin sweep), exactly-once, disabled
  (no records when operationLifecycle absent).

All 290 telemetry perf tests, 46 lifecycle+useSubmitQuery CLI tests, CLI/
telemetry/core typechecks, ESLint, Prettier clean. `git diff --check` clean.
`git diff packages/agents` empty.

Artifacts outside `project-plans/issue3167/`: `packages/cli/src/ui/hooks/
agentStream/operationLifecycle.ts` (new), `operationLifecycle.behavior.test.ts`
(new), `__tests__/useSubmitQuery.lifecycle.test.tsx` (new), `useSubmitQuery.ts`
(modified — optional lifecycle dep + begin/finalise wiring). `.llxprt`
untouched. Authoritative design records NOT rewritten. P07 phase classification
deferred; P10 memory deferred; P12 runtime construction deferred.

## P06/P08/D8 Remediation — focused fail-fast correction pass

**Scope:** Corrected lifecycle defects in P08 dispose, P06 preparation gaps, D8
finalisation, and queueWrite chain semantics. Strict Bun TDD (RED → GREEN);
no broadening into P07 provider/tool phase integration.

**Corrections delivered:**

1. **P08 disposal (retention.ts):** `PerfRetention.dispose()` now captures the
   in-flight tick's internal (non-errno) error, ALWAYS proceeds with claim
   cleanup (try/finally pattern), then rethrows the tick error. If claim cleanup
   also fails internally, both errors are surfaced via `AggregateError` (project
   convention). External errno failures from tick or cleanup remain fail-open /
   rate-limited via `emitDiagnostic`. (3 new tests in
   `retention.lifecycle.behavior.test.ts` D-LC-4 block.)

2. **P06 preparation gaps (useSubmitQuery.ts):** `OperationLifecycleRegistry.begin()`
   happens before `prepareQueryForAgent()` and `prepareTurnForQuery()`. Their
   rejections now finalise the op exactly once as `'error'` via
   `finalisePrepRejection` (which preserves the original rejection to the caller;
   if finalise also fails internally, an `AggregateError` carries both). (2 new
   tests in `useSubmitQuery.lifecycle.test.tsx`.)

3. **Item 3 classification:** Verified every `!shouldProceed || queryToSend === null`
   producer by reading `prepareQueryForAgent` (queryPreparer.ts) source. All
   producers are non-send paths: abort signal, empty query, slash/shell command
   consumed, @-command error. `cancelled_before_send` is the only semantically
   grounded existing status for "started but did not send to the model" (AC-4).
   No non-cancellation path reaches this branch with a more-specific status
   available. `prepareTurnForQuery` returns void and is called AFTER the check.
   No change needed; classification confirmed accurate.

4. **D8 finalisation (useSubmitQuery.ts):** Replaced fire-and-forget
   `finaliseOperation` (which `.catch(debugLogger.error)`-swallowed every
   rejection) with a version that returns the promise for awaiting. All three
   finalisation paths (completed / error / cancelled_before_send) are now
   awaited in `runSubmitQueryCore`. Internal instrumentation errors propagate
   fail-fast; external errno errors resolve in PerfSink/retention (fail-open).
   The error path handles the original provider error for the user FIRST via
   `handleProviderError`, then throws the instrumentation error — the
   instrumentation error is NOT routed through user-facing provider-error
   handling and does NOT replace the original operation status. (2 new tests in
   `useSubmitQuery.lifecycle.test.tsx`.)

5. **queueWrite / drain (operationLifecycle.ts):** `queueWrite` now chains via
   `this.lifecycleChain.then(attempt)` (no recovery handler), so the shared
   chain propagates internal rejections. An internal rejection from a write
   whose individual promise was not awaited (notably the superseded sweep from
   `begin`) is surfaced via `drain()` rather than hidden by a permanently
   non-rejecting chain. Serialization is preserved (writes still happen in
   order via the chain). External fs errors resolve in the sink. (3 new tests
   in `operationLifecycle.behavior.test.ts` P06-D8 block.)

6. **P07 granular statuses:** `cancelled_during_api/tool/approval` deferred to
   P07 as planned. No existing statuses regressed. No `packages/agents` changes.

**Verification (all GREEN):**
- P06 tests: `operationLifecycle.behavior.test.ts` (35 tests) +
  `useSubmitQuery.lifecycle.test.tsx` (10 tests) = 45 tests.
- Affected existing useSubmitQuery tests: `activationFailure.test.tsx` (3) +
  `mcpDiscovery.test.tsx` (5) = 8 tests.
- All telemetry perf tests: 293 tests.
- Telemetry + CLI typechecks (`tsc --noEmit`): clean.
- ESLint + Prettier on all 6 touched files: clean.
- `git diff --check`: clean. `packages/agents` / `.llxprt` diffs: empty.
- No settings files changed.

**Files changed (this remediation):**
- `packages/telemetry/src/perf/retention.ts` — dispose() fail-fast fix.
- `packages/telemetry/src/perf/retention.lifecycle.behavior.test.ts` — 3 new
  D-LC-4 tests.
- `packages/cli/src/ui/hooks/agentStream/operationLifecycle.ts` — queueWrite
  chain fail-fast fix.
- `packages/cli/src/ui/hooks/agentStream/operationLifecycle.behavior.test.ts` —
  3 new P06-D8 tests + InternalErrorFilesystem.
- `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` — finaliseOperation
  returns promise; runSubmitQueryCore restructured; helpers extracted
  (finalisePrepRejection, handleProviderError, finaliseStreamError).
- `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.lifecycle.test.tsx`
  — 4 new tests (prep rejection, turn prep rejection, D8 completed, D8 error).

**P07-deferred risk:** granular `cancelled_during_api/tool/approval` status
classification is deferred to P07 as planned. The registry supports all seven
statuses (AC-4); the useSubmitQuery wiring currently only emits
`completed`, `error`, `cancelled_before_send`, and `superseded`. P07 will add
the during-api/tool/approval status transitions based on real phase boundaries.

## P07 progress — client phase measurement + stale-evidence/default-off corrections (COMPLETE)

**Scope delivered (this final correction pass):**

1. **Default-off event dispatch (`useAgentEventStream.ts`):** the event loop
   previously called `performance.now()` before/after EVERY AgentEvent even when
   `onAgentEventObserved` was undefined (perf disabled). Refactored so the
   absent-observer branch performs the existing handler dispatch/catch behavior
   with NO timing calls and NO sample allocation; the present-observer branch
   measures synchronous dispatch and invokes the observer OUTSIDE the generic
   catch (D8: a perf-callback throw rejects the stream / fail-fast). A
   package-private monotonic-clock seam (`__setMonotonicClockForTesting`,
   deep-imported — NOT in the agentStream barrel) lets tests prove zero timing
   work on the default-off path.

2. **Stale terminal cancellation evidence (`operationLifecycle.ts`):** after a
   tool-status `cancelled` terminal, a new provider attempt start for the same
   operation proves the operation continued. `onProviderAttemptStart` now clears
   retained tool/approval cancellation evidence so a later independent API abort
   classifies `cancelled_during_api`. Provider-aborted (api) terminal evidence
   is PRESERVED (overlap precedence + provider-aborted honesty); current active
   tool/approval state is NOT cleared. `retainCancellationEvidence` precedence
   (approval > tool > api) is untouched.

3. **`P07` no longer deferred:** granular `cancelled_during_api/tool/approval`
   transitions on real phase boundaries are now wired through the registry's
   live phase tracking (AC-4).

**Bun/bun:test behavioral evidence:**
- `operationLifecycle.p07.contract.behavior.test.ts` (26 tests): provider
  correlation (5), live cancellation phases (9), tool interval honesty (3),
  observer ownership (3), stale terminal cancellation evidence (5 NEW +
  corrected — tool/approval cleared on provider start, active state preserved,
  api evidence preserved, overlap precedence preserved).
- `operationLifecycle.p07.behavior.test.ts` (32 tests): direct client phases,
  provider/tool interval metrics, honest residual, granular cancellation
  classification, D1 continuation, observer fail-fast, superseded queue,
  default-off, approval_wait_ms.
- `useAgentEventStream.defaultoff.p07.bun.tsx` (4 NEW tests): absent observer
  performs NO monotonic-clock calls; absent observer continues after an ordinary
  handler error; present observer measures dispatch; present observer throw
  rejects the stream (fail-fast).

**Verification (all GREEN):** 97 tests across the 4 lifecycle/default-off files;
`useAgentEventStream.bun.tsx` + `loopIntegration` + `useSubmitQuery.lifecycle`
unaffected. Telemetry perf + provider perf tests green (see below). Affected
package typechecks (CLI, telemetry, providers) clean. ESLint + Prettier on
touched files clean. `git diff --check` clean.

**Out of scope (NOT claimed complete):** P12 integration wiring (runtime
construction of the registry + identity provider + overhead harness) remains
TODO. P10 memory trend and P11 reader/consumer remain TODO.

## P10 progress — memory trend (zero new timers, ring, two slopes) (COMPLETE)

**Scope delivered:**
- `packages/cli/src/ui/hooks/memoryTrend/memoryRing.ts`: `MemoryRing` —
  fixed-capacity overwrite ring (capacity 180 entries = 3 hours at 60 s
  cadence, bounded for a CLI process). Oldest→newest snapshot, defensive
  copy (no mutable internal alias). No dynamic/unbounded array growth.
- `packages/cli/src/ui/hooks/useMemoryMonitor.ts` (extended): DEFECT 1 fixed —
  the warn-once latch is separated from the sampling loop; the interval no
  longer `clearInterval`s itself after warning. Zero new timers (only the
  existing 60 s interval is extended). When a `memoryController` is present,
  each tick calls `process.memoryUsage()` once and hands the same full sample
  to the controller. When absent, warn-only behavior is retained and no
  telemetry ring/write work occurs. Package-private
  `MemoryMonitorPorts`/`__setMemoryMonitorPortsForTesting` seam for
  deterministic timer/memory behavior. Cleanup and default-off preserved.
- `packages/cli/src/ui/hooks/memoryTrend/memoryTelemetry.ts`:
  `MemoryTelemetryController` — constructible (no singleton), shares the
  existing PerfSink. Maintains the bounded ring, writes schema-valid
  `memory_sample` records with wall ISO ts, monotonic `uptime_ms`, and
  `ms_since_last_operation`. Pre-first-operation `ms_since_last_operation`
  = uptime since process start (honest, not fabricated). `markOperationEnd` +
  `sampleOperationEndMemory` implement the `OperationMemorySampler` interface
  for the lifecycle registry. `snapshot()` exposes ring contents for P11.
- `packages/cli/src/ui/hooks/agentStream/operationLifecycle.ts` (modified):
  `OperationLifecycleRegistry` gets an optional `memorySampler` (present only
  when memory telemetry enabled). At exactly-once finalisation,
  `captureOperationEndMemory()` marks operation-end and samples
  `process.memoryUsage()` once to include `rss_bytes`/`heap_used_bytes`/
  `external_bytes`/`array_buffers_bytes`. Disabled/absent omits all four
  fields (never zeros). P07 elapsed/finalize semantics and existing default
  behavior preserved.
- `packages/cli/src/ui/hooks/memoryTrend/memorySlope.ts`: read-time slopes
  (never persisted). `derivePerOperationMemorySlope` — least-squares of each
  memory column on `session_operation_index`. `derivePerMinuteMemorySlope` —
  least-squares on `uptime_ms` scaled to bytes/min. Requires ≥2 usable points
  and nonzero x variance; otherwise null (never NaN/Infinity). Negative
  slopes preserved (not clamped). Per-record-series functions (P11 invokes
  per run/file; separate files NOT combined in P10).
- `packages/cli/src/ui/hooks/memoryTrend/index.ts`: barrel exporting all P10
  types/functions for downstream P11/P12.

**Bun/bun:test behavioral evidence** (31 tests across 5 NEW files — no Vitest/Node
suites modified):
- `memoryRing.behavior.test.ts` (8 tests): empty ring, oldest→newest order,
  overwrite after capacity, multi-wrap, defensive copy (mutating snapshot does
  not affect ring), independent snapshot arrays, default capacity exposed,
  default-capacity overflow holds exactly capacity.
- `memoryTelemetry.behavior.test.ts` (8 tests): schema-valid memory_sample
  with correct values/uptime, pre-first-operation idle = uptime (honest),
  post-operation idle = uptime − last op end, ring snapshot oldest→newest,
  sampleOperationEndMemory returns four columns, implements
  OperationMemorySampler interface, idempotent columns, no slope key in
  persisted records.
- `useMemoryMonitor.behavior.test.ts` (6 tests): exactly one interval on
  mount, clears on unmount, warning fires once but interval continues (DEFECT 1
  fix), no warning below threshold, memory-off retains warn-only, memory-on
  records tick samples to ring.
- `memorySlope.behavior.test.ts` (13 tests): per-operation positive slope
  across all four metrics, negative slope preserved, <2 points null, empty
  null, zero x-variance null, ignores records without memory columns, exactly
  2 points yields slope; per-minute positive slope, negative slope preserved,
  <2 points null, empty null, zero x-variance null, exactly 2 points yields
  slope.
- `operationLifecycle.p10.memory.behavior.test.ts` (4 tests): memory ON
  includes all four columns, memory OFF omits all four (absent not zero),
  markOperationEnd called at finalisation, no slope key in persisted record.

**Verification (all GREEN):** 132 tests across 8 CLI files (P06/P07/P10 +
memoryTrend); 297 telemetry perf tests; 64 P09 settings tests. CLI + telemetry
typechecks clean. ESLint + Prettier on all touched files clean.
`git diff --check` clean. `packages/agents` / `.llxprt` / `specification.md` /
`PLAN.md` diffs: empty. No dependencies/workflows/lint config modified.

Artifacts outside `project-plans/issue3167/`: `packages/cli/src/ui/hooks/
memoryTrend/` (new module — 7 files), `packages/cli/src/ui/hooks/useMemoryMonitor.ts`
(modified), `packages/cli/src/ui/hooks/agentStream/operationLifecycle.ts`
(modified), `operationLifecycle.p10.memory.behavior.test.ts` (new).
`.llxprt` untouched. Authoritative design records NOT rewritten.
P11 reader/consumer remains TODO.

## P11 progress — reader/consumer + report + /perf + inspect + delete (COMPLETE)

**Scope delivered:**

1. **Sorted per-file tolerant consumer** (`perfConsumer.ts`):
   `streamPerfDirectory` / `consumePerfDirectory` — async generators that read
   sorted `perf-*.jsonl` files one at a time (no gzip, no shell pipeline, no
   argument-limit breakage). Each entry carries source-file name + run-UUID
   identity so memory slopes are per-run/file and never pooled across process
   uptimes. Missing directory = empty dataset (fail open). Genuine filesystem
   errors propagate. Does NOT parse claim files. Bounded `consumePerfDirectory`
   accumulates entries + aggregate counts (parsed/malformed/futureVersion/
   unversioned/truncated/blank/files/bytes).

2. **D7 dimension-matched report + no-baseline semantics** (`perfReport.ts`):
   `buildReport` / `assembleReport` — groups operations by build identity
   (`llxprt_version` + `git_sha`) within exact comparison dimensions (provider,
   model, render_mode, terminal_cols, terminal_rows). Computes sample count,
   contaminated count (`concurrent_instances >= 2`, NOT contended), p50 for all
   recorded timing/counter/token metrics, terminal status counts, and per-file
   memory slopes from P10 functions. Without `--baseline`: grouped p50 / sample /
   self-health, NO delta. With `--baseline <version|sha>`: matched-dimension
   deltas vs baseline rows only; unmatched groups reported as unmatched, NEVER
   pooled. Percent delta avoids division by zero (null when baseline p50 is 0).
   Self-health surfaces skipped/truncated/lastWriteErrorCode/evictionCount (NOT
   records_dropped — excluded).

3. **D1 read-time join** (`joinTokenRowsByOperation`): token-usage/session rows
   carrying a `prompt_id` are joined by deriving the operation_id via
   `joinKeyFromPromptId` (splits on `#continuation#`). N continuation rows join
   to one operation without persisted child ids.

4. **Inspect** (`perfInspect.ts`): surfaces directory path, schema version,
   privacy statement (local-only/default-off/no-upload/memory-separately-opt-in),
   owned JSONL file count/bytes, operation/memory-sample record counts, tolerant
   skipped breakdown, and claim count. `formatInspect` produces stable output.

5. **Live-writer-safe delete** (`perfDelete.ts`): removes owned perf JSONL and
   stale claim artifacts. Protects the current UTC-day perf file with recent
   mtime (active writer) and any perf JSONL whose run UUID has a non-stale claim
   (lease). Reuses shared `isLiveWriterFile` / `isNonStaleClaim` / `extractRunUuid`
   from `perfArtifacts.ts` so retention and delete cannot drift. Never deletes
   unrelated files. External fs failures fail open and are counted. Internal
   invalid options (NaN/negative timing) fail fast. Injected `PerfDeleteFilesystem`
   port for deterministic fault injection.

6. **Shared artifact protection helpers** (`perfArtifacts.ts`): single source of
   truth for `isPerfJsonl`, `isClaimFile`, `isOwnedArtifact`, `parseDayKeyFromName`,
   `extractRunUuid`, `utcDayKey`, `isLiveWriterFile`, `isNonStaleClaim`. Both
   retention and delete import these so protection semantics cannot diverge.

7. **Self-health** (P04/P08 source): `PerfSink.lastWriteErrorCode` (string | null)
   and `PerfRetention.evictionCount` (number). No `records_dropped` counter.
   8 Bun tests prove these surface correctly and that records_dropped is absent.

8. **Injected live snapshot command** (`perfCommand.ts`): `createPerfCommand`
   accepts an optional `PerfSnapshotCapability` and `perfDir` override. Bare
   `/perf` shows current-process snapshot (live MemoryRing + active operation)
   when capability is present; says "not active" honestly when absent. No
   unowned global singleton — `perfCommand` export has null capability; P12
   wires the production capability via `createPerfCommand({ snapshotCapability })`.
   Subcommands: `/perf inspect`, `/perf report [--baseline <version|sha>]`,
   `/perf delete`. Registered in `BuiltinCommandLoader`. `MessageActionReturn`
   result type throughout (no wrong slash command result types).

9. **Stable formatter/arg handling**: `formatReport`, `formatInspect`,
   `formatDeleteResult` produce deterministic output. `parseReportArgs` handles
   `--baseline <value>` (exact version or sha), rejects missing values and
   unexpected args with useful error messages.

10. **P10 single wall-clock sample correction**: `MemoryTelemetryController.
    recordTickSample` captures `wallNow()` exactly once so the ring timestamp
    and the record `ts` describe the same sample. `useMemoryMonitor` calls
    `process.memoryUsage()` once per tick and passes the same full sample to
    the controller.

11. **P09 planning wording correction**: execution-tracker P09 entry corrected
    from "deep-copies + freezes perf (`Object.freeze`)" to "defensively clones
    perf (`withClonedPerf`) on every ingress and egress" — matching the actual
    implementation (isolation by cloning, not freezing).

12. **Exports**: all P11 public API re-exported from
    `packages/telemetry/src/perf/index.ts` → `packages/telemetry/index.ts`.
    Consumer, report, inspect, delete, artifact helpers, types.

**Bun/bun:test behavioral evidence** (72 tests across 6 NEW files — no Vitest/Node
suites modified):
- `perfConsumer.behavior.test.ts` (12 tests): sorted parsing, source/run-UUID
  identity, streaming order, missing-dir empty dataset, future-version skip+count,
  unversioned skip+count, malformed skip+count, truncated count, blank count,
  no claim parsing, multi-file aggregation, lazy streaming.
- `perfReport.behavior.test.ts` (18 tests): dimension grouping, never-pool,
  p50, contamination, terminal status, no-baseline-no-delta, baseline-by-version,
  baseline-by-sha, unmatched-explicit, baseline-not-found, empty-dir, percent
  div-zero, per-file memory slopes, formatter stability, formatter self-health,
  D1 join (2), mixed multi-version fileset.
- `perfInspect.behavior.test.ts` (7 tests): dir/schema/privacy, file/byte counts,
  operation/memory counts, skipped breakdown, claim count, missing-dir zero,
  formatter fields.
- `perfDelete.behavior.test.ts` (11 tests): stale delete, active-writer protect,
  claim protect, non-stale/future claim protect, stale-claim delete, unrelated
  untouched, missing-dir no-op, fs-failure fail-open, NaN fail-fast, negative
  interval fail-fast, same-run stale+fresh.
- `perfSelfHealth.behavior.test.ts` (8 tests): lastWriteErrorCode null/error/
  persistent, no records_dropped; evictionCount zero/increment/no-increment-on-
  failure, no records_dropped.
- `perfCommand.behavior.test.ts` (16 tests): inspect output + empty-dir, report
  output + no-baseline + baseline version/sha + missing value + malformed +
  unexpected arg, delete stale + active-writer, no-snapshot unavailable,
  snapshot with capability, null-snapshot, unknown-subcommand error, loader
  registration.

**Verification (all GREEN):**
- P11 telemetry tests: 56 tests (consumer + report + inspect + delete + self-health).
- P11 CLI tests: 16 tests (perfCommand).
- All telemetry perf tests: 353 tests.
- Affected P06/P07/P10 tests: 97 + 36 = 133 tests.
- Affected P05/P09 tests: 58 + 22 = 80 tests.
- Provider perf tests: 11 tests.
- CLI + telemetry typechecks (`tsc --noEmit`): clean.
- ESLint + Prettier on all touched files: clean.
- `git diff --check`: clean. No `.llxprt` / `packages/agents` / `specification.md`
  / `PLAN.md` / dependency / workflow / lint-config changes.

Artifacts outside `project-plans/issue3167/`: `packages/telemetry/src/perf/
perfConsumer.ts`, `perfReport.ts`, `perfInspect.ts`, `perfDelete.ts`,
`perfArtifacts.ts`, `index.ts` (new/modified); `packages/cli/src/ui/commands/
perfCommand.ts` (new); `packages/cli/src/services/BuiltinCommandLoader.ts`
(modified — perfCommand registration); 6 new test files. `.llxprt` untouched.
Authoritative design records NOT rewritten.

---

## Remediation Evidence (Findings A/B/C)

**Finding A — Synchronous immutable terminal snapshot:**
- `operationLifecycle.ts`: `finalise` now atomically claims + synchronously
  freezes one immutable `FrozenTerminalSnapshot` (wall ts, terminal monotonic,
  elapsed/uptime, identity, status, ALL measurement counters/tokens, interval
  durations, approval-wait closure, client_finalize_ms measured against the
  synchronous finalize boundary, honest residual, optional operation-end memory)
  BEFORE queueing. The queued async work (`persistSnapshot`) does ONLY external
  `countNonStaleClaims` + `sink.write` from the frozen copy — never a mutable
  PendingOp/measurement reference. Superseded sweep uses the same path.
- `retainedCancellationEvidence` changed from strong `Map` to `WeakMap` —
  evidence survives active-map removal until classification (behaviorally
  proven).
- Missing tool boundaries: count/sum recorded WITHOUT interval synthesis;
  CLI status transitions do NOT synthesize tool intervals.
- Tests: `operationLifecycle.snapshot.behavior.test.ts` — 6 behavioral tests
  (mutation-after-finalise cannot change record; delayed countNonStaleClaims
  cannot alter terminal snapshot; coherent client_finalize/elapsed/residual
  clocks; superseded snapshots frozen; cancellation evidence after active
  removal without strong retention; missing tool boundaries no synthesized
  intervals). All pass.

**Finding B — Fully transactional interactive startup:**
- `interactiveUI.tsx`: every fallible stage after perf owner starts runs as ONE
  transaction via `commitInteractiveStartup` with injectable
  `InteractiveStartupPorts` (renderOptions, buildUiRuntime, buildSlashRuntime,
  debugAppend, setupTerminal, isMouseEnabled, render, registerSync,
  setupLifecycle). Single try/catch with `StartupTransactionState` — no nested
  rollback. On failure: primary error preserved first, tracked refs atomically
  cleared (exactly-once), owner disposed, instance cleared/unmounted, staged
  mouse disabled + listener removed, terminal protocols restored + listener
  removed. `mouseStaged` computed BEFORE `setupTerminal` so pre-mouse failures
  do NOT falsely disable unstaged mouse. Cleanup errors aggregate via
  `rollbackInteractiveFailure`.
- Tests: `interactiveUI.startup.transaction.behavior.test.ts` — 9 behavioral
  tests (render-options/ui-runtime/slash-runtime/debug/terminal-setup/render/
  setup failures all roll back; primary-error ordering; exactly-once cleanup).
  All pass.

**Finding C — Production report wiring:**
- `interactivePerfRuntime.ts`: `createSnapshotCapability` now implements
  `getSelfHealth()` returning `{ lastWriteErrorCode: sink.lastWriteErrorCode,
  evictionCount: retention.evictionCount }` — known null/0, not unavailable.
- `perfCommand.ts`: `PerfSnapshotCapability` extended with `getSelfHealth()`;
  `PerfOperations.report` extended to accept `selfHealth` + `tokenUsageDir`;
  `PerfCommandOptions` extended with `tokenUsageDir`; `createReportSubCommand`
  passes self-health from capability (undefined when no active runtime →
  "unavailable") + token-usage directory to telemetry `buildReport`.
- `BuiltinCommandLoader.ts`: wires `tokenUsageDir: join(config.getProjectTempDir(),
  'token-usage')` (guarded with optional chaining so null config stays undefined).
- `perfReport.ts` (telemetry): production `buildReport` now streams token files
  and aggregates by derived operation ID (O(operation IDs) memory) instead of
  retaining all token rows. `assembleReport` accepts `aggregatedTokens` map.
  Stale self-health doc corrected (not defaulted to null/0 when unavailable).
- Tests: `perfCommand.wiring.behavior.test.ts` — 7 behavioral tests (exact
  params; inactive health = unavailable; active clean = null/0; active
  errors/evictions propagate; real continuation token join in production
  command; no tokenUsageDir keeps persisted totals; no capability passes
  undefined self-health). All pass.

**Verification (all GREEN):**
- Telemetry perf tests: 435 tests.
- operationLifecycle tests: 107 tests (39 + 62 + 6 new).
- Finding B startup tests: 9 tests.
- perfCommand tests: 32 tests (25 existing + 7 new).
- interactivePerfRuntime + buildPerfOwner tests: 29 tests.
- Related CLI behavior tests (inkRenderOptions, perfSettings): 33 tests.
- Telemetry + CLI typechecks (`tsc --noEmit`): clean.
- ESLint on all touched files: clean (no eslint-disable/suppression).
- Prettier on all touched files: clean.
- `git diff --check`: clean.
