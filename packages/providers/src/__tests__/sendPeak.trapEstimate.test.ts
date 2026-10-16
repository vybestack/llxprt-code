/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step D3b: control for the estimate step of the peak-during-send
 * probe. With `ISSUE854_SEND_TRAP=estimate` the probe reads the whole history
 * into an `IContent[]` while the projected prompt is being estimated and
 * drops it before the request goes out. The chat route, which passes with the
 * estimate in its window, must then break the growth bound; only the estimate
 * window can show this array. The trap lives in test support only.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-chat-plain', {
  source: 'rows',
  shapes: ['text-only'],
  rounds: 1,
  estimate: true,
  trap: 'estimate',
});

describe('peak memory while estimating, trap estimate', () => {
  it(
    'sends the right bytes but breaks the growth bound the passing route keeps',
    async () => {
      const { verdict } = shapeRun(await measured(), 'text-only');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.heapGrowth).toBeGreaterThan(SEND_PEAK_BOUND_BYTES);
    },
    TEST_TIMEOUT_MS,
  );
});
