/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setWaitForScheduler,
  waitFor,
  type WaitForOptions,
} from '../../test-setup/stub-helpers.js';

interface WaitForObservation {
  readonly callbackTimes: readonly number[];
  readonly settledAt: number;
  readonly errorMessage: string | undefined;
}

type WaitForImplementation = <T>(
  callback: () => T | Promise<T>,
  options?: number | WaitForOptions,
) => Promise<T>;

async function observeFakeTimerCadence(
  implementation: WaitForImplementation,
  options: number | WaitForOptions,
): Promise<WaitForObservation> {
  vi.useFakeTimers({ now: 0 });
  const callbackTimes: number[] = [];
  let errorMessage: string | undefined;
  try {
    await implementation(() => {
      callbackTimes.push(Date.now());
      throw new Error(`attempt@${Date.now()}`);
    }, options);
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  return { callbackTimes, settledAt: Date.now(), errorMessage };
}

async function observePendingCallback(
  implementation: WaitForImplementation,
): Promise<WaitForObservation> {
  vi.useFakeTimers({ now: 0 });
  const callbackTimes: number[] = [];
  let errorMessage: string | undefined;
  try {
    await implementation(
      () => {
        callbackTimes.push(Date.now());
        return new Promise<never>(() => {});
      },
      { interval: 50, timeout: 200 },
    );
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  return { callbackTimes, settledAt: Date.now(), errorMessage };
}

function installVitestScheduler(): void {
  setWaitForScheduler({
    isFakeTimers: vi.isFakeTimers,
    advanceTimersByTime: vi.advanceTimersByTime,
  });
}

afterEach(() => {
  setWaitForScheduler(null);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('waitFor Vitest 3.2.6 compatibility', () => {
  it('invokes successful callbacks synchronously', async () => {
    let nativeInvoked = false;
    const nativeResult = vi.waitFor(() => {
      nativeInvoked = true;
      return 'native';
    });

    let shimInvoked = false;
    const shimResult = waitFor(() => {
      shimInvoked = true;
      return 'shim';
    });

    expect([nativeInvoked, shimInvoked]).toEqual([true, true]);
    await expect(nativeResult).resolves.toBe('native');
    await expect(shimResult).resolves.toBe('shim');
  });

  it('matches fake-timer cadence and the exact timeout-boundary attempt', async () => {
    const native = await observeFakeTimerCadence(vi.waitFor, {
      interval: 50,
      timeout: 200,
    });
    vi.useRealTimers();
    installVitestScheduler();
    const shim = await observeFakeTimerCadence(waitFor, {
      interval: 50,
      timeout: 200,
    });

    expect(shim).toEqual(native);
  });

  it('keeps the numeric timeout overload compatible', async () => {
    const native = await observeFakeTimerCadence(vi.waitFor, 200);
    vi.useRealTimers();
    installVitestScheduler();
    const shim = await observeFakeTimerCadence(waitFor, 200);

    expect(shim).toEqual(native);
  });

  it('advances while an async callback is pending without invoking it again', async () => {
    const native = await observePendingCallback(vi.waitFor);
    vi.useRealTimers();
    installVitestScheduler();
    const shim = await observePendingCallback(waitFor);

    expect(shim).toEqual(native);
  });

  it.each([
    { interval: 0, timeout: 0 },
    { interval: -1, timeout: -1 },
    { interval: Number.NaN, timeout: Number.NaN },
    { interval: Number.POSITIVE_INFINITY, timeout: Number.POSITIVE_INFINITY },
  ])(
    'passes raw boundary options through without eager validation: %o',
    async (options) => {
      expect(() => vi.waitFor(() => 'native', options)).not.toThrow();
      expect(() => waitFor(() => 'shim', options)).not.toThrow();
      await expect(vi.waitFor(() => 'native', options)).resolves.toBe('native');
      await expect(waitFor(() => 'shim', options)).resolves.toBe('shim');
    },
  );

  it('uses fixed interval cadence when callback duration exceeds the interval', async () => {
    const observe = async (
      implementation: WaitForImplementation,
    ): Promise<number[]> => {
      const starts: number[] = [];
      let attempts = 0;
      await implementation(
        async () => {
          starts.push(Date.now());
          attempts++;
          await new Promise<void>((resolve) => setTimeout(resolve, 35));
          if (attempts < 2) throw new Error('retry');
        },
        { interval: 10, timeout: 500 },
      );
      return starts.map((time) => time - starts[0]);
    };

    const native = await observe(vi.waitFor);
    const shim = await observe(waitFor);

    expect(shim.length).toBe(native.length);
    expect(shim[1]).toBeGreaterThanOrEqual(35);
    expect(native[1]).toBeGreaterThanOrEqual(35);
  });
});
