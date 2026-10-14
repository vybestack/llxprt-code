/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: control for the peak-during-send probe. With
 * `ISSUE854_SEND_TRAP=fill` the probe reproduces the lazy Responses fill path
 * (#3858, deleted in step C3): the whole history array, its patched copy and
 * the whole `ResponsesInputItem[]`.
 * The run on the openai-responses disk route, which passes without the trap,
 * must then break the growth bound. A probe that cannot see this proves
 * nothing about the routes it passes. The trap lives in test support only.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-responses', {
  source: 'rows',
  shapes: ['text-only'],
  rounds: 1,
  trap: 'fill',
});

describe('peak memory while sending, trap fill', () => {
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
