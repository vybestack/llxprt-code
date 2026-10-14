/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: the openai-responses provider, disk route (requestRows), tool-heavy history.
 *
 * The child process sends the history through the real provider and hashes the
 * body as it streams. This route is expected to pass today, so its bounds are
 * asserted for real. See `support/send-peak-probe.ts` for the method.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-responses', {
  source: 'rows',
  shapes: ['tool-heavy'],
});

describe('peak memory while sending, the openai-responses provider, disk route (requestRows), tool-heavy history', () => {
  it(
    'sends the bytes the route sends today with a matching content-length',
    async () => {
      const { verdict } = shapeRun(await measured(), 'tool-heavy');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.contentLengthMatchesBytes).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'grows no more than 1 MiB from a 1 MiB to an 8 MiB body and retains no more than 1 MiB over repeated sends',
    async () => {
      const { verdict } = shapeRun(await measured(), 'tool-heavy');
      expect(verdict.heapGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
      expect(verdict.arrayBufferGrowth).toBeLessThanOrEqual(
        SEND_PEAK_BOUND_BYTES,
      );
      expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    },
    TEST_TIMEOUT_MS,
  );
});
