# Phase 12: Integration wiring + overhead harness

Plan ID: PLAN-20260808-PERFTREND.P12
Prerequisites: P06, P07, P10, P11.
Package: `cli`. @pseudocode: `09-overhead-harness.md` lines 10-64.

## Goal
Wire the recorder into the real CLI operation path end-to-end (settings → observer
install → lifecycle → record → sink → retention), and prove the observer effect
with a real Bun harness.

## Integration TDD (Bun, REAL integration — NO mocks of recorder/sink/observer)
- `overheadHarness.behavior.test.ts` (EVIDENCE-AC12):
  - Runs a streaming-load scenario through the REAL integrated pipeline twice:
    perf ENABLED and DISABLED.
  - PRINTS p50/p95/p99 per-op overhead for both + delta (evidence, not a gate).
  - ASSERTS stable invariants only:
    - disabled ⇒ no perf file created; no observer installed; no ring allocated.
    - enabled ⇒ record count == operation count.
    - disabled path produces zero side-effects (architectural guarantee).
  - Does NOT assert a wall-clock µs threshold.
- `endToEnd.behavior.test.ts` (EVIDENCE-AC1, AC2, AC4 — integration spine):
  - Full default-off run ⇒ no files, no claim file.
  - Full enabled run ⇒ records on disk joinable to identity at read time (D1 —
    no child ids on the record); superseded recorded; `concurrent_instances`
    reflects claim files (D3); PerfSink uses the no-drop serialized chain (D4).

## Impl (pseudocode 09 lines 10-64)
- Wire `resolvePerf` → observer install (`setInteractiveStdoutObserver`) →
  registry construction → onRender wiring → sink + retention. Disabled path
  short-circuits before any construction.

## Verify
- [ ] AC-12 evidenced; no wall-clock assertion; real integration.
- [ ] No mock theater (real PerfSink/observer/lifecycle).
- [ ] Disabled path has zero side-effects.
- [ ] typecheck/lint clean.
