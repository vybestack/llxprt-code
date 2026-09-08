/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural coverage for the async fake-timer helpers.
 *
 * Bun ships only synchronous timer primitives. These helpers add the awaiting
 * variants by driving the sync primitive and draining microtasks between
 * callbacks, which is what lets a timer scheduled inside an awaited callback
 * still run. The cases below pin the scheduling contract the suites rely on.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  advanceTimersByTimeAsync,
  runAllTimersAsync,
  runOnlyPendingTimersAsync,
} from './async-timers.js';

function scheduleCountdown(order: number[], remaining: number): void {
  setTimeout(() => {
    order.push(remaining);
    if (remaining > 1) {
      scheduleCountdown(order, remaining - 1);
    }
  }, 5);
}

describe('async fake timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs timers that are already due when advancing by zero', async () => {
    vi.useFakeTimers();
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);

    await advanceTimersByTimeAsync(0);

    expect(fired).toBe(true);
  });

  it('runs a timer scheduled inside an earlier timer callback', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => {
      order.push('first');
      setTimeout(() => order.push('second'), 10);
    }, 10);

    await advanceTimersByTimeAsync(20);

    expect(order).toStrictEqual(['first', 'second']);
  });

  it('runs a timer scheduled after an await inside a callback', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => {
      order.push('first');
      void Promise.resolve().then(() => {
        setTimeout(() => order.push('after-await'), 5);
      });
    }, 10);

    await advanceTimersByTimeAsync(20);

    expect(order).toStrictEqual(['first', 'after-await']);
  });

  it('moves the clock a whole millisecond for a sub-millisecond advance', async () => {
    // Bun's `advanceTimersByTime(0)` is not a no-op: it advances one
    // millisecond. So a fractional request cannot be held back the way Vitest
    // held it, and callers should pass whole milliseconds. Pinned here so the
    // difference is visible rather than surprising.
    vi.useFakeTimers();
    const start = Date.now();

    await advanceTimersByTimeAsync(0.5);

    expect(Date.now() - start).toBe(1);
  });

  it('advances by the requested whole number of milliseconds', async () => {
    vi.useFakeTimers();
    const start = Date.now();

    await advanceTimersByTimeAsync(25);

    expect(Date.now() - start).toBe(25);
  });

  it('stops at the requested time without overshooting to a later timer', async () => {
    // The sentinel exists for this: advanceTimersToNextTimer would jump the
    // clock to the next scheduled timer, which may sit well beyond the caller's
    // budget. Scheduling the sentinel on the fake clock is what lets the
    // advance stop exactly on target.
    vi.useFakeTimers();
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 50);
    const start = Date.now();

    await advanceTimersByTimeAsync(20);

    expect(fired).toBe(false);
    expect(Date.now() - start).toBe(20);
  });

  it('drains timers that keep scheduling more work', async () => {
    vi.useFakeTimers();
    const order: number[] = [];
    scheduleCountdown(order, 3);

    await runAllTimersAsync();

    expect(order).toStrictEqual([3, 2, 1]);
  });

  it('runs only the timers pending when it was called', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => {
      order.push('pending');
      setTimeout(() => order.push('scheduled-later'), 5);
    }, 5);

    await runOnlyPendingTimersAsync();

    expect(order).toStrictEqual(['pending']);
  });
});
