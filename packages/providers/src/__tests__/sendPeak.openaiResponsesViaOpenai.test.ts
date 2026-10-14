/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: the openai provider, Responses route.
 *
 * The route sends through the same disk text route as the openai-responses
 * provider, so its peak must not grow with the body (step C1). The byte checks
 * and the bounds checks are ordinary tests, so a crashed probe cannot pass.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-responses-via-openai', {
  source: 'rows',
  shapes: ['text-only', 'tool-heavy'],
});

describe('peak memory while sending, the openai provider, Responses route', () => {
  it(
    'text-only: sends the bytes the route sends today with a matching content-length',
    async () => {
      const { verdict } = shapeRun(await measured(), 'text-only');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.contentLengthMatchesBytes).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'tool-heavy: sends the bytes the route sends today with a matching content-length',
    async () => {
      const { verdict } = shapeRun(await measured(), 'tool-heavy');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.contentLengthMatchesBytes).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'text-only: grows no more than 1 MiB from a 1 MiB to an 8 MiB body and retains no more than 1 MiB over repeated sends',
    async () => {
      const { verdict } = shapeRun(await measured(), 'text-only');
      expect(verdict.heapGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
      expect(verdict.arrayBufferGrowth).toBeLessThanOrEqual(
        SEND_PEAK_BOUND_BYTES,
      );
      expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'tool-heavy: grows no more than 1 MiB from a 1 MiB to an 8 MiB body and retains no more than 1 MiB over repeated sends',
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
