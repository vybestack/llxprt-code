# Plan: Content added mid-compression is silently wiped by the compression rebuild's queued clear()

Issue: #3264
Branch: `issue3264`
Labels: packages/core, Context Management, recoverability

## Problem (verified at HEAD)

`HistoryService.add()` and `clear()` queue their operations when
`isCompressing` is true; `endCompression()` flushes the queue FIFO. The
compression rebuild itself runs through that queue: `applyCompressionWithAnchor`
(`packages/agents/src/compression/cacheAnchor.ts:94-97`) and the enforcer
rebuilds (`pendingContextWindowEnforcement.ts:458`,
`providerContentEnforcement.ts:647+`) call `historyService.clear()` and then
`add()` per retained entry while the lock is still held.

When a streaming `add()` arrives before the rebuild is queued, the flush order
is `add(mid)` → `clear()` → `add(retained…)`, so the queued clear destroys the
mid-turn content. It is not in history afterwards, and because
`RecordingIntegration` suppresses `contentAdded` for the whole compression
window (until `compressionLockReleased`, which fires after the flush), it was
never written to the session file either. Replay of the session file cannot
recover it: a `compressed` record resets replay history to `[summary]`, so any
content record would have to come after it to survive.

`applyCompressionWithAnchor` reads `getRawHistory()` at call time, before its
own queued `clear()` executes, so the mid-turn content is not in the snapshot it
rebuilds from either — the wipe is not repairable by "rebuilding better".

Probe at HEAD (real `HistoryService` + `RecordingIntegration` +
`SessionRecordingService`, `tmp/issue3264/probe.ts`), exactly the issue's
reproduction:

- history after `endCompression`: `[{speaker: 'human', seq: 1}]` — the `mid`
  tool call is absent.
- recorded content events: 1 (the pre-compression human entry only).

Related: #3263 introduced `compressionLockReleased` (emitted after the queue
drain so flushed rebuild content stays inside the suppression window). That
design deliberately suppresses ALL flushed content, which is correct for
rebuild entries (they must not produce duplicate records — #3132 territory)
but wrong for streaming entries, which have never been recorded at all.

## Fix direction

Fix at the queue level inside `HistoryService` — the only place that can tell
the rebuild's clear from streaming content without changing any public
interface. All rebuild paths (cacheAnchor + both enforcers) route through
`clear()`/`add()` on the locked service, so one queue-level fix protects them
uniformly.

`endCompression()` partitions the pending queue at the FIRST queued `clear()`:

- **Rebuild phase** — the clear and everything queued after it. Flushes first.
  Its `contentAdded` events stay inside the recording suppression window
  (unchanged: rebuilt entries must not create duplicate records).
- **Streaming phase** — operations queued before the first clear. These ran in
  the compression window but were never recorded; flushing them AFTER
  `compressionLockReleased`/`compressionEnded` means recording captures them,
  and their content records land after the `compressed` record so replay
  preserves them.

No `RecordingIntegration` code change is needed: suppression already lifts on
`compressionLockReleased`; the fix only changes when the events fire relative
to the two flush phases.

Ordering rationale: every entry in the rebuild snapshot predates every queued
streaming entry (streaming adds queue during the window and never reach
`history` before the flush), so `[rebuild…, streaming…]` is the chronologically
correct final order. It also keeps tool pairing intact: a mid-window
`tool_response` lands after the rebuilt tail that contains its call.

## Accepted behavior (acceptance criteria)

### AC-1: Mid-compression content survives the rebuild in history

Real `HistoryService`: `add(human)`; snapshot `retained = getCurated()`;
`startCompression()`; `add(mid)`; `clear()`; `add(retained…)`; 
`endCompression(summary, 1)`. Final history must be
`[retained…, mid]` — the mid entry present and positioned after every rebuild
entry. (Issue reproduction; today the mid entry is absent.)

### AC-2: Queued adds with no rebuild still all apply (no clear queued)

`startCompression()`; N×`add(queued-i)`; `endCompression()` (argless) → history
is `[queued-0 … queued-N-1]` in queue order. (Existing #2852 behavior, guarded
against regression.)

### AC-3: Rebuild entries stay inside the recording suppression window

With a rebuild queued (`clear` + re-adds), every rebuild `contentAdded` fires
before `compressionLockReleased`; the session file gains no `content` records
for rebuilt entries (one `compressed` record when a summary is provided). This
preserves the #3263/#3132 no-duplicate-records property.

### AC-4: Mid-compression streaming content is recorded after the compressed record

Real `HistoryService` + `RecordingIntegration` + `SessionRecordingService`
(issue reproduction at full stack): after `endCompression(summary, 1)` the
session file contains a `compressed` record followed by a `content` record for
the mid entry, and replaying the file yields history that contains the mid
entry. Rebuild entries produce no `content` records. This supersedes the
current behavior enshrined in
`RecordingIntegration.core.test.ts` ("records applied compression with an
argless-queued add still suppressed"), which asserts the streaming entry is
dropped from the session file — that expectation encodes this issue's bug and
is updated by this fix.

### AC-5: Streaming flush happens after lock release for the no-rebuild window too

`startCompression()`; `add(during)`; `endCompression(summary, 3)` (no clear
queued) → the `during` entry is recorded as a `content` record positioned after
the `compressed` record, and is present in history.

### AC-6: Event contract around the two flush phases

`endCompression()` emits `compressionLockReleased` (always) and
`compressionEnded` (only with summary + itemsCompressed) between the rebuild
flush and the streaming flush. `contentAdded` for rebuild entries precedes both
events; `contentAdded` for streaming entries follows them. The existing
compression-locking test that asserted flushed `contentAdded` precedes
`compressionLockReleased` is updated: that ordering remains true for rebuild
entries (new dedicated assertion) and is deliberately changed for streaming
entries (AC-4/AC-5).

## Boundary cases

- Clear queued at position 0 (no streaming adds before it): flush is identical
  to today (all ops, then events, then empty streaming phase).
- Multiple clears queued (enforcer restore retries): partition at the FIRST
  clear; everything from it is rebuild phase. Deterministic and
  content-preserving.
- Streaming adds queued AFTER rebuild adds (synthetic only: the apply →
  `endCompression` path is a synchronous microtask chain, so no macrotask
  streaming chunk can interleave): they flush in the rebuild phase — applied to
  history, not recorded. Documented, not solved; unreachable on the production
  path.
- Zero-block/invalid content queued mid-window: rejected by `addInternal`
  exactly as today; the fix does not change acceptance rules.
- Token accounting: flush order change does not alter accounting (clear resets,
  adds accumulate via the existing async path).
- Session-reset clears (`ConversationManager.clearHistory`/`setHistory`,
  `client.resetChat`) run outside compression windows in production; if one
  ever ran inside a window, preserving queued content under the "never drop"
  guarantee is the intended semantic.

## Tests (TDD — all RED first)

1. `packages/core/src/services/history/compression-locking.test.ts` — extend:
   - AC-1: mid-compression add + queued rebuild clear/adds → history
     `[retained…, mid]` (probe scenario at HistoryService level).
   - AC-6: rebuild `contentAdded` before `compressionLockReleased` /
     `compressionEnded`; streaming `contentAdded` after (replaces the
     ordering asserted by the #3263-era test).
2. `packages/core/src/recording/RecordingIntegration.core.test.ts` — extend:
   - AC-4: issue reproduction at the full recording stack, asserting the
     `compressed`-then-`content` file order and a ReplayEngine round trip that
     retains the mid entry.
   - AC-5: no-clear window records the queued entry.
   - Update the enshrined-behavior test to the corrected contract.
3. `packages/core/src/services/history/HistoryService` queue tests: AC-2
   already covered by the existing #2852 test (must stay green).

## Implementation sketch (HistoryService.ts only)

- `pendingOperations`: `Array<() => void>` →
  `Array<{ kind: 'add' | 'clear'; execute: () => void }>`.
- `queueCompressionOperation(operation, kind)` — `add()` passes `'add'`,
  `clear()` passes `'clear'` (only two call sites).
- `endCompression()`:
  1. `isCompressing = false`; take the queue.
  2. Partition at first `kind === 'clear'`: rebuild = from it onward,
     streaming = the prefix.
  3. Execute rebuild ops.
  4. Emit `compressionLockReleased`; emit `compressionEnded` if summary-shaped.
  5. Execute streaming ops.
- No changes to `applyCompressionWithAnchor`, `RecordingIntegration`, event
  types, or any public signature. `dispose()`/high-water accounting adapt to
  the tagged queue shape only.

## Out of scope

- #3132 duplicate content records.
- Replay fidelity of rebuild entries beyond existing `compressed` semantics
  (replay resets to `[summary]`; preserved head/tail detail is not replayed —
  pre-existing).
- Any change to `RecordingIntegration` or the enforcers.
- Streaming adds queued after rebuild adds (see boundary cases).

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, smoke test with
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`,
plus `bun scripts/test-audit/scan.ts` diffed against a main baseline for the
touched test files.

## Implementation outcome (2026-08-25)

- `packages/core/src/services/history/historyCompressionQueue.ts` (new):
  `CompressionOperationQueue` owns the tagged queue (`kind: 'add' | 'clear'`)
  and the two-phase `flush(betweenPhases)` partitioned at the first queued
  `clear` (#3264). Plain FIFO when no clear is queued (#2852). This extraction
  follows the sibling-helper convention (historyMutationFailure.ts et al.) and
  was forced by the repo `max-lines: 800` gate: HistoryService.ts sat at
  exactly 800 effective lines at HEAD, so the fix had to live in a helper to
  keep the size gate intact (no lint policy weakened).
- `HistoryService.ts` (797/800 effective lines): `pendingOperations` is a
  `CompressionOperationQueue`; `queueCompressionOperation(kind, operation)`;
  `endCompression()` flushes rebuild phase → emits
  `compressionLockReleased` (always) and `compressionEnded` (conditional) →
  flushes streaming phase. No other semantics changed.
- `HistoryService.idnormalization.test.ts`: the dispose test poked
  `pendingOperations` through a cast; it now queues real content via the
  public API (`startCompression` + `add`) and asserts behaviorally that
  `endCompression()` after `dispose()` does not resurrect queued content.
  Touched because the field's type changed; also aligns with the
  test-behavior-not-internals rule. A temporary `push()` array-compat alias
  on the queue was rejected and removed (fail-fast preference: no shim for a
  private-poking test).

## Post-implementation correction (orchestrator self-review)

Self-review of the subagent's lint-compliance refactor caught an unauthorized
semantic change: it had dropped the `runSynchronousHistoryMutation` wrappers
inside the queued `add`/`clear` closures (to save lines), which would have let
flushed operations bypass mutation serialization against in-flight async
mutations (e.g. `replaceAllInternal` reassigning `this.history` wholesale).
Restored both wrappers. To pay the line budget, the #2852 high-water reporting
moved into `CompressionOperationQueue` (constructor callback + default 4096,
reset per flush) — semantics unchanged, and the queue concern now fully owns
its policy. HistoryService.ts is 792/800 effective lines, eslint clean.
Local evidence: 2106 tests across history/ + recording/ suites, 0 fail.

## Verification results (2026-08-25, full cycle in tmp/issue3264/verify-full2.log)

- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run format` — exit 0; `git status` confirms format touched no extra files.
- `npm run build` — exit 0.
- `npm run test` — exit 1 caused by 8 timeouts (7×180s, 1×30s, one twice) in
  agents API / cli specs under concurrent sibling-session load:
  disposal.spec.ts T1, mutationCoverage.behavior.test.ts P23.c (×2),
  capabilityGaps.integration.spec.ts P20, policyControl.behavior.test.ts T4,
  scheduler-factory.spec.ts T19, workspaceControl.behavior.test.ts
  getDirectories, terminalTheme.test.ts Interactive TTY. Every one passes in
  isolation on this branch (12/12, 22/22, and 86/86 across the five remaining
  specs — tmp/issue3264/retest-*.log). No assertion failures anywhere; the
  history/recording suites (2106 tests) are green. None of the flaky specs
  touch the changed code.
- Smoke test — blocked by the provider: deterministic
  `400 you have no active step plan subscription` from the stepfun-37 profile
  (two runs). Startup, profile load, and client init all work; the failure is
  an account-level error, not a code change effect.
- test-audit scan — no new findings vs the main baseline; the only diff is a
  line-number shift of two pre-existing findings in an untouched test
  (tmp/issue3264/scan-diff.txt).

## Review round 1 remediation (deepthinker, 2026-08-25)

Findings triage: HIGH "inter-phase events bypass history-mutation
serialization" → Blocker-Fix; HIGH "betweenPhases listener throw discards the
streaming slice" → Blocker-Fix; MEDIUM "listener can re-entrantly start
compression mid-flush" → Defer (no production listener starts compression from
these events; a guard would be speculative hardening).

Fixes (TDD, both regression tests RED first):

- `HistoryService.endCompression()` now routes the
  `compressionLockReleased`/`compressionEnded` emission through
  `runSynchronousHistoryMutation`, so the events occupy the same mutation FIFO
  slot as the dequeued closures. When an async mutation (e.g. `replaceAll`) is
  in flight, the drain order is rebuild ops → events → streaming ops, keeping
  rebuild `contentAdded` inside the recording suppression window unconditionally.
- `CompressionOperationQueue.flush()` captures a `betweenPhases` throw, still
  applies the streaming slice, then rethrows — a lifecycle-listener failure can
  no longer discard queued content (the pre-change code applied operations
  before emitting, so nothing was lost; parity restored).

Regression tests added in `compression-locking.test.ts`:
`deferred asynchronous mutation ordering` (blocked-tokenizer `replaceAll` held
across the window; asserts rebuild contentAdded → lock release → end →
streaming contentAdded, and final history) and `listener throw during flush`
(asserts the rethrow AND that the streaming entry survives).

Post-remediation targeted evidence: history/ + recording/ suites
1057 pass / 0 fail (67 files); eslint + prettier + core typecheck clean.

Known deferred follow-up: an inter-phase event listener that synchronously
calls `startCompression()` could re-open recording suppression for the old
streaming slice. No production listener does this; recorded here for a future
hardening pass if one ever does.

## Review round 2 (deepthinker, remediated tree)

Verdict REQUEST_CHANGES with one HIGH and one MEDIUM; both fixed.

- HIGH "rebuild-phase failure discards the streaming slice": the rebuild slice
  ran outside the round-1 error capture, so a listener throwing inside a
  rebuild op (e.g. `tokensUpdated` from `clearInternal`'s emit) aborted
  `flush()` before `compressionLockReleased` and before the streaming slice —
  and since the queue was already emptied, the streaming operations were
  permanently lost. This is a regression vs the pre-change FIFO, which applied
  streaming adds BEFORE the rebuild clear (a rebuild throw could not destroy
  them). Confirmed by the reviewer with a real HistoryService probe.
  Triage: Blocker-Fix.
- MEDIUM "`throw undefined` swallowed": `betweenPhasesError !== undefined`
  cannot distinguish "no throw" from a legal `throw undefined`.
  Triage: In-scope-Fix (the tagged-failure design the HIGH fix requires
  eliminates the sentinel as a side effect).

Fix (TDD, both regression tests RED first for the diagnosed reasons):

- `CompressionOperationQueue.flush()` now attempts EVERY unit — each rebuild
  operation, the `betweenPhases` callback, and each streaming operation —
  under its own failure capture, accumulating failures with the existing
  `combineMutationFailures` tagged representation and rethrowing the combined
  error only after all units have been attempted (first failure wins; multiple
  failures become an `AggregateError`). This mirrors how
  `runSynchronousHistoryMutation` already treats synchronous mutation batches,
  keeps phase order and the high-water reset unchanged, restores never-drop
  parity for rebuild-phase throws, makes `compressionLockReleased` fire even
  when a rebuild op fails, and propagates `throw undefined` truthfully.
- Regression tests: "still emits compressionLockReleased, preserves streaming
  content, and rethrows when a rebuild operation throws" and "propagates a
  thrown undefined listener failure instead of swallowing it".

RED evidence (tmp/issue3264/red-evidence.log): observed=false at the release
assertion; "Received function did not throw". Post-fix targeted evidence
(tmp/issue3264/green-full.log): history/ + recording/ 1059 pass / 0 fail
(67 files); eslint/prettier clean; HistoryService.ts untouched at 794
effective lines (<= 800 gate); historyCompressionQueue.ts 65 effective lines.

Review cap (initial + 1 remediation round) reached; both rounds' blocking
findings remediated. Deferred follow-up from round 1 unchanged.

## OCR local review round 1 (post-deepthinker tree)

2 findings; triage and outcomes:

- MEDIUM "deferred listener-throw attributed to the in-flight mutation" —
  REJECTED. Emitting the release events outside the mutation FIFO is exactly
  what review round 1's blocker prohibited: with an async mutation (e.g.
  `replaceAll`) in flight, only FIFO routing yields the required drain order
  rebuild ops -> events -> streaming ops. In that deferred case there is no
  synchronous `endCompression()` caller to attribute a listener throw to; the
  rejection of the awaited in-flight mutation is where every queued
  synchronous closure's failure already surfaces (same semantics as
  `drainSynchronousHistoryMutations` for ordinary queued mutations). The
  reviewer's own deep-thinker probe confirmed the error is surfaced (not
  swallowed) and history survives. Documented here as an accepted consequence
  of the ordering fix.
- LOW "`clear()` does not reset `highWaterReported`, latching the #2852
  one-shot after dispose" — FIXED. The queue class is new in this change, and
  a reset method should restore initial state. `clear()` now re-arms the
  latch; pinned by a queue-level regression ("re-arms the one-shot high-water
  diagnostic after clear() (#2852)", RED first: reports stayed `[2]`).
  Also fixed two lint errors the round-2 test additions carried
  (`no-inferrable-types` annotation; `toThrow()` without a message cannot
  match a thrown `undefined`, so the assertion uses an explicit try/catch
  capture instead).

Targeted evidence: history/ + recording/ suites 1060 pass / 0 fail (67 files);
eslint + prettier clean.

## Final verification (cycle 5, final tree incl. OCR fixes)

- `npm run test`: exit 1 from 4 load-induced timeouts (`agent.skills control`,
  `Engine task continuation and pause #2657`, `Sandbox boundary T18e`,
  `subagent interactive tool scheduling timeout #1872`); each file re-run in
  isolation passed (6/6, 4/4, 2/2, 12/12 — tmp/issue3264/retest-cycle5*.log).
  None touch history/recording; same environmental flake family as cycles 2-3.
- `npm run lint`: PASS. `npm run typecheck`: PASS. `prettier --check` (all six
  touched files): PASS. `npm run build`: PASS.
- Test-audit scan (tmp/issue3264/scan-final/): zero findings on
  compression-locking.test.ts; the only findings on touched files are
  pre-existing on main (verified via `git show main:`), so no new findings vs
  the main baseline.
- Smoke test (stepfun-37): still blocked by the account-level provider error
  ("you have no active step plan subscription", deterministic 400, verified
  twice earlier). Startup/profile-load/client-init path works; documented as
  environmental.
