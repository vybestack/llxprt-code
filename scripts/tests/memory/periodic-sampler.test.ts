/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { startPeriodicSampler } from '../../memory/periodic-sampler.ts';

function spin(durationMs: number): void {
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    // Models a synchronous heap histogram.
  }
}

describe('startPeriodicSampler', () => {
  it('leaves the application event-loop turns between slow samples', async () => {
    let samples = 0;
    let turns = 0;
    const sampler = startPeriodicSampler(2, () => {
      samples += 1;
      spin(10);
    });
    const end = performance.now() + 300;
    while (performance.now() < end) {
      await nextTurn();
      turns += 1;
    }
    sampler.stop();

    expect(samples).toBeGreaterThan(3);
    expect(turns).toBeGreaterThan(samples * 5);
  });

  it('never overlaps samples and waits the interval after each one finishes', async () => {
    const finishedAt: number[] = [];
    const startedAt: number[] = [];
    const sampler = startPeriodicSampler(30, () => {
      startedAt.push(performance.now());
      spin(5);
      finishedAt.push(performance.now());
    });
    await Bun.sleep(200);
    sampler.stop();

    expect(startedAt.length).toBeGreaterThan(2);
    for (let i = 1; i < startedAt.length; i += 1) {
      // Timers may fire slightly early relative to performance.now().
      expect(startedAt[i] - finishedAt[i - 1]).toBeGreaterThanOrEqual(25);
    }
  });

  it('stops scheduling samples once stopped', async () => {
    let samples = 0;
    const sampler = startPeriodicSampler(5, () => {
      samples += 1;
    });
    await Bun.sleep(50);
    sampler.stop();
    const observed = samples;
    await Bun.sleep(50);

    expect(observed).toBeGreaterThan(0);
    expect(samples).toBe(observed);
  });
});
