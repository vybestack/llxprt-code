# Plan: Shell tool-call memory retention + secondary unbounded accumulators (#3329)

Plan ID: PLAN-20260825-SHELLMEM
Generated: 2026-08-25
Total Phases: 4 (P0.5 preflight, P01 primary shell leak, P02 secondary accumulators, P03 verification)
Requirements: REQ-3329-01 … REQ-3329-09

## Scope statement

Fix the primary per-shell-execution memory leak (retained Subprocess + ~2.56 MB
collector buffers via the armed inactivity timer) on both the `child_process`
and PTY paths, and bound four secondary unbounded accumulators. A fifth
secondary item (Ink `fullStaticOutput`) requires a dependency change to the
`@jrichman/ink` fork and is PENDING USER DECISION — see REQ-3329-09; do not
implement without explicit approval.

Out of scope: incremental/growth-based collector buffer allocation beyond
lazy-on-first-write; RSS allocator high-water effects (issue records these as
not separately fixable); no public API changes to `ShellExecutionResult`,
`parseShellCommand*`, or collector classes.

## Critical Reminders

1. Phase 0.5 preflight is complete (results recorded below).
2. Tests are written BEFORE implementation (red → green).
3. No mock theater: shell tests spawn real child processes; no `vi.mock`
   fabrications for the code under test. Existing mock-heavy suites are
   grandfathered; new tests must not copy that style.
4. Bun test runner only (`bun test path/to/file.test.ts`). All new files are
   TypeScript. No new .js files, no vitest/node tests.

---

# Phase 0.5: Preflight Verification

## Purpose

All assumptions verified 2026-08-25 on this machine (Bun 1.3.14, darwin arm64).

## Test seam verification (the load-bearing assumption)

The heap-snapshot histogram seam was probed directly (not assumed):

| Probe | Result | Status |
|---|---|---|
| `Bun.generateHeapSnapshot()` shape | `{version, type, nodes, nodeClassNames, edges, edgeTypes, edgeNames}` | OK |
| Flat `nodes` array layout | stride 4; class-name index at offsets `2 + 4k` | OK |
| Known-count check | 7 retained `new Canary()` → class count 7; after drop + `Bun.gc(true)` → class absent (−1) | OK |
| `Subprocess` after 10 retained spawns | 11 (10 + probe noise); after drop+gc: 3 (Bun-internal exited-child references — real noise floor) | OK with threshold ≥ 8 |
| `AbortController` at idle baseline | class absent (−1) — any nonzero count is signal | OK |
| `process.getActiveResourcesInfo` under Bun | stub, returns `[]` | UNUSABLE (avoid) |
| web-tree-sitter `Tree.delete()` | calls `_ts_tree_delete` then sets internal handle `this[0] = 0` — deletable observable | OK |

Counting helper contract for tests (derive, do not hardcode, the stride):

```ts
function countHeapClass(name: string): number {
  const snap = Bun.generateHeapSnapshot();
  const idx = snap.nodeClassNames.indexOf(name);
  if (idx < 0) return 0;
  let c = 0;
  for (let p = 2; p < snap.nodes.length; p += 4) if (snap.nodes[p] === idx) c++;
  return c;
}
```

Because `AbortController` is absent at idle baseline, the primary leak signal
for both CP and PTY paths is `countHeapClass('AbortController')` after N
completed executions with a large `inactivityTimeoutMs` (timer armed, never
fires): before fix ≈ N (timer-rooted, uncollectable), after fix ≈ 0–2.
`Subprocess` and `Uint8Array` counts are secondary assertions with generous
thresholds (≥ 8 after N=40) to absorb the measured noise floor.

## Call path verification

| Path | Verified |
|---|---|
| `ShellExecutionService.execute` → `createCpResultPromise` (CP) / `createPtyResultPromise` (PTY) → `makeInactivityTimer` | YES — `shellExecutionService.ts:130`, `:183`; timer never cancelled anywhere (no `clearTimeout` in `shellCpExecution.ts`/`shellCpHelpers.ts`) |
| CP cleanup: `cleanupCpResources` removes caller abort listener + child listeners only | YES — `shellCpHelpers.ts:131-153` |
| PTY teardown: `teardownPtyState` → `cleanupPtyEntryResources` (destroys PTY + terminal, clears termination/render timeouts) but never cancels inactivity timer / removes inactivity abort listener | YES — `shellPtyLifecycle.ts:181-205`, `shellPtyHelpers.ts` |
| Retainer chain: pending timer (GC root) → callback closure → `controller` → `signal` → abort listener closure → `state` → `child` + `rawCollector` + `sniffBuffer` | YES — heap snapshot walk in issue, confirmed by code read |
| `BoundedCombinedCollector` (shell path) and `BoundedStreamCollector` eagerly allocate head/tail (and stderr bookkeeping) buffers to full budget in constructor | YES — `boundedCombinedCollector.ts` ctor, `boundedStreamCollector.ts:139-146` |
| `seenCallIds` unbounded Set, cleared only in `dispose()`/`cancelAll()` | YES — `coreToolScheduler.ts:126`, `:374-378`, `:205`, `:885` |
| `DedupSet` deliberately unbounded; `IntervalUnion.intervals` uncapped array | YES — `sessionMetricsAggregator.ts:172-186`, `intervalUnion.ts:29-40` |
| `ProviderPerformanceTracker.errors` push uncapped; `errorRate` derived from `errors.length` | YES — `ProviderPerformanceTracker.ts:60`, `:170`, `:180-183`; external consumers only read metrics |
| tree-sitter `Tree` never `.delete()`d; `Query`/`Parser` are | YES — `shell-parser.ts:334-369` (`parseWithTimeout`), `:826`, `:1067`; `:469`, `:865`, `:891`; no `tree.delete()` anywhere in `packages/*/src` |
| Production `parseShellCommand*` consumers: `shell-parser.ts` internal (`:826`, `:1067`) + `shell-utils.ts:196/388/520`; tests use it directly elsewhere | YES — grep 2026-08-25 |
| Ink fork is published npm package (`npm:@jrichman/ink@6.4.8`), no local source, no `patches/` dir | YES — dependency change approval required |

## Blocking issues

None for P01/P02. REQ-3329-09 (Ink) blocked on user decision.

---

# Phase 01: Primary shell leak — timer cancel, listener teardown, state release, lazy collector allocation

## Phase ID

`PLAN-20260825-SHELLMEM.P01`

## Requirements Implemented (Expanded)

### REQ-3329-01: Inactivity timer is cancellable and cancelled on every completion path

**Full Text**: `makeInactivityTimer` MUST expose a `cancel()` that clears the
pending timeout, and both the `child_process` and PTY execution paths MUST
invoke it during teardown (normal exit, caller abort, inactivity-timeout fire,
child/PTY error).

**Behavior**:
- GIVEN: `makeInactivityTimer(25, guard)` with `reset()` called
- WHEN: `cancel()` is called and 50 ms elapse
- THEN: `controller.signal.aborted` is `false`

- GIVEN: `reset()` called, no `cancel()`
- WHEN: 50 ms elapse (timeout 25 ms, guard not exited)
- THEN: `controller.signal.aborted` is `true` (existing abort behavior preserved)

- GIVEN: guard already `markExited()` before `reset()`
- WHEN: timeout elapses
- THEN: no abort (existing behavior preserved)

**Why This Matters**: A pending timer is a GC root; today every completed
execution keeps its entire state graph alive for the timeout duration, and the
never-cancelled pattern leaks it permanently when timeout is large.

### REQ-3329-02: Inactivity abort listener removed on teardown

**Full Text**: The `abort` listener registered on
`state.inactivityAbortController.signal` MUST be removed explicitly during
cleanup on both CP and PTY paths, not left to `{ once: true }` semantics.

**Behavior**:
- GIVEN: N completed shell executions through `ShellExecutionService.execute`
  with `inactivityTimeoutMs` large (e.g. 60 000)
- WHEN: all handles are dropped and `Bun.gc(true)` runs
- THEN: heap `AbortController` count ≤ 8 (before fix ≈ N; noise floor measured 0–3)

**Why This Matters**: The listener closure is the edge from the timer-rooted
signal back to the whole `CpExecState`/`PtyExecState`.

### REQ-3329-03: Heavy state released after result construction

**Full Text**: After the final result is built, CP state MUST drop
`child`, `rawCollector`, and `sniffBuffer` references; PTY state MUST drop
`rawCollector`. (PTY process/terminal disposal already exists in
`cleanupPtyEntryResources`.)

**Behavior**:
- GIVEN: N completed CP executions of `echo hi`
- WHEN: handles dropped + `Bun.gc(true)`
- THEN: heap `Subprocess` count ≤ 8 and `Uint8Array` count returns to near
  baseline (≤ 8 above the pre-loop baseline; before fix ≈ +N collectors)

- GIVEN: N completed PTY executions (PTY actually used — assert the result's
  execution method indicates PTY)
- WHEN: handles dropped + `Bun.gc(true)`
- THEN: heap `AbortController` count ≤ 8 and `Uint8Array` growth vs baseline ≤ 8

**Why This Matters**: A missed teardown path then costs bytes, not megabytes.

### REQ-3329-04: Collector buffers allocated lazily on first write

**Full Text**: `BoundedCombinedCollector` and `BoundedStreamCollector` MUST NOT
preallocate head/tail retention buffers (or per-stream bookkeeping arrays) in
the constructor; allocation happens on first non-empty append. Public API
(`append`, `getResult`, `getHeadText`, `getTailText`, `getBoundedRawBuffer`,
`observedByteCount`, `isTruncated`) unchanged.

**Behavior**:
- GIVEN: 200 constructed collectors with a 512 KiB budget, no appends, refs held
- WHEN: `Bun.gc(true)` + heap snapshot
- THEN: `Uint8Array` count growth vs a no-collector baseline is ≤ 50 (before
  fix ≈ +800: 4 buffers × 200)

- GIVEN: a fresh collector with no appends
- WHEN: `getResult()` / `getBoundedRawBuffer()` are called
- THEN: empty results, `metadata.truncated === false`, observed/retained bytes 0
  (lazy path must not crash)

- GIVEN: a collector appended `'hi'`
- WHEN: `getResult()` is called
- THEN: text round-trips (`'hi'`), existing semantics intact (existing tests
  must keep passing)

**Why This Matters**: A command producing no output currently costs the full
retention budget.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/shellOutputUtils.inactivityTimer.test.ts`
  - Unit tests for REQ-3329-01 (cancel/no-cancel/exited-guard; real timers,
    `bun:test`)
  - MUST include plan/requirement markers per file header + test names
- `packages/core/src/services/shellExecutionService.memory.test.ts`
  - THE model-free leak regression test (REQ-3329-02/03). Runs N=40 real
    `echo hi` executions through `ShellExecutionService.execute` (CP path),
    shared never-aborted `AbortSignal`, `inactivityTimeoutMs: 60_000`; asserts
    every result succeeded (`executionMethod: 'child_process'`, output
    contains `hi`); then drops handles, `Bun.gc(true)` (twice), counts
    `AbortController` (primary), `Subprocess` + `Uint8Array` (secondary).
    Includes a PTY variant (`shouldUseNodePty: true`) asserting the PTY
    execution method to prove the path was exercised, same heap assertions.
    Reuses the validated counting helper; thresholds ≥ 8 documented against
    the measured noise floor.
- `packages/tools/src/acquisition/boundedCombinedCollector.lazy.test.ts` and/or
  extend existing acquisition tests
  - REQ-3329-04 tests (no-append construction cost, no-append `getResult()`
    correctness, appended round-trip)

### Files to Modify

- `packages/core/src/services/shellOutputUtils.ts`
  - `makeInactivityTimer` returns `{ reset, cancel, controller }`; `cancel()`
    clears pending timeout (terminal: later `reset()` no-ops — document in
    JSDoc)
- `packages/core/src/services/shellCpExecution.ts`
  - Destructure `cancel`; thread it and the abort-listener function through
    state so cleanup can use both; remove the inactivity abort listener via
    stored reference (not `removeAllListeners`)
- `packages/core/src/services/shellCpHelpers.ts`
  - `CpExecState`: `child`/`rawCollector`/`sniffBuffer` become nullable;
    `cleanupCpResources` cancels timer, removes inactivity listener; after
    `buildCpExitResult` the caller releases heavy refs. Prefer capturing the
    child in narrow closures/passing parameters over scattered null-checks;
    fail fast rather than defensive re-checks.
- `packages/core/src/services/shellPtyLifecycle.ts`
  - Same teardown wiring in `teardownPtyState`/`makePtyResolveResult`; store
    inactivity listener ref on `PtyExecState`; drop `rawCollector` after
    `buildPtyResult` (make nullable in `shellPtyState.ts`)
- `packages/core/src/services/shellPtyState.ts`
  - Type updates only as required by the above
- `packages/tools/src/acquisition/boundedCombinedCollector.ts`,
  `packages/tools/src/acquisition/boundedStreamCollector.ts`
  - Lazy buffer allocation; `readonly` fields become assigned-on-first-append;
  zero-capacity edge cases preserved

### Required Code Markers

Standard `@plan PLAN-20260825-SHELLMEM.P01` + `@requirement REQ-3329-0X`
markers on every created/modified exported function/class and every test
case, per repo convention. Private helpers carry markers when they directly
implement a requirement's semantics; helpers moved verbatim into a new module
(shell-substitution-syntax.ts) inherit the module-level marker note instead.

## TDD order

1. Write `shellOutputUtils.inactivityTimer.test.ts` (cancel case fails to
   compile/fail — red).
2. Write `shellExecutionService.memory.test.ts`; run on unmodified service →
   counts ≈ N (red, proving the test detects the leak).
3. Write lazy-allocation tests (red).
4. Implement timer `cancel` + wiring + teardown + state release + lazy
   allocation (green).
5. Full existing suites for touched packages stay green.

---

# Phase 02: Secondary accumulators (excluding Ink — pending user decision)

## Phase ID

`PLAN-20260825-SHELLMEM.P02`

## Requirements Implemented (Expanded)

### REQ-3329-05: `CoreToolScheduler.seenCallIds` bounded

**Full Text**: The duplicate-callId suppression set MUST be bounded
(insertion-order FIFO cap 1024) so long sessions do not retain one string per
tool call forever. `dispose()`/`cancelAll()` still clear it. Duplicate
suppression for recent IDs (same batch + reordering window) unchanged.

**Behavior**:
- GIVEN: a scheduler that has processed > 1024 distinct callIds
- WHEN: one more tool call is scheduled
- THEN: the retained set size stays ≤ 1024 (observable via a new schedule of a
  pre-cap callId no longer being suppressed — execute harness per existing
  scheduler tests with a real registry)
- GIVEN: the same callId scheduled twice in one batch
- WHEN: the batch is processed
- THEN: the second is dropped and a warning logged (existing behavior preserved)

**Why This Matters**: Unbounded set grows for the life of the session.

### REQ-3329-06: `SessionMetricsAggregator` dedup sets bounded; `IntervalUnion` capped

**Full Text**: `DedupSet` gains an insertion-order cap (1024) preserving
recent-ID dedup; `IntervalUnion` gains a max-intervals cap (8192) that drops
the OLDEST interval on overflow and adjusts cached duration accordingly
(documented conservative undercount; no gap-bridging).

**Behavior**:
- GIVEN: 2000 distinct attemptIds recorded
- WHEN: an old (pre-cap) attemptId is replayed
- THEN: it is counted again (accepted tradeoff; recent-window dedup intact —
  replaying the newest 1024 still returns `false`)
- GIVEN: 10 000 disjoint intervals added
- WHEN: `count()` is called
- THEN: `count() ≤ 8192` and `durationMs()` equals the sum of retained
  intervals only
- GIVEN: any existing test scenario (≤ 8192 intervals, ≤ 1024 IDs)
- WHEN: metrics are computed
- THEN: results identical to before (no behavior change below caps)

**Why This Matters**: Both structures are session-lifetime unbounded today.

### REQ-3329-07: `ProviderPerformanceTracker.errors` capped, rate exact

**Full Text**: Retained error entries cap at 50 (mirroring
`AttemptRecorder.MAX_RETAINED_ATTEMPTS`), keeping the MOST RECENT 50. A
separate lifetime counter keeps `errorRate` exact
(`totalErrors / (totalRequests + totalErrors)`).

**Behavior**:
- GIVEN: 100 `recordError` calls + 10 successful completions
- WHEN: `getLatestMetrics()` is called
- THEN: `errors.length === 50`, `errors[49]` is the 100th error,
  `errorRate === 100/110`
- GIVEN: fewer than 50 errors recorded (all existing tests)
- WHEN: metrics read
- THEN: identical results to before

**Why This Matters**: Failure-heavy provider sessions currently retain every
error forever.

### REQ-3329-08: tree-sitter `Tree` lifetime owned on all internal sites

**Full Text**: An internal helper (e.g. `withParsedTree(source, fn, timeout?)`
+ language variant) parses, runs the consumer, and calls `tree.delete()` in a
`finally`. All production parse sites convert: `shell-parser.ts` internal uses
(`parseCommandDetails` body, `:1067` site) and `shell-utils.ts:196/388/520`.
Exported `parseShellCommand*` signatures unchanged (tests/external callers own
deletion). Conversion MUST verify each site extracts only plain data (no
`Node`/cursor objects escaping — `Node` holds a tree reference).

**Behavior**:
- GIVEN: `withParsedTree('echo hi', (tree) => { captured = tree; ... })`
- WHEN: the callback returns
- THEN: `captured[0] === 0` (deleted — the observable `Tree.delete()` effect)
- GIVEN: a consumer callback that throws
- WHEN: `withParsedTree` runs
- THEN: the tree is still deleted, and the error propagates
- GIVEN: the existing parser/shell-utils/prompt-transform suites
- WHEN: run after conversion
- THEN: all pass (parse results byte-identical)

**Why This Matters**: web-tree-sitter's Emscripten heap only grows; ~49 KB per
parse never returns without `delete()`.

### REQ-3329-09: Ink `fullStaticOutput` — PENDING USER DECISION (do not implement)

`@jrichman/ink` is a published npm fork (no local source). Options: (a) bun
patch of the installed package, (b) fix upstream fork and bump, (c) defer with
a follow-up issue. Any option is a dependency change → requires explicit user
approval before implementation.

## Implementation Tasks

Files to modify: `packages/agents/src/core/coreToolScheduler.ts` (+ bounded-set
test alongside existing scheduler tests), `packages/telemetry/src/telemetry/`
(`sessionMetricsAggregator.ts`, `intervalUnion.ts`, + tests),
`packages/providers/src/logging/ProviderPerformanceTracker.ts` (+ tests),
`packages/core/src/utils/shell-parser.ts`, `shell-utils.ts` (+ tests).

Each change independently revert-safe; no public metric semantics altered
below caps; no cap implemented as a placeholder — every bounded structure is a
real FIFO/LRU/cap implementation.

---

# Phase 03: Verification cycle + audit

- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`
- Smoke: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- Test audit: `bun scripts/test-audit/scan.ts` diff vs main baseline
- New tests must fail before their fix and pass after (verified during P01/P02
  TDD order), proving they are behavioral, not theater.

## Success Criteria

- Heap `AbortController`/`Subprocess`/`Uint8Array` counts flat across N
  completed executions (CP + PTY), model-free.
- Inactivity timer cancelled + listener removed on all completion paths.
- Four secondary accumulators bounded; behavior identical below caps.
- All suites, lint, typecheck, build, smoke, audit pass.
- PR references `Fixes #3329`; Ink item disposition recorded (pending or
  user-approved path).

## Findings during verification (2026-08-25)

### CP exit-vs-data race (In-scope-Fix, implemented)

Pre-existing: finalizing at `exit` drops stdout `data` still queued behind the
exit event (reproduced with pristine code via stash; exposed by bun-test
scheduling). Fix in `shellCpExecution.ts`: on `exit`/`close`/`error`, defer
finalization until every stdio stream settles (`end` or `close`; Bun does not
always emit `close` for child stdio), bounded by a 500 ms grace timer so a
grandchild holding pipe fds cannot stall resolution. Grace timer and
once-listeners are cleared in `cleanupCpResources`/`finalize` so no new
retention is introduced. Objects that do not implement the Readable settle
contract (test doubles) count as settled, keeping `exit` the prompt
finalization trigger for them.

### bun test runner loses child_process events (environmental, out of scope)

Minimal repro (tmp/verify3329/minimal-cp.bun.test.ts): `spawn` with
`detached: true` under `bun test` intermittently delivers NO events for a
child (no `exit`/`close`/`error`; child confirmed gone from the process
table; in-process watchdog timers never fire). Bun 1.3.14, standalone runs
never affected. Consequence: the leak regression tests drive the production
CP/PTY promise paths through fake child/pty seams (the repo's established
pattern, e.g. shellPtySignal.bun.test.ts) instead of real sequential spawns.
Related: sequentially spawning real bun-pty PTYs wedges the event loop inside
native code (pre-existing on pristine code, iteration 0+). Full
`bun test packages/core/src/services/` on this machine fails 77 tests on
PRISTINE code under concurrent sibling-session load; per-file targeted runs
are the reliable local gate. CI remains the authoritative full-suite gate.

### Heap threshold calibration

PTY fake-pty loop: pre-fix Uint8Array delta = 40 (one per execution);
post-fix residue ~9 (bounded @xterm/headless module caches). Threshold set
to 16. CP fake-child loop: threshold 8.

### Pre-existing cross-file batch interference (environmental)

Running the 10-file CP/PTY service batch (fallback, exitcode, selection,
raceCondition, multibyte, windows.multibyte, boundedAcquisition, terminatePty,
ptySignal, main) yields an identical 91 pass / 13 fail on PRISTINE code
(stash comparison, tmp/verify3329/cpbatch-prefix.log) and with the fix. Every
failing file passes in isolation (boundedAcquisition 11/0, windows.multibyte
5/0, fallback 26/0). Same interference class as the full-suite failure above:
local gate is per-file runs; CI is authoritative.

### Module extraction for lint compliance

`shell-parser.ts` exceeded max-lines (813 counted) after the lifetime helper
split. The heredoc/substitution source-text inspection cluster
(SourceRange, findNamedChild, collectHeredocRedirects, isQuotedHeredocStart,
collectLiteralHeredocBodyRanges, getLiteralRange, isShellSubstitutionStart,
isCommandSubstitutionStart, isProcessSubstitutionStart,
isProcessSubstitutionOperator, containsUnescapedBacktick) moved verbatim to
`packages/core/src/utils/shell-substitution-syntax.ts`, exporting
`hasShellSubstitutionSyntax` and `hasUnrepresentedHeredocBacktickSubstitution`.
Pure functions over (Node, string); no module state; no behavior change
(shell-utils suite 68/0 before and after).

### Drain fix interaction with fake-timer tests

The SIGKILL-escalation fallback test uses vi.useFakeTimers: a real 500 ms
grace timer armed at exit would never fire. Covered by the settle contract
above: bare EventEmitter stdio doubles (no destroyed/readableEnded) count as
settled, so finalization stays synchronous on exit and fake-timer tests are
unaffected (fallback file 26/0, SIGKILL test 0.44 ms).

## Review remediation record (2026-08-25)

Full design review returned FIX-FIRST with three blockers; all were fixed in
the working tree before the final verification cycle:

1. PTY caller-abort listener leak on synthetic resolution (no exit event):
   added `callerAbortHandler` capture on PtyExecState; teardownPtyState
   removes it on every resolution path. Regression:
   shellPtyTeardown.paths.bun.test.ts (fails at HEAD, passes post-fix).
2. Staggered abort/inactivity kill chains surviving teardown:
   teardownPtyState now calls exitedGuard.markExited() first so in-flight
   chains stop at their post-sleep re-checks; schedulePtyAbortFallback is
   single-owner (clears any prior abortFinalizeTimeout) and re-checks
   hasResolved plus a fire-time aborted getter before buildPtyResult.
3. child_process drain listeners lingering on end-without-close settlement:
   onSettled detaches both stream listeners before deleting the map entry.

Should-fix items closed alongside: heap-counter layout canary (throws on
unexpected snapshot encoding instead of silently reporting 0),
getLatestMetrics returns a copied errors array (snapshots stay intact after
the 50-error trim; covered by a snapshot-immunity test), seenCallIds cap
test extended to prove the retained boundary neighbor stays suppressed, and
the marker policy above was clarified (REQ range corrected to 01-09).

Pre-fix validation: the teardown regression files were run against HEAD via
git stash (visible pop, verified). The PTY listener-leak test fails at HEAD
as intended; the remaining cases protect new invariants that do not exist at
HEAD (drain listeners, collector nulling), so they pass there trivially.

## Round-2 review remediation record (2026-08-25)

Second full design review returned FIX-FIRST with two blockers; both fixed:

1. seenCallIds FIFO eviction mid-batch: [A, 1024 distinct IDs, A] executed
   both A copies because the first A left the 1024-entry window before the
   final A was checked. deduplicateRequests now also dedups against a
   batch-local Set while retaining the capped session window. Regression
   (coreToolScheduler.seenCallIds.test.ts) fails with the batch-local check
   removed and passes with it (surgically validated).
2. ptyExitRace's temporary caller-abort listener could outlive a
   fallback-first resolution while output processing stayed pending,
   rooting the execution's closure graph on a shared signal. The detacher
   is now stored as PtyExecState.exitRaceCleanup and teardownPtyState
   invokes it. Covered by an exit-vs-fallback overlap guard in
   shellPtyTeardown.paths.bun.test.ts; the exact fallback-first-with-pending-
   processing interleaving additionally requires a stalled terminal write
   callback, which public test seams cannot construct with the real
   @xterm/headless terminal, so the teardown detacher itself is the
   defense.

Also removed stray test-audit report artifacts (file-stats.tsv,
findings.tsv) that an earlier scan run had written into
packages/core/src/services/, narrowed the PTY post-resolution test to the
observable no-throw/listener-detachment behavior, and corrected a
below-cap comment in sessionMetricsAggregator.advanced.test.ts.

Deferred (nice-to-have, follow-up): shell-parser.ts and
shell-parser-lifetime.ts form a runtime import cycle that today's deferred
calls keep safe; moving raw parse primitives into a leaf module would
remove the load-order sensitivity.

## OCR local review record (2026-08-25, run 20260825T220905Z-374bfa05)

StepFun step-3.7-flash via ocr-review-local workspace scope; status
complete, 28 files reviewed, 9 findings. Dispositions:

- Fixed: unreachable oldest-done guard in rememberCallId simplified to a
  direct eviction; dead CpExecState.child field removed (never read after
  the refactor — child flows as a closure parameter); inactivity-timer
  tests given CI-safe margins (100ms/400ms) plus the missing
  reset-postpones-a-partially-elapsed-timer contract test; non-null
  collector assertions replaced with a null-guarded helper in
  shellPtyExecution.bun.test.ts; the process.kill spy no longer restores
  between tests (restore detached it and let real group signals escape in
  later tests); tree-lifetime tests now assert the live handle is a
  nonzero pointer that becomes 0 only after delete() runs, instead of a
  bare 0 that could reflect a never-deleted tree.
- Dismissed (evidence): "stale exit code during drain grace" — the
  error-first-then-exit sequence keeps the error's exit code on purpose;
  a Node 'error' event means the execution did not end cleanly, so
  last-wins would mask real spawn/kill failures.
- Deferred: unref() on the drain grace timer (a bounded 500ms wait is the
  designed contract; unref changes settling semantics when no other
  handles keep the loop alive) and the shell-parser import cycle (already
  recorded above).
