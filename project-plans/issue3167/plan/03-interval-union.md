# Phase 03: IntervalUnion extraction (incremental duration)

Plan ID: PLAN-20260808-PERFTREND.P03
Prerequisites: P02.
Package: `telemetry`. @pseudocode: `02-perfsink-and-interval-union.md` lines 10-35.

## Why first
Foundation: both `SessionMetricsAggregator` (provider/tool unions) and the perf
recorder (provider/tool/agent-activity unions) need it. Extracting first unblocks
04 and 07 with the quadratic bug fixed.

## Stub
- Create `packages/telemetry/src/telemetry/intervalUnion.ts` exporting `IntervalUnion`
  (methods throw `new Error('NotYetImplemented')` or return typed empty:
  `durationMs()=>0`, `count()=>0`, `add()=>{}`, `union()=>new IntervalUnion()`).
- No reverse tests.

## Integration TDD (Bun, real behaviour)
- `intervalUnion.behavior.test.ts`:
  - EVIDENCE-AC5a: `add` of disjoint intervals ⇒ `durationMs` = sum, `count` grows.
  - Overlapping/adjacent intervals merge; duration does **not** double-count overlap.
  - Nested interval fully inside another ⇒ no duration change.
  - After N inserts, `durationMs()` is O(1) and equals a brute-force recompute
    (proves incremental correctness, not the algorithm).
  - `union(a,b)` merges two sets correctly.
- Refactor `SessionMetricsAggregator` to import `IntervalUnion`; existing session
  metrics tests stay green (proves the extraction preserves semantics).

## Impl (pseudocode 02 lines 10-35)
- `cachedDurationMs` maintained incrementally: on merge, subtract removed spans,
  add merged span. No full `recomputeDuration()` walk per `add`.
- Implemented in `packages/telemetry/src/telemetry/intervalUnion.ts`. `add()`
  binary-searches the insert position, computes the merge range `[from, to)`,
  and adjusts `cachedDurationMs` by `mergedSpan - sum(removedSpans)` only — no
  re-walk. `durationMs()` returns `cachedDurationMs` (O(1)). `add()`/`union()`
  are the public API; internals (`intervals`) are not exposed for tests.

## Verify
- [x] `bun test` for telemetry package green; existing sessionMetricsAggregator tests green.
- [x] typecheck/lint clean; no eslint-disable / suppression.
- [x] No duplicate class; existing file UPDATED.

## Behavioral evidence (post-implementation)
- Test file: `packages/telemetry/src/telemetry/intervalUnion.behavior.test.ts`
  (Bun / `bun:test`, 21 tests, 61 expect() calls, all pass).
- EVIDENCE-AC5a: disjoint `add` sums durations and grows `count()`.
- Overlapping intervals merge (overlap counted once); adjacent/touching
  intervals merge (`[0,10)+[10,20)` => 20ms, count 1); nested interval adds
  zero duration.
- Incremental correctness: `durationMs()` equals an independent brute-force
  recompute after every insert across mixed, 250-disjoint, and out-of-order
  overlapping sequences.
- `union(a,b)` merges two sets and does not mutate operands.
- Degenerate/zero-length/negative/non-finite intervals ignored; `clear()`
  resets; `latestEnd` tracked.
- `SessionMetricsAggregator` refactored to import the extracted class; its
  existing 77 tests (`sessionMetricsAggregator.test.ts` +
  `sessionMetricsAggregator.advanced.test.ts`) stay green, proving extraction
  preserved interval semantics.
- Combined run: `bun test sessionMetricsAggregator*.test.ts
  intervalUnion.behavior.test.ts` => 98 pass, 0 fail.

### Commands run and results
- `bun test src/telemetry/intervalUnion.behavior.test.ts` (RED first: module
  not found while class was private) => then 21 pass, 0 fail.
- `bun test src/telemetry/sessionMetricsAggregator.test.ts
  src/telemetry/sessionMetricsAggregator.advanced.test.ts
  src/telemetry/intervalUnion.behavior.test.ts` => 98 pass, 0 fail.
- `tsc --noEmit` (packages/telemetry) => EXIT=0.
- `eslint` over the 4 touched source files => EXIT=0 (no eslint-disable /
  suppression directives added).
- `prettier --check` over touched files + package.json => all match.
- `git diff --check` => clean (no whitespace errors).
