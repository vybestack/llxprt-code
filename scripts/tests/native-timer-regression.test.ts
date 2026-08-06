/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, expect, it, vi } from 'bun:test';

afterEach(() => {
  vi.useRealTimers();
});

it('advances natively when a callback clears timers and schedules after await', async () => {
  vi.useFakeTimers({ now: 0 });
  const order: string[] = [];
  setTimeout(async () => {
    order.push(`first@${Date.now()}`);
    vi.clearAllTimers();
    await Promise.resolve();
    setTimeout(() => order.push(`nested@${Date.now()}`), 5);
  }, 10);

  await vi.advanceTimersByTimeAsync(20);

  // The behavioral contract under test: advanceTimersByTimeAsync fires BOTH
  // the original timer and the nested timer scheduled mid-callback (after a
  // clearAllTimers + await sequence), proving the shim drains microtasks and
  // picks up dynamically scheduled timers during advancement.
  //
  // The exact Date.now() values differ between Vitest/Sinon (which resets
  // the clock on clearAllTimers, so nested fires at t=5 and final is t=10)
  // and Bun (whose clearAllTimers does not reset the timer queue origin, so
  // nested fires at t=15 and final is t=20). Both runners prove the same
  // behavioral property: the two callbacks fire in order, and the nested
  // timer fires within the same advanceTimersByTimeAsync call.
  const isBun = typeof Bun !== 'undefined';
  if (isBun) {
    expect(order).toEqual(['first@10', 'nested@15']);
    expect(Date.now()).toBe(20);
  } else {
    expect(order).toEqual(['first@10', 'nested@5']);
    expect(Date.now()).toBe(10);
  }
});
