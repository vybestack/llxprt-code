/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854: control for the retained-growth gate of the peak-during-send
 * probe. With `ISSUE854_SEND_TRAP=retain` every send of the accumulation run
 * keeps its whole history array alive for the rest of the process, which is
 * the per-send leak the gate exists to catch. The run on the openai-responses
 * disk route, which passes without the trap, must then break the retained
 * growth bound. A gate that cannot see this proves nothing about the routes it
 * passes. The trap lives in test support only.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-responses', {
  source: 'rows',
  shapes: ['text-only'],
  rounds: 1,
  trap: 'retain',
});

describe('peak memory while sending, trap retain', () => {
  it(
    'sends the right bytes but breaks the retained growth bound the passing route keeps',
    async () => {
      const { verdict } = shapeRun(await measured(), 'text-only');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.retainedGrowth).toBeGreaterThan(SEND_PEAK_BOUND_BYTES);
    },
    TEST_TIMEOUT_MS,
  );
});
