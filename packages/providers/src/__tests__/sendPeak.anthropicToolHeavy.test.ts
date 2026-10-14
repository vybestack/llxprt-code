/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2, turned on by E4: the anthropic provider, tool-heavy shape.
 *
 * The request body is written to a request-scoped spool one row at a time and
 * posted with a Content-Length equal to the sealed size, so the peak does not
 * grow with the body. Before E4 the route built the whole request in memory
 * (heap growth +18.8 MB text-only, +25.7 MB tool-heavy) and the bounds tests
 * were `test.failing`.
 *
 * The measurement is split into one file per shape so each file runs its own
 * child process and carries half the work against the per-test limit (the
 * chat measurement was split the same way, issue #854 D3c).
 */

import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

const TEST_TIMEOUT_MS = 170000;
const measured = sharedSendPeak('anthropic-cache-1h', {
  source: 'rows',
  shapes: ['tool-heavy'],
  rounds: 1,
});

describe('peak memory while sending, the anthropic provider, tool-heavy', () => {
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
