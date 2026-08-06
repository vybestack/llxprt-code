/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Event-loop helpers for tests that combine fake timers with real async work.
 *
 * Awaiting `Promise.resolve()` in a loop only drains the microtask queue. Code
 * under test frequently has to cross a macrotask boundary before it reaches the
 * state a test is waiting for (a second provider call, a registered watchdog,
 * the first streamed event), and a microtask-only drain will spin forever
 * without ever getting there.
 *
 * A polling waitFor is not usable either: it polls on timers, which are frozen
 * while fake timers are installed.
 *
 * The real `setImmediate` is captured at module load — before any test body
 * calls `vi.useFakeTimers()`. Vitest's fake timers replace the global
 * `setImmediate`; Bun's do not. Holding the original reference makes these
 * helpers behave identically under both runners.
 *
 * Important usage constraint: only call these BEFORE advancing the fake clock.
 * Once `advanceTimersByTimeAsync()` has moved fake time forward, a real
 * `setImmediate` callback does not reliably run under Bun on Linux, and the
 * yield never resolves. To let pending work settle after advancing time, use
 * the fake-timer API itself (a further small `advanceTimersByTimeAsync()`)
 * rather than a real event-loop yield.
 */
const realSetImmediate = globalThis.setImmediate;

/** Yields once to the real event loop, bypassing installed fake timers. */
export function flushEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetImmediate(() => resolve());
  });
}

/**
 * Default number of event-loop turns {@link waitForCondition} will wait. Large
 * enough for deep async pipelines, small enough that a genuinely unreachable
 * condition fails the test rather than hanging until the suite timeout.
 */
const DEFAULT_MAX_TURNS = 2000;

/**
 * Yields to the event loop until `condition` holds, or until `maxTurns` turns
 * have elapsed.
 *
 * Returns whether the condition was met so callers can assert on the result
 * instead of proceeding from an unknown state — which is the failure mode of a
 * fixed-count drain loop that simply runs N times and continues regardless.
 */
export async function waitForCondition(
  condition: () => boolean,
  maxTurns: number = DEFAULT_MAX_TURNS,
): Promise<boolean> {
  for (let turn = 0; turn < maxTurns; turn++) {
    if (condition()) {
      return true;
    }
    await flushEventLoop();
  }
  return condition();
}

/** Real `setTimeout`, captured before any test installs fake timers. */
const realSetTimeout = globalThis.setTimeout;

/**
 * Sleeps for `ms` of wall-clock time using the real `setTimeout` captured at
 * module load.
 *
 * Always prefer this to a bare `setTimeout` in a test that has touched fake
 * timers. The global may still be the fake implementation — `useRealTimers()`
 * is not guaranteed to have restored it by the time the sleep is scheduled — in
 * which case a bare `setTimeout` never fires and the test hangs to its budget.
 */
export function delayRealTime(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

/**
 * Waits in **wall-clock time** for `condition` to hold, up to `timeoutMs`.
 *
 * Distinct from {@link waitForCondition}, which spins event-loop turns: those
 * elapse in microseconds, so it cannot wait for something that is scheduled on
 * a real timer. Use this when the code under test is driven by real timers
 * (a watchdog firing after N milliseconds); use `waitForCondition` when it is
 * driven purely by promise resolution.
 *
 * Returns whether the condition was met, so callers assert on the result rather
 * than proceeding from an unknown state.
 */
export async function waitForConditionInRealTime(
  condition: () => boolean,
  timeoutMs = 5_000,
  stepMs = 5,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, stepMs);
    });
  }
  return condition();
}
