/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.clearAllTimers();
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

  expect(order).toEqual(['first@10', 'nested@5']);
  expect(Date.now()).toBe(10);
});
