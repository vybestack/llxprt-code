# Domain Model — Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167
Status: analysis (derived from `specification.md` §1–§9, binding; `PLAN.md` requirements reconciled where they conflict)

> This document models the *settled* (spec §9 reduced) delivery. Where
> `PLAN.md` REQ text is broader than `specification.md` §9, the narrower
> spec decision wins and the broadened part is recorded here as **excluded**,
> not silently dropped.
>
> **Decisions D1–D8 (source-verified blockers, resolved):** applied throughout.
> Where a decision diverges from a `specification.md` detail — D1 (no child-id
> arrays on the record; join at read time) and D2 (nested
> `telemetry.perf.enabled`/`.memory`, not a boolean `telemetry.perf`) — the
> divergence is recorded here and in `acceptance-criteria.md`; the authoritative
> spec is not rewritten.

---

## 1. Scope resolution (spec §9 binding)

| Concern | PLAN.md text | Settled decision (spec) | Status |
|---|---|---|---|
| `operation_id` | "minted at submission, propagated to every child send; new agents→telemetry edge" | Derived from prompt-id prefix at read/derive time: `promptId.split('#continuation#')[0]`. Zero plumbing; `packages/agents` untouched; **no agents→telemetry edge**. **D1:** no child-id arrays on the record — the join is performed at read time from token-usage `prompt_id` metadata. | **Accepted (halved + reduced)** |
| `contended` drift probe | comparison dimension + ~10 Hz probe | **Excluded** — `concurrent_instances` carries the signal at zero timer cost | Excluded |
| `records_dropped` | bounded-queue drop policy field | **Excluded** — no bounded-queue drop counter; one record/operation through a serialized chain | Excluded |
| retry-threshold self-disable | "disables itself after a defined failure threshold" | **Excluded** as a state machine — fail-open + rate-limited diagnostics only | Excluded |
| gzip in reader/consumer | "streams plain and gzipped records" | **Excluded** — plain records only | Excluded |
| size sub-rolling / gzip archive | Phase 7 compression | **Deferred** (optional, last; not a prerequisite) | Deferred |
| memory trend | (separate concern in PLAN) | **In scope, one PR** — §7 first-class | Accepted |

**Net:** all accepted #3167 work — schema, writer, retention, lifecycle, client
phases, reader/consumer, `/perf`, settings, **and the memory trend** — ships as
**one issue / one PR**.

---

## 2. Package layering (spec §4, §8 — verified against `package.json` edges)

```
storage < telemetry < core < agents < cli
```

| Package | Owns for this feature | Must NOT |
|---|---|---|
| `telemetry` | Zod schema (`perfRecords.ts`), the JSONL sink (PerfSink reuses narrow FileOutput primitives, does **not** inherit — D4), directory retention, the extracted `IntervalUnion` | import core/cli/agents |
| `core` | the stdout byte/duration counter hook only (`utils/stdio.ts` lives here and cannot move) | import cli; the writer stays in telemetry |
| `cli` | operation lifecycle + finalisation registry, Ink `onRender` wiring, stdout observer install, opt-in setting reads, `/perf` + report command, overhead harness | add an agents→telemetry edge |
| `agents` | **Nothing.** | acquire a telemetry dependency for this feature |

No new dependency edges are added. The writer is reachable from core's stdout
seam because telemetry sits *below* core; the cli installs the observer it owns.

---

## 3. Entities

### 3.1 PerfOperationRecord (record_type: "operation")
One per terminal top-level operation. Fields per spec §1.1–§1.6. **D1 (resolved):**
the record carries **no** `prompt_ids`/`turn_ids` arrays and **no**
true-count/cap fields — source fact-checking confirmed child continuation ids do
not arrive in the CLI via `AgentEvent`, so collecting them would require plumbing
through `packages/agents`. `operation_id` (derived from the initial prompt-id
prefix) is the **sole** join key; the report derives the same `operation_id` from
token-usage/session-recording `prompt_id` metadata at read time to join
multi-continuation rows to one operation. Memory columns (§7) ride this record
and are **omitted when disabled**, never zero-filled.

### 3.2 MemorySampleRecord (record_type: "memory_sample")
Bare sample: four memory values + `uptime_ms` + `ms_since_last_operation` +
envelope. Gives the per-minute axis. Emitted by the **existing** 60 s monitor,
never a new timer.

### 3.3 IntervalUnion (extracted)
Currently private + quadratic (`recomputeDuration` per `add`). Extracted to its
own exported module in `telemetry`; duration maintained **incrementally** during
the sorted merge so each insert is O(n) worst-case with no full re-walk. Shared
by `SessionMetricsAggregator` (provider/tool unions) and the perf recorder
(provider/tool + agent-activity unions).

### 3.4 PerfSink (reuses narrow FileOutput primitives; does NOT inherit — D4)
**D4 (resolved):** PerfSink does **not** extend `FileOutput` and does **not**
inherit its bounded/drop queue, batch+interval flush, or singleton machinery.
Narrow file/path/append primitives are extracted/reused where practical, while
`FileOutput`'s public singleton/debug behaviour is preserved unchanged. PerfSink
uses a **serialized no-drop promise chain** (own back-pressure, so **no
bounded-queue drop counter** — spec §9), **one exclusive-create day file per run
UUID** (`wx`), UTC roll on the next record after midnight, **no gzip and no size
sub-rolling**. stat-once + in-memory byte counter. Internal observer/programming
errors **fail fast**; only filesystem persistence/maintenance errors fail open
and are rate-limited. Directory retention bound by count + total bytes. Filename
`perf-<YYYYMMDD>-<runUuid>.jsonl` in `Storage.getGlobalLogDir()/perf`.

### 3.5 OperationLifecycleRegistry (cli)
Owns the finalisation sweep that the ownership release cannot provide: a
superseded turn never reaches `useSubmitQuery`'s guarded `finally`
(`isCurrentTurn` is false), so without a registry those operations are dropped.
Registers an operation at acquire (`useSubmitQuery` ~`:627`), finalises it
exactly once on any terminal status (completed / error /
cancelled_before_send / cancelled_during_api / cancelled_during_tool /
cancelled_during_approval / **superseded**). At finalisation it derives
`concurrent_instances` from non-stale claim files (D3).

### 3.6 StdoutWriteObserver (core seam + cli install)
The byte/duration counter hook lives in `core/utils/stdio.ts`. The interactive
instance from `inkRenderOptions.ts` carries it; Zed's separate `createInkStdio()`
call does **not** (global application would double-count Zed). Counts **encoded
bytes** (`Buffer.byteLength`/`Uint8Array.byteLength`), sync invocation duration
only, and write-call count — distinct from Ink's `onRender` render passes.
**D8:** the internal observer callback is **not** wrapped in try/catch — an
observer/programming error fails fast. Only filesystem writer failures fail open
(external I/O).

### 3.7 PerfReader / ReportConsumer (telemetry reader + cli command)
Tolerant JSONL stream reader: ignore unknown fields (field-add = no bump); skip
+ count records whose `schema_version` exceeds the known max; tolerate a
truncated final line (SIGKILL mid-append) by counting it; normalise unversioned
legacy to `{schema_version:0}`. Plain records only (no gzip). **D1 read-time
join:** the reader derives `operation_id` from each token-usage/session row's
`prompt_id` (`promptId.split('#continuation#')[0]`) and joins multi-continuation
rows to the single perf `operation` record sharing that `operation_id`. **D7
report baseline:** `--baseline` accepts an exact `llxprt_version` or `git_sha`;
without it the report prints grouped matched-dimension p50/sample/self-health and
no delta; with it, each non-baseline group is compared only against baseline rows
sharing provider/model/render-mode/terminal-geometry buckets, and unmatched
groups are reported as unmatched, never pooled. `/perf` is a current-process
snapshot; the report is longitudinal. `inspect` shows path/schema/privacy/record
counts; `delete` respects live claims (D3). Self-health surfaces last write error,
evictions, skipped/truncated counts — **not** `records_dropped`.

### 3.8 MemoryRing (cli, live /perf view)
Fixed-capacity overwrite ring fed by the 60 s monitor — the leak detector must
not leak. Bounded; never a growing array.

### 3.9 PerfClaimRegistry (cli/telemetry — D3)
A per-run claim file in the global perf dir (`<runUuid>.claim`) is created when
perf is enabled, touched by the **single** owned coarse maintenance interval, and
removed on clean dispose. `concurrent_instances` is derived at operation
finalisation by counting **non-stale** claims (mtime within the maintenance
window); the name is retained but the value has **lease-window semantics with
bounded crash overshoot** (a crashed run leaves a stale claim until the next
maintenance sweep reaps it). This reuses the one owned maintenance timer — there
is **no drift-probe timer and no additional memory timer**. Claim files are
included in retention artifact accounting but are never parsed as JSONL records.

---

## 4. Key invariants

1. **operation_id = promptId.split('#continuation#')[0]** — recovers grouping
   from existing ids and is the **sole** join key on the perf record (D1). No
   `prompt_ids`/`turn_ids` arrays or true-count/cap fields exist on the record;
   the report derives the same id from token-usage `prompt_id` metadata at read
   time. A behavioural test asserts the prefix invariant so a future change to
   `AgenticLoop.generateContinuationPromptId` fails loudly.
2. **No phase is computed by subtraction of provider/tool from elapsed.**
   Client phases are directly measured; the residual is `unclassified_elapsed_ms`,
   reported honestly, never clamped, never labelled "llxprt time".
3. **Provider/tool are sum + union pairs; they do NOT sum to elapsed.**
4. **Memory disabled ⇒ fields omitted, not zeroed.** A zero is indistinguishable
   from a measurement; an absent field is unambiguous (§2 readers tolerate absent).
5. **Retention is an eventual bound with documented overshoot + live-writer
   safety**, not an instantaneous no-loss cap. The bound explicitly permits
   active-day and claim overshoot (D3/D5). A live writer's file is skipped when
   day-key is today AND mtime is within the maintenance interval.
6. **Persistent perf telemetry is opt-in / default-off**, inspectable, deletable.
7. **Zero new timers.** Memory sampling rides the existing 60 s monitor; the one
   owned maintenance timer also touches claim files (D3).
8. **Internal errors fail fast; only external I/O fails open (D8).** The stdout
   observer callback has no try/catch; filesystem writer/retention errors fail
   open and are rate-limited.

---

## 5. State transitions — operation lifecycle

```
acquire ──► preparing ──► sending(api/tool/approval interleaved) ──► terminal
   │             │              │                                      │
   │             ▼              ▼                                      ▔▔▔▔
   │      cancelled_before   cancelled_during_*                         │
   │      _send              (api/tool/approval)                        │
   │                                                                   │
   └──────────── superseded (newer turn replaced abortControllerRef) ───┘
                        ↑ never reaches ownership release; needs registry sweep
   terminal ∈ {completed, error, cancelled_before_send,
               cancelled_during_api, cancelled_during_tool,
               cancelled_during_approval, superseded}
```

Exactly-once finalisation per registered operation id, regardless of path.

## 6. State transitions — memory monitor (existing, extended)

```
60s tick ──► rss check ──► [warn latch (once, unchanged behaviour)]
                │
                ▼
        sample(rss/heap/external/arrayBuffers + uptime)
                │
        ┌───────┴────────┐
        ▼                ▼
  push MemoryRing    (if perf+memory on) emit memory_sample record
```
Defects fixed: (1) separate the warn-once latch from the sampling loop (it no
longer `clearInterval`s itself after warning); (2) MemoryRing is fixed-capacity.

## 7. Failure model (fail-fast in-process; defensive parsing only for external input)

| Boundary | Behaviour |
|---|---|
| Reader on JSONL/filesystem (external) | Tolerant: skip+count corrupt/truncated/unknown-version; never throw |
| Writer fs error (EACCES/EROFS/ENOSPC) | Fail open (session unaffected); rate-limited diagnostic; **no** retry-threshold state machine, **no** records_dropped counter (D4) |
| Internal observer/programming error | **Fail fast** — no try/catch around the observer callback (D8) |
| Retention on read-only/full volume | Degrades to "no further growth"; eviction cannot run |
| Sink construction | Real exclusive create (`wx`); stat-once; no check-then-use existsSync |

**Testing fs failures (D6):** tests never fill the real disk and do not rely on
chmod semantics (non-portable). A narrow package-private filesystem port or a
deterministic failing file handle injects EACCES/EROFS/ENOSPC at the append
boundary — boundary fault injection, not mock theater. Separate real-file
integration tests prove actual round-trip/concurrency behavior.

No speculative guards. The only swallowed exceptions are external I/O
(filesystem) failures, which are fail-open and rate-limited.

## 8. Open preflight decisions (resolved — D1/D3/D5)

1. **Stdout observer injection mechanism** — `createInkStdio` gains an optional
   observer; interactive instance carries it, Zed does not; module-scope
   `sharedStdio` becomes lazy/cached so the late (settings-gated) install works.
2. **concurrent_instances (D3)** — a per-run claim file in the global perf dir is
   touched by the single owned coarse maintenance interval and removed on clean
   dispose; `concurrent_instances` counts non-stale claims at operation
   finalisation. Lease-window semantics with bounded crash overshoot. One owned
   maintenance timer; no drift-probe timer, no extra memory timer.
3. **prompt_ids/turn_ids (D1) — RESOLVED to no arrays.** Source fact-checking
   confirmed child continuation ids do **not** arrive via `AgentEvent`; collecting
   them would require an excluded agents→telemetry edge. The record carries
   `operation_id` only; the join is performed at read time.
4. **Retention constants (D5)** — P04 first adds a Bun record-size benchmark for
   the actual schema; P08 derives concrete max-bytes/max-files/maintenance-interval
   /diagnostic-rate-limit defaults from that benchmark and operational evidence,
   with no placeholders at implementation time.

## 9. Out of scope (explicit)

CI perf gating; tool-level attribution; OTLP export; session-cleanup/stale-lock
defects (#3164); gzip; size sub-rolling; drift probe; bounded-queue drop policy;
retry-threshold self-disable; `prompt_ids`/`turn_ids` arrays + true-count/cap on
the perf record (D1).
