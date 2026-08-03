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
 * `vi.waitFor` is not usable either: it polls on timers, which are frozen while
 * fake timers are installed.
 *
 * The real `setImmediate` is captured at module load — before any test body
 * calls `vi.useFakeTimers()`. Vitest's fake timers replace the global
 * `setImmediate`; Bun's do not. Holding the original reference makes these
 * helpers behave identically under both runners.
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
