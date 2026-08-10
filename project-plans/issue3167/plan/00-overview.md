# Plan Overview — Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167
Milestone: 0.11.0
Phases: 01 → 13 (sequential, no skips)

> Binding design record: `specification.md` (§1–§9). `PLAN.md` requirements are
> reconciled here against spec §9; where broader, the spec's reduced delivery
> wins. Acceptance: `../acceptance-criteria.md`. Analysis:
> `../analysis/domain-model.md`, `../analysis/pseudocode/0[1-9]-*.md`.
> Execution status: `../execution-tracker.md`.

## Phase sequence (mandatory execution order)

| Phase | Title | Pseudocode | ACs | Package(s) |
|---|---|---|---|---|
| 01 | Preflight verification (findings) | — | — | all (read-only) |
| 02 | Analysis & pseudocode (finalise) | 01–09 | — | — |
| 03 | IntervalUnion extraction (incremental duration) | 02 lines 10-35 | AC-5 | telemetry |
| 04 | Schema + PerfSink + tolerant reader + record-size benchmark | 01 lines 10-115; 02 lines 50-108 | AC-1, AC-2, AC-3(join), AC-8 | telemetry |
| 05 | Stdout observer seam + Ink onRender wiring | 03 lines 10-58; 05 lines 20-26 | AC-6 | core, cli |
| 06 | Operation lifecycle registry + identity | 04 lines 10-66; 01 lines 60-66 + 104-115 | AC-3, AC-4 | cli |
| 07 | Client phase measurement + record assembly | 05 lines 10-74 | AC-5 | cli |
| 08 | Retention (eventual bound, live-writer safe, claim files) | 06 lines 10-72 | AC-7 | telemetry |
| 09 | Settings (opt-in, default-off, nested — D2) | 08 lines 10-24 | AC-2 | core config |
| 10 | Memory trend (zero new timers, ring, slopes) | 07 lines 10-93 | AC-10, AC-11 | cli |
| 11 | Reader/consumer + report + /perf + inspect + delete | 08 lines 30-99 | AC-9 | telemetry, cli |
| 12 | Integration wiring + overhead harness | 09 lines 10-64 | AC-12 | cli |
| 13 | Final verification (whole-suite + manual smoke) | — | all | all |

> **Resolved decisions (D1–D8)** are applied across AC/domain/pseudocode/phase
> artifacts; see `acceptance-criteria.md`. P03 remains COMPLETE. P04 first adds a
> Bun record-size benchmark (D5) whose output P08 uses to derive retention
> constants.

## TDD cycle within each implementation phase (03–12)

Each implementation phase follows integration-first TDD:
1. **Stub** — minimal skeleton that compiles (throws `NotYetImplemented` or typed
   empty); no reverse tests; update existing files, never parallel versions.
2. **Integration TDD** — write the integration behavioral test FIRST (real files,
   real pipeline) that the stub fails naturally.
3. **Impl** — implement to pseudocode line ranges; make the integration test pass.
4. **Verify** — run phase tests, typecheck, lint, deferred-impl detection;
   no `eslint-disable`/`@ts-*`/severity downgrades (fix design instead).

## Hard constraints (carry into every phase)

- No dependency/workflow/lint/complexity/source-size/quality-tool changes beyond
  what the settled spec requires; no settings unrelated to perf.
- No `eslint-disable`, TS suppression directives, severity downgrades, complexity
  threshold increases, or ignore exclusions — fix the underlying design.
- All new tests are Bun / `bun:test`, behavioral, integration-first, proving real
  outputs/state/files (no mock theater). No new JS/Vitest/Node tests.
- `packages/agents` is untouched (no telemetry edge; operation_id derived; no
  child-id arrays on the record — D1).
- Fail-fast in-process (incl. the stdout observer — D8); defensive parsing ONLY
  for external JSONL/filesystem.
- Retention = eventual bound + live-writer safety + claim-file accounting (D3),
  not instantaneous no-loss cap; explicitly permits active-day/claim overshoot (D5).
- Persistent perf telemetry opt-in/default-off (`telemetry.perf.enabled` — D2,
  not a boolean), inspectable, deletable.
- PerfSink does NOT inherit FileOutput's bounded/drop queue (D4); serialized
  no-drop promise chain; no gzip; no size sub-rolling.
- fs-failure tests use a package-private port / failing file handle, never
  real-disk fill or chmod (D6).
- Report `--baseline` is an exact version/sha; unmatched groups never pooled (D7).
- Memory sampling adds no timer (uses existing 60 s monitor); memory-disabled ⇒
  fields omitted, not zeroed.

## Sequential execution order (practical)

```
01 (preflight) → 02 (analysis) → 03 (IntervalUnion)
  → 04 (schema+sink+reader)        [foundation; depends on 03]
  → 05 (stdout observer/onRender)   [core seam; parallel-safe with 04]
  → 09 (settings)                   [gates 06/10/11; do before wiring]
  → 06 (lifecycle/identity)         [depends on 04, 09]
  → 07 (client phases)              [depends on 05, 06]
  → 08 (retention)                  [depends on 04]
  → 10 (memory trend)               [depends on 06, 09]
  → 11 (reader/consumer/perf)       [depends on 04, 09]
  → 12 (integration + overhead)     [depends on 06,07,10,11]
  → 13 (final verification)
```
03, 05, 09 may be developed in parallel once 04's schema lands; the registry
(06) is the integration spine everything hangs off.
