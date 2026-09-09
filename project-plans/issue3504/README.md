# Issue #3504: subagent termination tests interfere under the agents workspace runner

## Root cause analysis

`packages/agents/src/core/subagent.runNonInteractive-term.test.ts` runs in its
own `bun test` process (per-file isolation in `packages/agents/run-bun-tests.ts`),
so the interference is **within one file**, between sequentially-run tests, under
the concurrent runner's CPU load. Verified mechanics:

1. **Load-sensitive wait budget.** Tests (b), (f), (g) and the observe-helpers
   in (c), (e) synchronize via
   `waitForCondition(() => mockSendMessageStream.mock.calls.length > 0)` /
   `(() => capturedSignal !== undefined)` — a 2000-turn `realSetImmediate` spin
   worth roughly 10 ms of wall-clock headroom. Under the workspace runner's
   parallel load, the run's async setup (config/auth/memory resolution before
   the first model call) can exceed that budget. The wait returns `false`, the
   `expect(...).toBe(true)` throws, and the test exits **while its run promise
   is still in flight**.
2. **Orphaned run continues between tests.** Nothing aborts or disposes the
   scope on that early exit. The orphan's `new ChatSession()` happens during a
   later test: `beforeEach` has already re-run
   `ChatSession.mockImplementation(...)` over a fresh, not-yet-configured
   `mockSendMessageStream`, so `sendMessageStream()` returns `undefined` and
   the non-interactive path crashes in
   `consumeNonInteractiveStream` (`responseStream[Symbol.asyncIterator]`) —
   the reported "unhandled error between tests".
3. **Abandoned rejection handler.** The failed test leaves `runRejection`
   unawaited; when the orphan settles, its
   `throw new Error('Expected ... to abort')` surfaces as an unhandled
   rejection attributed to whatever test runs next — the reported
   `(fail) dispose > should clean up parent abort signal listener`.
4. **Fake-timer install order.** The timer-controlled tests call
   `vi.useFakeTimers()` **before** `createMockConfig()`. Under Bun 1.3.14 fake
   timers freeze `Date.now`, `performance.now`, AND `process.hrtime.bigint()`
   (verified by probes in `tmp/verify3504/`), and captured `setTimeout` never
   fires while only captured `setImmediate` does. Any timer-based step inside
   the config/auth setup chain therefore dead-ends until timers are restored;
   installing fakes only after config creation removes that class entirely.
   Note also: Bun's per-test timeout machinery itself stops firing under fake
   timers, so a stall becomes a per-file SIGKILL rather than a clean failure —
   orphan-proofing is required, not optional.

## Acceptance criteria

AC1. Every condition wait in this file that gates fake-time advancement uses a
     named, substantially larger turn budget (constant
     `CONDITION_WAIT_TURNS = 200_000`) so transient runner load cannot exhaust
     it; waits still fail cleanly (return `false`) rather than hang.
AC2. Timer-controlled tests install fake timers **after** `createMockConfig()`
     (and `SubAgentScope.create` remains after too), so config/auth setup runs
     under real timers.
AC3. Every test that starts a run and can exit before the run settles
     (tests (b), (f), (g) and observe-helpers (c), (e)) wraps its run-bearing
     section in `try`/`finally`: the finally restores real timers, disposes the
     scope (aborting active operations), resolves any manually-held stream
     promise, and attaches a no-op `catch` to the run/rejection promises so no
     unhandled rejection can surface in a later test. The finally must not
     await settlement (a stalled chain under fakes must not turn cleanup into
     a hang).
AC4. `beforeEach` asserts `expect(vi.isFakeTimers()).toBe(false)` so any future
     test that leaks fake-timer state fails loudly in the *next* test instead
     of corrupting it.
AC5. New regression test (behavioral, production-backed): a stalled
     non-interactive run (stream hangs after first chunk, no idle-timeout
     firing) is unblocked by `scope.dispose()` — the run rejects with an
     `AbortError` within a bounded immediate-turn wait. Proves dispose aborts
     active stream consumption and that a disposed scope leaves no async work
     that can cross a test boundary.
AC6. Scope: only `packages/agents/src/core/subagent.runNonInteractive-term.test.ts`
     changes. No production source changes. Existing test names/describe blocks
     preserved.

## Chosen over alternatives

- `waitForConditionInRealTime` (wall-clock deadline) is unusable under fake
  timers as built: its poll sleep uses captured `setTimeout`, which never fires
  under Bun fakes, and every real clock (`Date`, `performance`, `hrtime`) is
  frozen. Documented as a known follow-up; not touched here.
- The bot-plan's dedicated "restores real timers" test is replaced by the
  stronger AC4 beforeEach invariant (order-independent, applies to every test).
- `vi.restoreAllMocks()` in `afterEach` verified harmless under Bun
  (`vi.fn()` implementations persist; only `vi.spyOn` restores fire —
  intended), so it stays.

## Tests proving the behavior

- AC5 regression test in-file (dispose settles a stalled run; run rejects with
  AbortError; bounded wait — no hang possible).
- Determinism evidence gathered during implementation:
  - `bun test` on the file in isolation, repeated ≥10×: all pass.
  - File under synthetic CPU contention (6 parallel burner loops, matching the
    runner's concurrency): ≥20 consecutive passes, no cross-test unhandled
    errors.
  - Full agents workspace suite (`cd packages/agents && bun run-bun-tests.ts`):
    green.

## Verification cycle

Per repo workflow: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, then
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Review caps

deepthinker: ≤2 rounds. OCR: ≤2 rounds. Findings triaged Blocker-Fix /
In-scope-Fix / Reject / Defer; no scope expansion from reviewer suggestions.
