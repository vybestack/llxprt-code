# Acceptance Criteria — Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167
Binding source: `specification.md` (§1–§9). Where `PLAN.md` REQ text is broader,
spec §9 reduced delivery wins; excluded items are marked **[EXCLUDED]**, optional
compression **[DEFERRED]**.

**Preflight correction:** source fact-checking found blockers against the original
artifacts; the resolved implementation contract is recorded here as decisions
**D1–D8** and applied consistently across the domain model, pseudocode, phase
files, and execution tracker. The authoritative `specification.md` and `PLAN.md`
are **not** rewritten; where a resolved decision diverges from a spec detail
(notably D1 — child-id arrays removed; D2 — nested settings), that divergence is
recorded in the relevant AC.

- **D1** child correlation — `operation_id` only; no `prompt_ids`/`turn_ids`
  arrays/true-count on the record; join at read time. Child ids do **not** arrive
  via `AgentEvent`.
- **D2** settings — nested `telemetry.perf.enabled` + `telemetry.perf.memory`.
- **D3** concurrent_instances — per-run claim file, lease-window semantics.
- **D4** PerfSink — no FileOutput inheritance; serialized no-drop promise chain.
- **D5** retention constants — derived from a P04 Bun record-size benchmark.
- **D6** fs-failure testing — package-private port; never real-disk fill/chmod.
- **D7** report baseline — exact version/sha; matched-dimension; unmatched never pooled.
- **D8** stdout observer — internal errors fail fast; no swallow.

All planned tests are **Bun / `bun:test` only, behavioral, integration-first**,
and prove real outputs/state/files — never mock calls. Evidence tag format:
`EVIDENCE-ACn` referenced from phase files.

---

## AC-1 — Single-schema real writer/read round trip (REQ-3167-5, -7)

**Given** perf enabled and a real `PerfSink` writing to a tmpdir perf dir.
**When** N terminal operations complete.
**Then** exactly N `operation` records exist as one JSON object per line,
**each parseable by the real tolerant reader** (`parsePerfRecord`) back to the
exact field values the writer produced.

- **Evidence**: a real write → fs read → parse loop; the round-trip asserts
  against output produced by the actual writer (no hand-authored fixture).
- **Boundary**: record spanning midnight (UTC day-key rolls the file on the next
  write); empty operation set writes nothing.
- **Anti-mock**: no `vi.mock(fs)`; use real files.

## AC-2 — Default-off: no files, no listeners, no overhead (REQ-3167-8)

**Decision (D2 — settings):** persisted shape is nested
`telemetry.perf.enabled` (master) and `telemetry.perf.memory`, both default
**false**; `telemetry.perf` is **not** a boolean. Memory requires the master.

**Given** default settings (perf disabled).
**When** llxprt runs one or more operations.
**Then** **no** `perf-*.jsonl` file is created, **no** claim file is written,
**no** stdout observer is installed, **no** onRender wiring is added, **no**
memory ring is allocated.

- **Evidence**: after a full scenario run with default settings, assert the perf
  dir does not exist / is empty AND no extra write-proxy observer is active.

## AC-3 — Identity joins and continuation grouping (REQ-3167-3, settled §3/§9)

**Decision (D1 — child correlation):** the v1 perf record carries **no** child
`prompt_ids`/`turn_ids` arrays and **no** true-count/cap fields. Source
fact-checking found those child ids do **not** arrive in the CLI via `AgentEvent`
(event-types.ts defines ~20 event variants — text/tool/usage/done/… — none carry
a per-continuation `prompt_id`). Collecting them would require minting+propagating
ids through `packages/agents`, which is excluded. The reduced, zero-plumbing
resolution: `operation_id` (derived from the top-level prompt-id prefix) is the
sole join key, and the report performs the exact join at read time.

**Given** one user submission producing an initial prompt id
`${sessionId}#agentic-loop#${uuid}` and continuations `…#continuation#1`,
`…#continuation#2` (real `AgenticLoop.generateContinuationPromptId`).
**When** the operation record is produced.
**Then** `operation_id === deriveOperationId(initialPromptId) === initialPromptId`
(no continuation suffix); the record carries **no** child-id arrays; and
`runtime_id`/`parent_runtime_id`/`subagent_name` reuse #3130's key names verbatim
so the perf log joins the token-usage log and session recording.

- **Evidence**: a real continuation stream through the integrated recorder;
  assert the prefix invariant `deriveOperationId(c) === initialPromptId` for
  every continuation id observed, and assert the produced perf record contains
  **no** `prompt_ids`/`turn_ids`/`prompt_ids_total`/`turn_ids_total` fields.
- **Read-time join evidence (D1)**: write one perf `operation` record, plus the
  corresponding token-usage rows (one per continuation, each carrying its own
  `prompt_id`); the report derives `operation_id` from each token row's
  `prompt_id` and joins every continuation row to the **single** perf operation
  — proving multi-continuation rows join to one perf operation **without** any
  child id copied into the perf record.
- **Separate behavioural test**: `operation_id = promptId.split('#continuation#')[0]`
  so a future change to `generateContinuationPromptId` fails loudly (the existing
  `agenticLoop.prompt-id.test.ts` is extended, not duplicated).
- **[EXCLUDED]** minting+propagating operation_id through `packages/agents`;
  [EXCLUDED] a new agents→telemetry dependency edge; [EXCLUDED] `prompt_ids`/
  `turn_ids` arrays and true-count/cap fields on the perf record.

## AC-4 — Every terminal operation status incl. superseded (REQ-3167-3)

**Given** the operation lifecycle registry wired into `useSubmitQuery` acquire/
release + a finalisation sweep.
**When** an operation terminates via each path.
**Then** a record is written **exactly once** with the correct `status`:
`completed`, `error`, `cancelled_before_send`, `cancelled_during_api`,
`cancelled_during_tool`, `cancelled_during_approval`, `superseded`.

- **Evidence**: drive each path through the integrated lifecycle (fixture
  provider + abort controllers); assert one record per path with the right
  status. **Superseded** specifically: a newer turn displaces the AbortController;
  assert the displaced op is finalised as `superseded` exactly once even though
  its guarded `finally` (isCurrentTurn==false) never runs.
- **Boundary**: double-finalise is a no-op (exactly-once).

## AC-5 — Direct phase measurement + overlap semantics (REQ-3167-1, -2)

**Given** a streaming operation with concurrent/nested provider and tool activity.
**When** the record is produced.
**Then** each client phase (`client_prepare_ms`, `stream_handler_ms`,
`ink_render_ms`, `stdout_write_sync_ms`, `client_finalize_ms`) is a directly
measured non-negative duration; `provider_attempt_sum_ms`/`provider_union_ms` and
`tool_call_sum_ms`/`tool_union_ms` are reported separately; and the record does
NOT claim they sum to elapsed. `unclassified_elapsed_ms` is the honest residual,
reported (not clamped, not labelled "llxprt time").

- **Evidence**: a real streaming turn; assert no client phase is computed by
  subtraction of provider/tool; assert `provider_union_ms ≤ provider_attempt_sum_ms`
  is allowed (union can be < sum when retries overlap); assert
  `agent_activity_union_ms` is the merged provider∪tool union.
- **[EXCLUDED]** `llxprtMs = elapsed − provider − tool` (algebraically invalid).

## AC-6 — Ink render/write distinction + stdout overload/backpressure/bytes (REQ-3167-4)

**Decision (D8 — stdout observer):** an internal observer/programming error is
**never** swallowed. There is no try/catch around the internal observer callback;
it fails fast. Only the **filesystem writer** (external I/O) fails open. The
previous "an observer that throws must not corrupt the write (fire-and-forget)"
claim is removed.

**Given** the stdout observer installed on the **interactive** Ink instance only.
**When** Ink renders frames and writes bytes.
**Then** `ink_render_count` (onRender passes) ≠ `stdout_write_calls` (write
invocations); `stdout_bytes` counts **encoded bytes** (`Buffer.byteLength`/
`Uint8Array.byteLength`, never string length); the write wrapper preserves every
overload (string|Uint8Array, encoding, callback) and the backpressure boolean;
and Zed's separate `createInkStdio()` produces **uncounted** writes.

- **Evidence**: real Ink render with a fixture stream; assert render_count and
  write_calls diverge on a coalesced/throttled frame; assert a `Uint8Array` write
  counts its byte length, not its property count; assert the wrapper returns the
  real `writeToStdout` boolean (backpressure) and invokes callbacks.
- **Fail-fast boundary**: an internal observer that throws propagates (no
  swallow); filesystem writer failures remain fail-open as external I/O (AC-8).

## AC-7 — Retention under concurrency / 24×7 / clock changes / live writers / unlink failures (REQ-3167-6)

**Decision (D3 — concurrent_instances / claim files):** a per-run claim file in
the global perf dir is touched by the single owned coarse maintenance interval
and removed on clean dispose. `concurrent_instances` counts non-stale claims at
operation finalization; the name is kept but it has **lease-window semantics with
bounded crash overshoot** (a crashed run leaves a stale claim until the next
maintenance sweep). Claim files are included in retention artifact accounting but
are **never mistaken for JSONL records**.

**Given** the eventual-bound retention with live-writer safety and claim-file
concurrency accounting.
**When** records accumulate under: many concurrent writers; a long-running
process (maintenance on roll + coarse interval, not startup-only); a clock step
backwards then forwards; an active live writer; and an `unlink` that fails.
**Then** the bound is enforced as an **eventual bound with documented overshoot**
that explicitly permits active-day and claim overshoot; a live writer's file
(today's day-key, mtime within the maintenance window) is **never** deleted;
failed unlinks do not corrupt accounting (decrement only on success); and the
guarantee degrades to "no further growth" on a read-only/full volume.

- **Evidence**: real multi-writer tmpdir; assert (a) a file with today's day-key
  and recent mtime survives a sweep that evicts older files; (b) a 24×7-style
  process triggers maintenance via the coarse interval without restart;
  (c) a filesystem-port-injected unlink failure leaves accounting intact (D6);
  (d) total bytes eventually falls under the cap after enough evictions (overshoot
  documented, not zero); (e) claim files count toward artifact accounting but are
  not parsed as JSONL records.
- **Boundary**: materially-future mtime delays eligibility (benign).
- **[EXCLUDED]** instantaneous no-loss hard cap (impossible with no coordination);
  [EXCLUDED] a drift-probe timer.

## AC-8 — Writer fail-open + bounded/rate-limited diagnostics under EACCES/EROFS/ENOSPC (REQ-3167-7)

**Decision (D4 / D6 — sink + fault injection):** PerfSink uses a serialized
no-drop promise chain (it does **not** inherit FileOutput's bounded/drop queue).
Internal observer/programming errors fail fast; only **filesystem**
persistence/maintenance errors fail open and are rate-limited. Tests never fill
the real disk and do **not** rely on chmod semantics (non-portable). They use a
narrow package-private filesystem port / deterministic failing file handle to
produce EACCES/EROFS/ENOSPC — boundary fault injection, not mock theater.

**Given** a writer facing EACCES, EROFS, or ENOSPC on append.
**When** perf attempts to write.
**Then** the session is unaffected (no throw escapes to the operation path);
diagnostics are **rate-limited** (not unbounded `console.error`); and the
serialized no-drop write chain provides its own back-pressure.

- **Evidence**: real tmpdir + a narrow package-private filesystem port (or
  deterministic failing file handle) that injects each errno at the append
  boundary; assert the operation completes normally and that repeated failures
  emit at most one diagnostic per rate-limit window to stderr. Separate real-file
  integration tests prove the actual round-trip and concurrency behavior.
- **[EXCLUDED]** a `records_dropped` counter; [EXCLUDED] a retry-threshold
  self-disable state machine; [EXCLUDED] FileOutput's bounded-queue drop policy.

## AC-9 — Cross-platform streaming consumer + inspect/delete + /perf (REQ-3167-9)

**Decision (D7 — report baseline):** `--baseline` accepts an exact `llxprt_version`
or `git_sha`. Without it, the report prints grouped matched-dimension p50/sample/
self-health data and **no** delta. With it, each non-baseline version/commit group
is compared **only** against the selected baseline rows sharing
provider/model/render-mode/terminal-geometry buckets; unmatched groups are
reported as **unmatched, never pooled**. `/perf` is a current-process snapshot;
the report is longitudinal. `inspect` shows path/schema/privacy/record counts;
`delete` respects live claims (D3).

**Given** accumulated real perf files (mixed schema versions, a malformed line,
and a truncated final line from a simulated SIGKILL).
**When** the report streams them.
**Then** it dispatches on `schema_version`, **ignores unknown fields** (a field
add is not a bump), **skips + counts** records above the known version (never
coerces), **tolerates the truncated final line** (counts it), groups by
version/commit within matched dimensions, reports self-health (skipped/truncated
counts, last write error, evictions — **not** records_dropped), and works
cross-platform (no shell pipeline).

- **Evidence**: real multi-version fileset in tmpdir; assert known-version
  records parse, unknown-version records are counted-not-crashed, the truncated
  tail is counted, and the report output includes the counts. `inspect` shows the
  dir/schema/privacy/record counts; `delete` removes files respecting live claims.
- **Baseline**: without `--baseline` → grouped p50/sample/self-health, no delta;
  with `--baseline <version|sha>` → matched-dimension delta vs baseline only,
  unmatched groups reported as unmatched.
- **[EXCLUDED]** gzip; [EXCLUDED] `contended` (use `concurrent_instances`).

## AC-10 — Memory fields omitted when disabled; two read-time slopes when enabled (§7)

**Decision (D2 — settings):** the persisted shape is **nested**
`telemetry.perf.enabled` and `telemetry.perf.memory`, both default **false**;
memory requires `enabled`. `telemetry.perf` is **not** itself a boolean. (Note:
spec §7.4 names the master `telemetry.perf`; the resolved persisted contract is
the nested shape below — recorded here because spec is not rewritten.)

**Given** perf master (`telemetry.perf.enabled`) on.
**When** `telemetry.perf.memory` is **off**.
**Then** operation records **omit** the memory columns (absent, not zero) and no
`memory_sample` records are written; the 60 s monitor reverts to warn-only.
**When** memory is **on**.
**Then** operation records carry the four memory columns; `memory_sample` rows
carry `uptime_ms` + `ms_since_last_operation`; and the reader can derive **two
slopes** (per-operation on `session_operation_index`; per-minute on `uptime_ms`
using the sample rows). Slopes are derived at read time, never stored.

- **Evidence**: real records with memory on/off; assert field **presence/absence**
  (not values==0); assert the per-minute slope uses idle samples
  (`ms_since_last_operation` large) to expose a leak signature.
- **[EXCLUDED]** a stored slope; [EXCLUDED] a new timer; [EXCLUDED] memory
  collected when the master is off.

## AC-11 — Fixed-capacity sample ring + continued warning monitor (§7.3)

**Given** the extended 60 s monitor.
**When** it runs for many ticks.
**Then** the live `/perf` ring is **fixed-capacity with overwrite** (never a
growing array); and the monitor **continues sampling after warning once** (the
warn-once latch is separated from the sampling loop — it no longer
`clearInterval`s itself).

- **Evidence**: drive M > CAPACITY ticks; assert the ring length == CAPACITY and
  oldest entries are overwritten; assert the interval is still active after a
  warning fired.
- **[EXCLUDED]** piggybacking Footer.tsx's 2 s interval.

## AC-12 — Observer-effect harness: enabled/disabled, p50/p95/p99, no wall-clock assertion (PLAN §"Measured facts" withdrawal)

**Given** the Bun harness exercising the **real** integrated pipeline.
**When** a streaming-load scenario runs perf-enabled and perf-disabled.
**Then** the harness **reports** p50/p95/p99 per-op overhead for both and the
delta, and **asserts stable invariants only**: disabled ⇒ no perf file; enabled ⇒
record count == operation count; disabled path produces zero side-effects. It
does **not** assert an unstable wall-clock threshold.

- **Evidence**: harness output prints the percentiles as evidence; assertions
  gate only the invariants.
- **[EXCLUDED]** a µs/turn budget asserted as a pass/fail gate.

---

## Scope ledger (resolved against PLAN.md using spec §9)

| Item | Status |
|---|---|
| Schema + Zod single declaration (writer & reader derive) | **Accepted** |
| PerfSink reuses narrow file/path/append primitives; does **not** inherit FileOutput's bounded/drop queue (D4) | **Accepted** |
| IntervalUnion extracted + incremental duration | **Accepted** |
| operation_id derived from prompt-id prefix; **no** child-id arrays in the record (D1) | **Accepted (halved + reduced)** |
| Operation lifecycle registry incl. superseded | **Accepted** |
| Directly measured client phases + honest residual | **Accepted** |
| Ink onRender + interactive-only stdout observer; observer fails fast (D8) | **Accepted** |
| Retention eventual-bound + live-writer safe; claim-file concurrency accounting (D3) | **Accepted** |
| Tolerant streaming reader + report + /perf + inspect + delete | **Accepted (plain, no gzip)** |
| Settings nested `telemetry.perf.enabled` + `telemetry.perf.memory` (D2) | **Accepted** |
| Retention constants derived from P04 Bun record-size benchmark (D5) | **Accepted** |
| Fault-injected fs failures via package-private port, never real-disk fill/chmod (D6) | **Accepted** |
| Report `--baseline` exact version/sha; matched-dimension delta; unmatched never pooled (D7) | **Accepted** |
| Memory trend: two slopes, zero new timers, own off-switch | **Accepted (one PR)** |
| Overhead harness (real integration, no wall-clock gate) | **Accepted** |
| `contended` drift probe | **[EXCLUDED]** |
| `records_dropped` / bounded-queue drop policy | **[EXCLUDED]** |
| `prompt_ids`/`turn_ids` arrays + true-count/cap on the perf record | **[EXCLUDED — D1]** |
| retry-threshold self-disable state machine | **[EXCLUDED]** |
| gzip (reader + archive) | **[DEFERRED — optional, last]** |
| size sub-rolling | **[DEFERRED — optional, last]** |
| agents→telemetry dependency edge | **[EXCLUDED]** |
| mint+propagate operation_id through agents | **[EXCLUDED]** |
