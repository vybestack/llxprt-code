# Phase 10: Memory trend (zero new timers, ring, two slopes)

Plan ID: PLAN-20260808-PERFTREND.P10
Prerequisites: P06, P09.
Package: `cli`. @pseudocode: `07-memory-trend.md` lines 10-93.

## Stub
- `MemoryRing` (fixed-capacity overwrite) + extended `useMemoryMonitor` sampling
  hook (throw/empty).

## Integration TDD (Bun, real behaviour)
- `memoryRing.behavior.test.ts` (EVIDENCE-AC11):
  - Push M > CAPACITY samples; assert ring length == CAPACITY and the oldest were
    overwritten (snapshot oldest→newest).
- `useMemoryMonitor.behavior.test.ts` (EVIDENCE-AC11):
  - After a warning fires, the interval is STILL active (warn-once latch separated
    from the sampling loop — the self-`clearInterval` defect is fixed).
  - No NEW timer is created (assert only the existing 60 s interval exists).
- `memoryTrend.behavior.test.ts` (EVIDENCE-AC10):
  - Memory **off** ⇒ operation records OMIT memory columns (field absent, not 0)
    and NO `memory_sample` rows are written; monitor reverts to warn-only.
  - Memory **on** ⇒ operation records carry the four columns; `memory_sample` rows
    carry `uptime_ms` + `ms_since_last_operation`.
  - Reader derives TWO slopes: per-operation on `session_operation_index`;
    per-minute on `uptime_ms` using sample rows; idle samples
    (`ms_since_last_operation` large) expose the #3114 leak signature.
  - Assert slopes are DERIVED at read time (no stored slope field on any record).

## Impl (pseudocode 07 lines 10-93)
- Extend the 60 s interval (no new timer); separate latch from sampling; push to
  fixed-capacity ring; emit `memory_sample` when perf+memory on; memory columns
  ride the operation record (omit when off); slopes derived at read time.

## Verify
- [ ] AC-10, AC-11 evidenced.
- [ ] Zero new timers (Footer 2 s interval NOT used).
- [ ] Memory-disabled ⇒ fields absent (not zero).
- [ ] Ring fixed-capacity; monitor continues after warning.
- [ ] typecheck/lint clean.
