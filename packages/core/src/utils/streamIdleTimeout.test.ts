/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nextStreamEventWithIdleTimeout,
  StreamIdleTimeoutError,
} from './streamIdleTimeout.js';

describe('nextStreamEventWithIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the next iterator event before the idle timeout and clears the timer', async () => {
    async function* stream(): AsyncGenerator<string> {
      yield 'fast';
    }

    const iterator = stream()[Symbol.asyncIterator]();

    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
    });

    await Promise.resolve();
    expect(await nextEventPromise).toEqual({ done: false, value: 'fast' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws StreamIdleTimeoutError and runs onTimeout when the iterator stays idle', async () => {
    const onTimeout = vi.fn();
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      onTimeout,
    });
    const rejection = nextEventPromise.then(
      () => {
        throw new Error('Expected the idle timeout to reject');
      },
      (error) => {
        expect(error).toBeInstanceOf(StreamIdleTimeoutError);
      },
    );

    await vi.advanceTimersByTimeAsync(30_001);

    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the provided error factory when timing out', async () => {
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const customError = new Error('custom timeout');
    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      createTimeoutError: () => customError,
    });
    const rejection = nextEventPromise.then(
      () => {
        throw new Error('Expected the custom timeout to reject');
      },
      (error) => {
        expect(error).toBe(customError);
      },
    );

    await vi.advanceTimersByTimeAsync(30_001);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave stale timers behind across rapid successive iterator reads', async () => {
    async function* stream(): AsyncGenerator<string> {
      yield 'one';
      yield 'two';
      yield 'three';
    }

    const iterator = stream()[Symbol.asyncIterator]();

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'one' });
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'two' });
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'three' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with AbortError when the parent signal aborts before the next event', async () => {
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const controller = new AbortController();
    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(nextEventPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Aborted',
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
