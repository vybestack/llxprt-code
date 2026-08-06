/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Async fake-timer helpers.
 *
 * Bun ships only the synchronous fake-timer primitives (`advanceTimersByTime`,
 * `runAllTimers`, `runOnlyPendingTimers`). Advancing the clock fires the timer
 * callbacks but does not settle the promise chains those callbacks resume, so
 * a test that awaits work scheduled inside a timer needs the clock advanced
 * *and* the microtask queue drained. These helpers pair Bun's real primitives
 * with that drain.
 */

import { vi } from 'bun:test';

/**
 * Captured at module load, before any test activates fake timers, so the drain
 * can reach a genuine event-loop turn. Under fake timers `setImmediate` is
 * itself faked and would never fire.
 */
const realSetImmediate: (callback: () => void) => unknown = setImmediate;

const MAX_TIMER_ADVANCE = 4_294_967_295;
const MAX_TIMER_DELAY = 2_147_483_647;
const MAX_DRAIN_PASSES = 10_000;
const MICROTASK_DRAIN_ROUNDS = 20;

/**
 * Drains microtasks queued by timer callbacks, then yields one real macrotask.
 *
 * The chained `Promise.resolve()` rounds are what actually settle recursively
 * queued continuations; the trailing `setImmediate` is a final settling
 * boundary. Doing the microtask rounds first matters on Linux, where
 * `setImmediate` may not fire at all while fake timers are installed.
 */
async function flushPendingTasks(): Promise<void> {
  for (let round = 0; round < MICROTASK_DRAIN_ROUNDS; round++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => {
    realSetImmediate(resolve);
  });
}

/**
 * Arms a sentinel timer at `delay` and reports whether it fired.
 *
 * The result is read through a function rather than a boolean: the callback
 * runs during timer advancement, so control-flow analysis would narrow a plain
 * flag to its initial value and treat every later check as dead code.
 */
function armSentinel(delay: number): {
  reached: () => boolean;
  cancel: () => void;
} {
  let fired = false;
  const id = setTimeout(() => {
    fired = true;
  }, delay);
  return {
    reached: () => fired,
    cancel: () => {
      clearTimeout(id);
    },
  };
}

/**
 * Advances at most `ms`, stopping at each scheduled timer so callbacks that
 * schedule further timers are picked up within the same advance.
 */
async function advanceChunk(ms: number): Promise<void> {
  const target = Date.now() + ms;

  while (Date.now() < target) {
    const remaining = target - Date.now();
    if (vi.getTimerCount() === 0) {
      vi.advanceTimersByTime(remaining);
      await flushPendingTasks();
      continue;
    }

    const sentinel = armSentinel(remaining);
    const before = Date.now();

    vi.advanceTimersToNextTimer();
    sentinel.cancel();
    await flushPendingTasks();

    if (sentinel.reached()) return;
    if (Date.now() <= before) {
      // The next timer did not move the clock, so nudge it to guarantee
      // progress and avoid spinning on a zero-delay timer.
      vi.advanceTimersByTime(Math.min(remaining, 1));
      await flushPendingTasks();
    }
  }
}

export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_ADVANCE) {
    vi.advanceTimersByTime(ms);
    await flushPendingTasks();
    return;
  }

  let remaining = Math.floor(ms);
  if (remaining === 0) {
    // Advancing by zero must still run the timers that are already due, which
    // is the usual way to flush a `setTimeout(fn, 0)`.
    if (vi.isFakeTimers()) {
      vi.advanceTimersByTime(0);
    }
    await flushPendingTasks();
    return;
  }

  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMER_DELAY);
    await advanceChunk(chunk);
    remaining -= chunk;
  }
}

export async function runAllTimersAsync(): Promise<void> {
  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
    vi.runAllTimers();
    await flushPendingTasks();
    if (vi.getTimerCount() === 0) return;
  }
  throw new Error(
    `Aborting runAllTimersAsync after ${MAX_DRAIN_PASSES} interleaved timer drains`,
  );
}

export async function runOnlyPendingTimersAsync(): Promise<void> {
  vi.runOnlyPendingTimers();
  await flushPendingTasks();
}
