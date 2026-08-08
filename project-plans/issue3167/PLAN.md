# Plan: Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Generated: 2026-08-08
Revision: 3 (rev.1 and rev.2 were rejected in review; see [Rejected approaches](#rejected-approaches))
Issue: #3167
Milestone: 0.11.0
Requirements: REQ-3167-1 … REQ-3167-9

Companion design with diagrams and measured evidence: [`design.html`](./design.html) — open in a browser.
Reproducible benchmarks: [`benchmarks/`](./benchmarks) — every number quoted in this plan comes from one of
these scripts. They are stored with a `.mjs.txt` suffix so the repo-wide
`no-new-js` guard (issue #2745), which forbids new tracked `.js`/`.mjs` files,
stays green; drop the `.txt` to run one.

## Purpose

Answer one question on an ongoing basis: **is llxprt itself getting faster or slower over time**, separately
from provider latency, with enough context to attribute a change to a release or commit and trace it back to a
real session.

## Why this is not already possible

`packages/cli/src/ui/utils/computeStats.ts:66-75` computes percentages against
`accumulatedWork = API + Tool`, so API% + Tool% = 100% by construction. Every OpenTelemetry instrument we
define is likewise backend-facing. There is no `performance.now()` near an Ink render, no event-loop probe, and
no heap-trend instrumentation; `process.memoryUsage()` is used only for the Footer and a 60 s / 7 GB RSS
warning in `useMemoryMonitor.ts`.

## Rejected approaches

Two earlier revisions of this plan were wrong in ways worth recording, because the corrections shape the
design.

### Rejected: `llxprtMs = turnBusyMs − agentActiveTimeMs` (rev.1, rev.2)

The intent was to name the residual after subtracting provider and tool time "llxprt time". **This is
algebraically invalid.** `ApiAttemptRecord.durationMs` is the whole request wall duration including TTFT
(`packages/telemetry/src/telemetry/sessionMetricsAggregator.ts:38-43`) and the entire interval is inserted
into the active union (`:404-410`). During a streaming request llxprt is consuming chunks and Ink is
rendering — **inside** that interval. So:

- the residual excludes real llxprt work performed during provider/tool intervals;
- `coreMs = llxprtMs − uiMs` can be **negative** in an ordinary sequential turn, because `uiMs` occurs inside
  an API interval;
- `providerMs` and `toolMs` are *sums* (`:93-100`, `:435-436`, `:594-596`) while the residual uses a *union*,
  so the three quantities were never a partition. Parallel tools, subagent requests nested inside a tool,
  and failover attempts all make the sums exceed elapsed active time.

Clamping at zero would hide the modelling error rather than fix it. **This plan therefore does not derive
llxprt time by subtraction.** It measures client phases directly and names the leftover honestly.

### Rejected: `perf-<day>-<pid>-<nnn>.jsonl` as an ownership claim (rev.2)

"One file per process, sole writer forever" does not follow from a pid. Pids are reused across reboots, two
containers sharing a mounted home can hold the same pid, and a second run on the same day would reopen
`-000`. Sequence discovery by `existsSync` is check-then-use. Replaced by a per-run UUID with exclusive
creation (REQ-3167-5).

### Rejected: startup-only maintenance (rev.2)

A 24/7 process never restarts, so a startup-only sweep never runs and the bound is not enforced for exactly
the workload the requirement names. Replaced by roll-triggered bounded maintenance (REQ-3167-6).

### Withdrawn finding: the "negative mtime age" bug

rev.2 claimed that `Date.now() - mtimeMs` going negative on APFS made an `age < grace` eligibility check "skip
forever", and treated a `Math.max(0, …)` clamp as a required fix. **That was wrong.** For any positive grace
the clamp does not change the verdict:

```
grace = 1h : raw (age < grace) = true , clamped = true   -> same verdict
grace = 0  : raw = true , clamped = false                -> differs, but grace=0 is not the design
```

The original test used `grace = 0`, a configuration this design never uses, so it was green for the wrong
reason. The real hazard is a *materially* future mtime (an NTP step or a bad clock) delaying eligibility until
`mtime + grace`, which is a benign delay. Retained only as a test case, not as a design constraint.

## Requirements

### REQ-3167-1: Client-side phases are measured directly, not inferred

**Behavior**

- GIVEN a completed top-level operation
- WHEN its perf record is produced
- THEN each client phase is a directly measured duration, and no phase is computed by subtracting provider or
  tool time from an elapsed window
- AND any elapsed time not attributed to a measured phase is reported as `unclassified_elapsed_ms`, never as
  "llxprt time"

Measured phases: `client_prepare_ms` (before the first send), `stream_handler_ms` (synchronous time inside
delta handling), `ink_render_ms`, `stdout_write_sync_ms`, `client_finalize_ms` (after the last send).

### REQ-3167-2: Provider and tool work is reported as overlapping metrics, with both a sum and a union

**Behavior**

- GIVEN concurrent or nested provider and tool activity
- WHEN the record is produced
- THEN `provider_attempt_sum_ms` / `provider_union_ms` and `tool_call_sum_ms` / `tool_union_ms` are reported
  separately, plus `agent_activity_union_ms`
- AND the record does not claim these values sum to elapsed time

**Why** — a sum answers "how much provider work happened", a union answers "how much elapsed time was covered
by it". Conflating them was the core error in rev.1.

### REQ-3167-3: A top-level operation is explicitly bounded and owns its child sends

**Behavior**

- GIVEN one user submission
- WHEN the agent performs several continuation sends, retries, or subagent calls
- THEN one `operation_id` is minted at submission and propagated to every child send
- AND the record carries the child `prompt_id` / `turn_id` values it covers, not a single scalar

**Why** — `useSubmitQuery` handles one new user prompt while the Agent drives continuation internally
(`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts:600-604`); `AgenticLoop` derives a new prompt id per
continuation (`packages/agents/src/core/agenticLoop/AgenticLoop.ts:359-410`). One submission is therefore
many turns, and "one perf record joins on one turn_id" is false.

Operation boundaries attach to the existing ownership lifecycle in `useSubmitQuery` (acquire ~`:620-640`,
release ~`:650-659`), **not** to `useStreamingState`, which is derived React display state that excludes
preparation and finalization, gives `WaitingForConfirmation` precedence even while other work is active, and
cannot distinguish a queued-drain gap from human think time
(`packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts:35-76`).

### REQ-3167-4: Ink render cost comes from Ink's own render hook

**Behavior**

- GIVEN a rendered frame
- WHEN render cost is recorded
- THEN it uses Ink's `RenderOptions.onRender`, and the stdout seam contributes only `stdout_bytes` and
  `stdout_write_sync_ms`
- AND write calls are reported as `stdout_write_calls`, never as `frames`

**Why** — Ink computes layout and output before writing and already reports that work via `onRender`. Writes
occur on several branches, can be suppressed, throttled, or split into clear/static/normal passes, so one
write is not one frame. The Proxy in `packages/core/src/utils/stdio.ts:120-131` substitutes only the write
function; a wrapper must delegate to `writeToStdout`, preserve every overload, encoding, callback and the
backpressure boolean, count encoded bytes (`Buffer.byteLength` / `Uint8Array.byteLength`), and be installed on
the interactive instance from `inkRenderOptions.ts` — not globally, because Zed also calls `createInkStdio()`
(`packages/cli/src/zed-integration/runZedIntegration.ts:105-112`).

### REQ-3167-5: Each writer owns its file by construction

**Behavior**

- GIVEN any number of concurrent processes, pid reuse across reboots, or two containers sharing a home
- WHEN perf files are created
- THEN each file is created exclusively (`wx`) with a per-run UUID in its name and has exactly one writer for
  its lifetime
- AND the in-process byte counter is initialised from `stat`, never assumed to be zero

Name: `perf-<YYYYMMDD>-<runUuid>-<nnn>.jsonl` in `Storage.getGlobalLogDir()/perf`. Global, never under
`sha256(projectRoot)`, so it cannot become unreachable the way #3164's directories did; project identity is a
field. Day key from the record's own UTC timestamp so a process idle across midnight rolls on its next write.

### REQ-3167-6: The directory bound is eventual, bounded-overshoot, and enforced without restarts

**Behavior**

- GIVEN a 24/7 process and many concurrent instances
- WHEN records accumulate
- THEN maintenance runs on file-roll boundaries and on a coarse interval, not only at startup
- AND the stated guarantee is an **eventual bound with a documented maximum overshoot**, not an instantaneous
  hard ceiling
- AND maintenance never deletes or archives a file that is still claimed by a live writer

**Why** — a strict instantaneous cap, no record loss, and no cross-process coordination cannot all hold
simultaneously; rev.2 asserted all three. Concurrent appends can overshoot between scan and delete, and N
active files can collectively exceed the ceiling while each is individually under its sub-roll threshold.
Live-writer safety needs an explicit claim: an idle mtime does not prove a 24/7 process is dead, and unlinking
a live writer's file makes already-written records vanish while the next `appendFile` silently recreates the
path.

Note `rotateReports()` (`packages/core/src/utils/errorReporting.ts:354-408`) is a weaker precedent than rev.2
implied: it scans a 20-file / 1 MiB cohort, protects only in-process paths, and decrements its accounting even
when `unlink` fails. Reuse the shape, not the guarantees.

### REQ-3167-7: Failure is explicit and fail-open

**Behavior**

- GIVEN EACCES, EROFS, ENOSPC, or a persistent write failure
- WHEN perf telemetry attempts to write or maintain
- THEN the session is unaffected, diagnostics are rate-limited, and the subsystem disables itself after a
  defined failure threshold
- AND the record queue is bounded with a documented drop policy, flushed on clean exit

A read-only volume cannot be brought under the ceiling — eviction itself cannot run. The guarantee is
therefore "no further growth", not "the cap is enforced".

### REQ-3167-8: Persistent telemetry is opt-in, disclosed, and inspectable

**Behavior**

- GIVEN default settings
- WHEN llxprt runs
- THEN no perf records are written unless the user has enabled the setting
- AND a command can show where the data lives, what fields it contains, and delete it

`docs/telemetry-privacy.md` makes persistent telemetry opt-in and disabled by default; records carry session,
project, provider and model identity, so this is not optional. Also decide the fate of the three retention
getters in `packages/core/src/config/configBaseCore.ts:655-662`, which have no consumers today: wire or remove.

### REQ-3167-9: A supported consumer answers the question

**Behavior**

- GIVEN accumulated perf records across versions
- WHEN the user runs the report command
- THEN it streams plain and gzipped records, dispatches on `schema_version`, tolerates a truncated final line,
  groups by version and commit, compares against a selectable baseline, and reports sample counts and
  contamination
- AND it works on Windows

**Why** — a `gzcat | jq -s` one-liner is not a deliverable: it is macOS-oriented, breaks on argument limits at
thousands of files, and aborts on a malformed line. Without a real consumer this feature accumulates JSONL
nobody reads. The report must also surface **telemetry self-health** (records dropped, queue high-water mark,
last write error, evictions), because otherwise a flat trend is indistinguishable from broken instrumentation.

## Measured facts

Every figure is reproducible from [`benchmarks/`](./benchmarks) on darwin-arm64 / APFS, Bun 1.3.14 and Node
v25.2.1. These are primitive costs, **not** an end-to-end instrumentation budget — see the note below.

| Fact                                       | Value                             | Script            |
| ------------------------------------------ | --------------------------------- | ----------------- |
| `performance.now()`                        | 25.1 ns / 26.6 ns                 | `perfprobe.mjs.txt`   |
| counter increment                          | 1.97 ns / 5.05 ns                 | `perfprobe.mjs.txt`   |
| `process.memoryUsage()`                    | 0.42 us / 0.66 us (idle heap)     | `perfprobe.mjs.txt`   |
| a 33-field flat numeric record              | 688 B — **rejected schema, see below** | `recsize.mjs.txt`     |
| gzip -6 on 2.29 MiB                        | 7.9x in 24 ms                     | `gziptest.mjs.txt`    |
| concurrent `O_APPEND`, 8 writers, APFS     | 12,000/12,000 records, 0 torn     | `appendrace.mjs.txt`  |
| shared file + private byte counter         | 49% of records destroyed          | `rotaterace.mjs.txt`  |
| per-file counter, one writer per file      | 9,600/9,600, 0 over cap           | `perproc.mjs.txt`     |
| archive overwritten by a late record       | 2,000 of 2,001 destroyed          | `boundary2.mjs.txt`   |

**The record-size and retention budgets are withdrawn too.** The 688 B figure prices the **rejected rev.2
field set**, and it is the sole basis for the 64 MiB ceiling, the "~97,000 turns" figure and the "~5 weeks"
estimate. Rev.3's record is strictly larger — five client phases instead of two, sum *and* union pairs plus
`agent_activity_union_ms`, `unclassified_elapsed_ms`, `operation_id`, terminal geometry, render mode, terminal
status. Worse, REQ-3167-3 requires the record to carry the child `prompt_id` / `turn_id` values it covers
rather than a scalar, and those ids look like
`${sessionId}#agentic-loop#${uuid}#continuation#${n}` — roughly 80-110 B each and unbounded in count. A
tool-heavy operation with 30 continuations would add kilobytes, making the record **variable length**, which
breaks the fixed-size arithmetic the eviction design rests on. Recompute the size budget from the real schema
once it exists (Phase 1), and either cap or hash the child-id list.

**The rev.2 "~49 us per turn" budget is withdrawn.** It summed isolated primitive costs and omitted recorder
dispatch, argument evaluation in the disabled path, byte-length work, record allocation and `JSON.stringify`,
promise/microtask cost, roll checks, queue growth, filesystem contention, GC, maintenance scans, and
compression. Phase 0.5 must produce an end-to-end measurement of the built integration, enabled and disabled,
under streaming load, reporting p50/p95/p99 event-loop impact. No overhead claim ships until then.

Likewise the APFS append result establishes the tested filesystem only, and the final design does not depend
on shared-file appends.

### Runtime traps (verified, `perfprobe.mjs.txt`)

| API                                      | Finding                                                   | Decision                    |
| ---------------------------------------- | --------------------------------------------------------- | --------------------------- |
| `PerformanceObserver` gc entries         | Bun accepts `observe()` and yields **0** entries; Node 11  | Do not use — silent no-op   |
| `monitorEventLoopDelay`                  | Bun reports pure delay, Node includes the interval         | Do not use — incomparable   |
| `eventLoopUtilization`                   | Node only                                                 | Unavailable                 |
| `v8.getHeapStatistics().heap_size_limit` | Bun 768 MB vs Node 4.49 GB                                | Do not use — see #3112      |
| self-scheduled drift probe               | median 1.93 / 2.09 ms, identical semantics                | Use, with an owned lifecycle |

The drift probe is **an added timer**, not free piggybacking: existing intervals are 1 s, 2 s and 60 s, and
nothing polls at ~100 ms. Its owner, cadence, `unref`, start/stop, headless and subagent behaviour, and
aggregate cost across many processes must be specified.

## Counters are context, not a gate

rev.2 called `stdout_bytes` and write counts "load-invariant". They are not: React batching, Ink throttling
and coalescing, terminal geometry, screen-reader mode, and the alternate-buffer / incremental settings in
`inkRenderOptions.ts:34-48` all change them. They are valuable **covariates** and must be recorded alongside
terminal width/height and render mode, but they are not a clean regression gate. Similarly
`llxprtMs / turnBusyMs` does not normalise machine speed, because the denominator contains provider, network
and human components that do not scale with local CPU. Comparison is by p50 within matched dimensions
(version, provider, model, render mode, terminal size), with contaminated samples excluded via `contended`.

## Phases

Following `dev-docs/PLAN.md`: preflight first, integration contracts before units, tests before code.

### Phase 0.5 — Preflight verification (blocking)

No implementation until each of these is confirmed in the tree and written up in this directory:

1. Ink's installed version exposes `RenderOptions.onRender` with the expected signature, and
   `inkRenderOptions.ts` can pass it.
2. `useSubmitQuery`'s ownership acquire/release points are stable seams for an operation lifecycle, including
   cancel, pre-send failure, slash commands, direct shell, and queued drain.
3. `operation_id` can be propagated from the UI submission through `AgenticLoop` to every child send.
4. An end-to-end overhead harness exists and reports enabled/disabled cost under streaming load.
5. A settings key and default (disabled) exist per `docs/telemetry-privacy.md`.

### Phase 1 — Schema and writer contract

REQ-3167-5, -7, -8. Record schema with `schema_version`; exclusive-create writer with run UUID; bounded queue;
fail-open with self-disable; opt-in gate. Tests: run-id collision, reopen after restart, clock step backwards
and forwards, EROFS/ENOSPC, abrupt exit leaving a partial line, disabled-by-default.

### Phase 2 — Operation lifecycle and identity

REQ-3167-3. `operation_id` minted and propagated; child `prompt_id`/`turn_id` collected; terminal status for
completed / error / cancelled-before-send / cancelled-during-API / cancelled-during-tool /
cancelled-during-approval / superseded; exactly-once finalisation. Tests: multi-send continuation, retries,
failover, subagents, no-send paths.

### Phase 3 — Directly measured client phases

REQ-3167-1, -2, -4. `client_prepare_ms`, `stream_handler_ms`, `ink_render_ms` (via `onRender`),
`stdout_write_sync_ms`, `stdout_bytes`, `stdout_write_calls`, `client_finalize_ms`; provider/tool sums and
unions; `unclassified_elapsed_ms`. Tests: no phase is negative under a streaming turn; overlapping provider
and tool work does not corrupt any phase; stdout wrapper preserves overloads, encoding, callback and
backpressure.

### Phase 4 — Retention

REQ-3167-6. Roll-triggered and coarse-interval maintenance; live-writer claim; eventual bound with documented
overshoot; count every artifact. Tests: sweep does not touch a claimed live file; concurrent sweeps; failed
unlink does not corrupt accounting; thousands-of-entries scan latency; which of the count and byte caps binds
under observed volume.

### Phase 5 — Consumer

REQ-3167-9. A Bun/TypeScript report command plus a `/perf` view with defined semantics (snapshot of this
process vs longitudinal report — rev.2 said both). Streams plain and gzip, schema dispatch, tolerates a
truncated tail, groups by version/commit within matched dimensions, reports self-health. Tests: mixed schema
versions, malformed and truncated records, thousands of files, Windows.

### Phase 6 — Memory trend (separable)

REQ-3167 memory behaviour is a second feature and may ship as its own PR after Phases 1-5 prove the pipeline:
per-turn and coarse-interval sampling of `rss / heapUsed / external / arrayBuffers`, dual slopes, its own
report path. Memory costs must be re-measured at representative heap sizes rather than idle.

### Phase 7 — Compression (optional, last)

Deferred deliberately. Retention does not depend on it, so it is an optimisation, not a prerequisite, and it
is the riskiest concurrency state machine in the design. If implemented: run-unique scratch, atomic claim of an
immutable source, exclusive no-overwrite publication (existence-check-then-rename is TOCTOU and POSIX `rename`
replaces), stale-scratch cleanup, and generation-grouped eviction so an archive and a late sidecar are evicted
together — rev.2 claimed they would be, but an mtime sort treats them independently.

## Out of scope

- CI perf gating — a separate controlled-benchmark concern; the fixture-replay harness under a PTY is the
  natural vehicle later.
- Tool-level attribution of a slow operation — session recordings contain no tool-call events.
- OTLP export of client-side perf — local JSONL first.
- The session-cleanup and stale-lock defects — #3164.
