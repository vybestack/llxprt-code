/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 steps A2 and C2: the openai-responses provider with a one-shot row
 * stream and no requestRows, tool-heavy history.
 *
 * The provider stages the stream on disk and sends it through the disk text
 * route, so the peak does not grow with the body. The byte checks are
 * ordinary tests, so a crashed probe cannot pass as a bounds failure.
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('openai-responses', {
  source: 'stream',
  shapes: ['tool-heavy'],
});

describe('peak memory while sending, the openai-responses provider, one-shot row stream (no requestRows), tool-heavy history', () => {
  it(
    'tool-heavy: sends the bytes the route sent before it moved to disk with a matching content-length',
    async () => {
      const { verdict } = shapeRun(await measured(), 'tool-heavy');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.contentLengthMatchesBytes).toBe(true);
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
