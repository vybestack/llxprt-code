/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: the openai provider, chat route, text-only shape.
 *
 * The route spools the body into a request-scoped scratch file one message at
 * a time, so its peak does not grow with the body. Each send is preceded by
 * the projection and token estimate the agent runs, written from the same
 * pass as estimator-form files, so the measured window covers the estimate
 * too (issue #854 D3b).
 *
 * The chat measurement is split into one file per shape so each file runs its
 * own child process and carries half the work against the per-test limit
 * (issue #854 D3c).
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
});

describe('peak memory while sending, the openai provider, chat route, text-only', () => {
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
});
