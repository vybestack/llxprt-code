/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Async polling helper.
 *
 * Bun's test runner has no `waitFor`, so tests that poll for an eventual
 * condition use this. Two schedulers are needed because Bun's fake timers do
 * not auto-advance: under real timers the poll runs on a real interval, but
 * under fake timers nothing else moves the clock, so an interval-driven poll
 * and the clock advancement would deadlock on each other. The fake-timer path
 * therefore advances the clock itself on every attempt.
 */

import { vi } from 'bun:test';

export interface WaitForOptions {
  interval?: number;
  timeout?: number;
}

const DEFAULT_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 1000;
const TIMEOUT_MESSAGE = 'Timed out in waitFor!';

// Captured before any test installs fake timers over the globals.
const safeSetTimeout = globalThis.setTimeout.bind(globalThis);
const safeSetInterval = globalThis.setInterval.bind(globalThis);
const safeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const safeClearInterval = globalThis.clearInterval.bind(globalThis);

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'then') === 'function';
}

export function waitFor<T>(
  callback: () => T | Promise<T>,
  options: number | WaitForOptions = {},
): Promise<T> {
  const normalized =
    typeof options === 'number' ? { timeout: options } : options;
  const interval = normalized.interval ?? DEFAULT_INTERVAL_MS;
  const timeout = normalized.timeout ?? DEFAULT_TIMEOUT_MS;

  if (vi.isFakeTimers()) {
    return waitForWithFakeTimers(callback, interval, timeout);
  }

  return new Promise<T>((resolve, reject) => {
    let lastError: unknown;
    let promiseStatus: 'idle' | 'pending' | 'resolved' | 'rejected' = 'idle';
    const timerIds: {
      timeout?: ReturnType<typeof safeSetTimeout>;
      interval?: ReturnType<typeof safeSetInterval>;
    } = {};

    const onResolve = (result: T): void => {
      if (timerIds.timeout) safeClearTimeout(timerIds.timeout);
      if (timerIds.interval) safeClearInterval(timerIds.interval);
      resolve(result);
    };

    const handleTimeout = (): void => {
      if (timerIds.interval) safeClearInterval(timerIds.interval);
      reject(lastError || new Error(TIMEOUT_MESSAGE));
    };

    const checkCallback = (): true | undefined => {
      if (promiseStatus === 'pending') return undefined;

      try {
        const result = callback();
        if (isPromiseLike(result)) {
          promiseStatus = 'pending';
          result.then(
            (resolvedValue: T) => {
              promiseStatus = 'resolved';
              onResolve(resolvedValue);
            },
            (rejectedValue: unknown) => {
              promiseStatus = 'rejected';
              lastError = rejectedValue;
            },
          );
        } else {
          onResolve(result);
          return true;
        }
      } catch (error: unknown) {
        lastError = error;
      }
      return undefined;
    };

    if (checkCallback() === true) return;
    timerIds.timeout = safeSetTimeout(handleTimeout, timeout);
    timerIds.interval = safeSetInterval(checkCallback, interval);
  });
}

/**
 * Fake-timer polling. Advances the fake clock by `interval` on each attempt
 * and checks the callback. A pending promise pauses further attempts until it
 * settles; a rejection retries after the next advance. Reaching `timeout`
 * rejects with the last error.
 */
async function waitForWithFakeTimers<T>(
  callback: () => T | Promise<T>,
  interval: number,
  timeout: number,
): Promise<T> {
  let lastError: unknown;
  let hasPending = false;
  let pendingResolved = false;
  let pendingValue: T | undefined;
  let pendingRejected = false;

  let elapsed = 0;
  for (;;) {
    if (!hasPending) {
      // Advance before the first callback, not after it. Under fake timers
      // nothing else moves the clock, so a callback waiting on a scheduled
      // effect would otherwise observe t=0 and fail its first attempt.
      vi.advanceTimersByTime(interval);
      elapsed += interval;

      let result: T | Promise<T>;
      try {
        result = callback();
      } catch (error: unknown) {
        lastError = error;
        if (elapsed >= timeout) {
          throw lastError || new Error(TIMEOUT_MESSAGE);
        }
        // Advancing the clock only fires timer callbacks; the promise chains
        // they resume still need a microtask turn before the next assertion
        // can observe their effect.
        await Promise.resolve();
        continue;
      }

      if (isPromiseLike(result)) {
        hasPending = true;
        pendingResolved = false;
        pendingRejected = false;
        result.then(
          (value: T) => {
            pendingResolved = true;
            pendingValue = value;
          },
          (error: unknown) => {
            pendingRejected = true;
            lastError = error;
          },
        );
        // Yield once so an already-resolved promise settles its handlers.
        await Promise.resolve();
        if (pendingResolved) {
          return pendingValue as T;
        }
        if (pendingRejected) {
          hasPending = false;
          if (elapsed >= timeout) {
            throw lastError || new Error(TIMEOUT_MESSAGE);
          }
        }
      } else {
        return result;
      }
    }

    if (hasPending) {
      vi.advanceTimersByTime(interval);
      elapsed += interval;
      await Promise.resolve();
      if (pendingResolved) {
        return pendingValue as T;
      }
      if (pendingRejected) {
        hasPending = false;
        if (elapsed >= timeout) {
          throw lastError || new Error(TIMEOUT_MESSAGE);
        }
        // The clock already advanced for this cycle; falling through to the
        // top would advance a second time before the retry, doubling the
        // effective interval.
        continue;
      }
    }

    if (elapsed >= timeout) {
      throw lastError || new Error(TIMEOUT_MESSAGE);
    }
  }
}
