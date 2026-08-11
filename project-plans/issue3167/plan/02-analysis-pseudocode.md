# Phase 02: Analysis & Pseudocode

Plan ID: PLAN-20260808-PERFTREND.P02
Prerequisites: P01 (preflight) complete.

Artifacts already produced (finalised in this phase, not rewritten):
- `analysis/domain-model.md` — entities, layering, invariants, state transitions, failure model.
- `analysis/pseudocode/01-schema-and-reader.md` — schema + derivation + tolerant reader.
- `analysis/pseudocode/02-perfsink-and-interval-union.md` — PerfSink + extracted IntervalUnion.
- `analysis/pseudocode/03-stdout-observer.md` — core seam + cli lazy install.
- `analysis/pseudocode/04-operation-lifecycle.md` — registry + identity collection.
- `analysis/pseudocode/05-client-phases.md` — direct measurement + record assembly.
- `analysis/pseudocode/06-retention.md` — eventual bound + live-writer safety.
- `analysis/pseudocode/07-memory-trend.md` — two slopes, zero timers, ring.
- `analysis/pseudocode/08-consumer-and-perf-command.md` — reader/report/perf/settings.
- `analysis/pseudocode/09-overhead-harness.md` — real integration overhead harness.
- `acceptance-criteria.md` — AC-1…AC-12 finite criteria.

## Verification (this phase)

- [x] Every REQ from spec §1–§9 mapped to a pseudocode line range (see overview table).
- [x] Every AC has ≥1 pseudocode reference and ≥1 evidence tag.
- [x] Contradictions vs PLAN.md resolved (operation_id derived; no gzip; no contended;
  no records_dropped; no retry-threshold; compression deferred).
- [x] **Source-verified blockers resolved (D1–D8)** and applied across the
  pseudocode: D1 no child-id arrays + join at read time; D2 nested settings; D3
  claim-file concurrency accounting; D4 PerfSink does not inherit FileOutput's
  bounded/drop queue; D5 retention constants from a P04 benchmark; D6 fs-failure
  testing via a package-private port; D7 report `--baseline`; D8 stdout observer
  fails fast.
- [x] Pseudocode line-numbered; no actual TS implementation written.

Proceed to P03.
