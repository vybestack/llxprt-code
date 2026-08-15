# Plan: Make Provider Stream Reads Cancellation-Responsive at the Turn Layer (Issue #3236)

Plan ID: PLAN-20260815-ISSUE3236
Generated: 2026-08-15
Issue: #3236

## Problem statement

Cancelling an active turn with Escape can leave the CLI permanently unable to
process another prompt. The UI immediately presents Idle (Escape synchronously
clears `isResponding` and cancels tools), but the interactive submission gate
(`activeTurnRef` in `useSubmitQuery.ts`) is released only when the full
provider chain settles. No layer between the CLI and the provider transport
races the pending provider read against the abort signal:

- `Turn.consumeStreamEvents` (`packages/agents/src/core/turn.ts:415-426`) does
  a direct unbounded `await streamIterator.next()` when the watchdog is
  inactive, and even the watchdog-active branch races only the timeout
  promise — abort is not a contender.
- The watchdog disarms after the first liveness ping or semantic chunk
  (`streamWatchdog.ts:189-192`) because the inter-chunk idle timeout defaults
  to disabled (`DEFAULT_STREAM_IDLE_TIMEOUT_MS = 0`), so every post-first-event
  read is unbounded with default config.
- `MessageStreamOrchestrator._processStreamIteration`, `AgenticLoop.
  streamAndCollect` (`AgenticLoop.ts:487-497`), and the CLI's
  `iterateAgentStream` (`useAgentEventStream.ts:344-345`) are plain `for await`
  loops that can only observe abort when the next event arrives or the stream
  ends.

If the provider transport's pending `next()` does not reject when the signal
aborts (SDK-internal retry/buffer queues, SSE pump state, proxy/keep-alive
edges, fetch abort quirks), `Turn.run` never finishes, no public `done` is
synthesized, `runStream` never settles, the submission `finally` never clears
`activeTurnRef`, and every subsequent prompt is queued forever. Restart is the
only recovery. The failure is intermittent because the abort signal is
correctly plumbed into all audited provider fetches; only transport-level
non-settlement triggers the hang, and nothing in this codebase can recover
from it.

Existing regression coverage cannot catch this: `turn.abort-timeout.test.ts`
uses `rejectWhenAborted` — abort-honoring iterators only.

## Preflight findings

1. `Turn.consumeStreamEvents` is the single owner of provider iteration for
   agent turns; both read branches await settlement with no abort contender.
2. The abort check at `turn.ts:432-435` runs only after `next()` resolves, so
   it cannot help a pending read.
3. `closeIteratorBounded` (`iteratorCleanup.ts`) is already bounded (1s cap)
   and returns immediately when the signal is already aborted, so the existing
   `cleanupStreamResources` finally-block cannot hang once consumption exits.
4. `TurnProcessor.sendMessageStream` (`TurnProcessor.ts:204-226`) already
   force-resolves its send-serialization gate on abort and documents this
   deadlock class, but only for the gate — not the read path.
5. `acquireFirstStreamEvent` has an unbounded `await iterator.next()` in its
   watchdog-inactive branch (`turn.ts:763`); the watchdog-active branch is
   bounded only by the first-response timeout (300s default), so it self-heals
   with an error rather than hanging silently. Both branches should still be
   abort-responsive.
6. The post-read abort check and the new abort-race win are mutually
   exclusive by construction: the race yields `UserCancelled` only when abort
   wins (result discarded), and the post-read check fires only when the result
   arrived before abort. Exactly one `UserCancelled` is emitted either way.
7. Watchdog semantics are orthogonal and must not change: first-response and
   inter-chunk guards keep their current arm/disarm/fire behavior.

## Requirements and behavior

### REQ-3236-1: Abort settles a pending provider read

**Full text:** Every `streamIterator.next()` await owned by `Turn` — in both
`consumeStreamEvents` branches (watchdog active and inactive) and the
`acquireFirstStreamEvent` watchdog-inactive first read — must settle promptly
when the turn's parent AbortSignal fires, regardless of provider/SDK
cooperation.

- GIVEN default config (inter-chunk idle timeout disabled) and a provider
  iterator that yielded at least one semantic chunk
- WHEN the turn signal aborts while the next read is pending and the iterator
  ignores the signal
- THEN the read await settles via the abort race without any timer advancing
- AND `Turn.run` completes and emits exactly one `UserCancelled`
- GIVEN the watchdog-active branch (idle timeout configured)
- WHEN the turn signal aborts while the watchdog race is pending
- THEN abort wins without waiting for the watchdog fire
- AND the existing watchdog timeout behavior is unchanged when no abort occurs

### REQ-3236-2: Terminal-path and cleanup invariants

**Full text:** The abort-race win path must emit exactly one `UserCancelled`,
return from stream consumption so `cleanupStreamResources` runs, and leave the
bounded iterator cleanup (`closeIteratorBounded`) as the final owner-facing
close.

- GIVEN an abort-ignoring iterator abandoned mid-read
- WHEN abort wins the race
- THEN exactly one `UserCancelled` is emitted (no duplicate from the post-read
  abort check)
- AND the iterator's `return()` is still invoked via the existing cleanup path
- AND `Turn.run` resolves rather than throwing (cancellation is not an error)

### REQ-3236-3: Abandoned-read safety

**Full text:** A provider read abandoned by the abort race must never produce
an unhandled rejection and must never mutate the completed turn when it
settles late.

- GIVEN the abort race won and the abandoned `next()` promise later rejects
- WHEN the microtask queue drains
- THEN no unhandled rejection escapes to the process
- GIVEN the abandoned `next()` promise later resolves with another chunk
- WHEN the turn has already emitted `UserCancelled`
- THEN no additional event is emitted and turn state is unchanged

### REQ-3236-4: Listener hygiene

**Full text:** The per-read abort listener must be removed when either side of
the race wins, so long streams do not accumulate listeners on the turn signal.

- GIVEN a stream that yields many chunks without abort
- WHEN each read completes
- THEN the abort listener installed for that read is removed
- GIVEN abort fires
- THEN the listener (registered `{ once: true }`) is not retained

### REQ-3236-5: CLI queue drain after provider-ignored cancel

**Full text:** With the Turn-level fix in place, the real CLI submission and
queue paths must recover from a provider-ignored cancellation: the cancelled
turn's lifecycle completes, `activeTurnRef` is released, and queued prompts
drain automatically, exactly once, in order, without a second Enter.

- GIVEN a real `useSubmitQuery` + `useQueuedSubmissions` + real cancellation
  wiring around a controlled Agent stream whose provider read never settles
  after one chunk
- WHEN Escape-style cancellation runs and prompts B then C are submitted
- THEN B and C drain automatically exactly once in order after the cancelled
  turn releases ownership
- AND final streaming state is Idle with an empty queue
- AND no concurrent `AgenticLoop.run()` executions occur

## Design constraints

1. The fix is local to `packages/agents/src/core/turn.ts` (plus tests). Do not
   alter watchdog semantics, YOLO approval flow, queue presentation, or any
   provider package.
2. Do not solve with polling, retry loops, forced default idle timeouts, or
   provider-specific assumptions.
3. The provider signal (`timeoutController.signal`) continues to be passed to
   the provider unchanged; the race is an additional settlement path owned by
   `Turn`, not a replacement for provider cooperation.
4. Preserve existing public event contracts: exactly one `UserCancelled`
   terminal event for a cancelled turn; successful streams are byte-for-byte
   compatible.
5. No new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
   severity downgrades, threshold increases, or ignore blocks.
6. TypeScript strict: no `any`, no type assertions where a predicate works.

## Implementation outline

### Phase 1 — Turn-level abort race (test-first)

1. Extend `packages/agents/src/core/turn.abort-timeout.test.ts` (existing
   describe or a new describe block in the same file) with behavioral tests:
   - REQ-3236-1: unresolved second read after first semantic chunk, default
     config (no `stream-idle-timeout-ms`), abort mid-read → `Turn.run`
     completes with exactly one `UserCancelled`; use real timers with a
     deterministic "second read entered" barrier; resolve/reject the abandoned
     promise only in teardown.
   - REQ-3236-1: watchdog-active variant — idle timeout configured, abort
     mid-read, no timer advance needed to settle.
   - REQ-3236-2: `return()` still called on the abort-ignoring iterator.
   - REQ-3236-3: late-then-rejects and late-then-resolves abandoned reads
     produce no unhandled rejection and no extra events.
   - REQ-3236-4: many-chunk stream does not accumulate listeners (observable
     via `signal.listenerCount` or equivalent if available in the runtime;
     otherwise assert via behavior — long clean stream plus abort still
     settles exactly once).
   - Existing tests in the file must remain green unchanged (they pin
     watchdog semantics and post-read abort behavior).
2. Implement in `turn.ts`:
   - A private helper that wraps a pending read (`Promise<IteratorResult>`)
     with a turn-signal abort race: settles `{ aborted: true }` on abort (and
     attaches a no-op rejection/resolve sink to the abandoned read), otherwise
     settles with the read outcome; removes the abort listener on either win.
   - Use it in `consumeStreamEvents` for both the watchdog-race branch (wrap
     the `Promise.race` result) and the direct-await branch.
   - Use it for the first read in `acquireFirstStreamEvent`'s
     watchdog-inactive branch.
   - On abort win: `yield { type: AgentEventType.UserCancelled }` and return.
3. Run the Phase 1 suite plus the agents package tests.

### Phase 2 — CLI-level integration regression

1. New file `packages/cli/src/ui/hooks/agentStream/__tests__/
   useSubmitQuery.providerIgnoreCancel.bun.tsx` following the existing
   `useSubmitQuery.*.bun.tsx` harness patterns: real `useSubmitQuery`, real
   `useQueuedSubmissions` queue primitives, real cancellation hook wiring, and
   a controlled Agent stream boundary (the agent boundary may be controlled;
   the hook/queue/cancellation code under test must be real).
2. Scenarios per REQ-3236-5: cancelled turn with never-settling provider read
   (post-fix this settles at the Turn boundary — drive the same abort race
   through the controlled stream), prompts B and C queue then drain exactly
   once in order, final Idle + empty queue, no concurrent runs.
3. If — and only if — a concrete missing guard is found in the CLI layer,
   make the minimal production change in `useSubmitQuery.ts` and pin it with a
   test; otherwise CLI production code is untouched.

### Phase 3 — regression retention

- Run the existing regression suites referenced by the issue: #2259, #2296,
  #2882, #2954, #3048, #3169 (`useSubmitQuery.cancelResumeRace.bun.tsx`,
  `useSubmitQuery.doublecancel.bun.tsx`, `useSubmitQuery.terminalError.bun.tsx`,
  `useQueuedSubmissions.test.ts`, and their neighbors).

## Verification

The implementer must satisfy the full issue-workflow cycle:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Policy invariance: no suppressions, no severity downgrades, no threshold
increases, no new ignores.

## Risks and mitigations

- **Double `UserCancelled`:** impossible by construction (race win discards
  the result; post-read check only runs when the result arrived first); pinned
  by tests in both orders.
- **Unhandled rejections from abandoned reads:** sink both outcomes of the
  abandoned promise; pinned by late-settlement tests with a process-level
  rejection capture in the test file.
- **Watchdog behavior drift:** watchdog code is untouched; existing watchdog
  tests must pass unchanged.
- **Bun async-generator quirks (1.3.14):** the race does not rely on
  `return()` propagation through `yield*`; cleanup uses the existing bounded
  close.
