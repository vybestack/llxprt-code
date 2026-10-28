/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, vi } from 'bun:test';
import { waitForConditionOnEventLoop } from './eventLoop.js';

describe('waitForConditionOnEventLoop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps waiting past the turn budget of waitForCondition while wall-clock time remains', async () => {
    let checks = 0;

    const met = await waitForConditionOnEventLoop(() => {
      checks += 1;
      return checks > 3_000;
    });

    expect(met).toBe(true);
    expect(checks).toBe(3_001);
  });

  it('reports false once the wall-clock budget is spent without the condition holding', async () => {
    const met = await waitForConditionOnEventLoop(() => false, 20);

    expect(met).toBe(false);
  });

  it('observes work scheduled on the real event loop while fake timers are installed', async () => {
    vi.useFakeTimers();
    let started = false;
    setImmediate(() => {
      setImmediate(() => {
        started = true;
      });
    });

    const met = await waitForConditionOnEventLoop(() => started);

    expect(met).toBe(true);
  });
});
