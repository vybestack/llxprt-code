/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural coverage for the polling helper in
 * `packages/test-utils/src/wait-for.ts`.
 *
 * Bun's fake timers never advance on their own, so the helper drives the clock
 * itself while polling. These cases pin the observable cadence — when each
 * attempt runs, when it gives up, and what it reports — rather than comparing
 * against another implementation.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  waitFor,
  type WaitForOptions,
} from '../../packages/test-utils/src/wait-for.js';

interface WaitForObservation {
  readonly callbackTimes: readonly number[];
  readonly settledAt: number;
  readonly errorMessage: string | undefined;
}

async function observeFakeTimerCadence(
  options: number | WaitForOptions,
): Promise<WaitForObservation> {
  vi.useFakeTimers({ now: 0 });
  const callbackTimes: number[] = [];
  let errorMessage: string | undefined;
  try {
    await waitFor(() => {
      callbackTimes.push(Date.now());
      throw new Error(`attempt@${Date.now()}`);
    }, options);
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  return { callbackTimes, settledAt: Date.now(), errorMessage };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('waitFor under fake timers', () => {
  it('invokes a successful callback synchronously and resolves its value', async () => {
    let invoked = false;
    const result = waitFor(() => {
      invoked = true;
      return 'value';
    });

    expect(invoked).toBe(true);
    await expect(result).resolves.toBe('value');
  });

  it('retries on the interval and reports the attempt made at the timeout boundary', async () => {
    const observed = await observeFakeTimerCadence({
      interval: 50,
      timeout: 200,
    });

    // The clock advances before each attempt, so the first attempt observes
    // t=interval rather than t=0, and the final attempt lands exactly on the
    // timeout instead of overshooting it.
    expect(observed.callbackTimes).toEqual([50, 100, 150, 200]);
    expect(observed.settledAt).toBe(200);
    expect(observed.errorMessage).toBe('attempt@200');
  });

  it('treats a bare number as the timeout and keeps the default interval', async () => {
    const observed = await observeFakeTimerCadence(200);

    expect(observed.callbackTimes).toEqual([50, 100, 150, 200]);
    expect(observed.errorMessage).toBe('attempt@200');
  });

  it('advances while an async callback is pending without invoking it again', async () => {
    vi.useFakeTimers({ now: 0 });
    const callbackTimes: number[] = [];
    let errorMessage: string | undefined;
    try {
      await waitFor(
        () => {
          callbackTimes.push(Date.now());
          return new Promise<never>(() => {});
        },
        { interval: 50, timeout: 200 },
      );
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // A pending callback must not be re-entered; the clock keeps moving until
    // the timeout, and the generic message is used because nothing rejected.
    expect(callbackTimes).toEqual([50]);
    expect(Date.now()).toBe(200);
    expect(errorMessage).toBe('Timed out in waitFor!');
  });

  it.each([
    { interval: 0, timeout: 0 },
    { interval: -1, timeout: -1 },
    { interval: Number.NaN, timeout: Number.NaN },
    { interval: Number.POSITIVE_INFINITY, timeout: Number.POSITIVE_INFINITY },
  ])(
    'passes raw boundary options through without eager validation: %o',
    async (options) => {
      expect(() => waitFor(() => 'value', options)).not.toThrow();
      await expect(waitFor(() => 'value', options)).resolves.toBe('value');
    },
  );
});

describe('waitFor under real timers', () => {
  it('waits for a slow callback to finish instead of retrying on the bare interval', async () => {
    const callbackDurationMs = 35;
    const intervalMs = 10;
    // setTimeout(n) can be observed as slightly less than n ms of Date.now()
    // elapsed time because the two clocks round independently, so a bare
    // ">= callbackDurationMs" comparison is inherently flaky. Allow a small
    // clock-granularity slack while keeping the threshold far above the
    // interval, which is what makes the assertion meaningful.
    const clockGranularitySlackMs = 5;
    const minimumSecondAttemptOffsetMs =
      callbackDurationMs - clockGranularitySlackMs;

    const starts: number[] = [];
    let attempts = 0;
    await waitFor(
      async () => {
        starts.push(Date.now());
        attempts++;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, callbackDurationMs),
        );
        if (attempts < 2) throw new Error('retry');
      },
      { interval: intervalMs, timeout: 500 },
    );

    const offsets = starts.map((time) => time - starts[0]);
    expect(offsets.length).toBe(2);
    // Without this guard the assertion below would also pass for an
    // implementation that ignored callback completion and retried every
    // intervalMs.
    expect(minimumSecondAttemptOffsetMs).toBeGreaterThan(intervalMs);
    expect(offsets[1]).toBeGreaterThanOrEqual(minimumSecondAttemptOffsetMs);
  });
});
