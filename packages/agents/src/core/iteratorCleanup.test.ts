/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeIteratorBounded } from './iteratorCleanup.js';

const CLEANUP_TIMEOUT_MS = 1_000;
const TIMEOUT_BOUNDARY_MARGIN_MS = 1;

function createNoncooperativeIterator(
  onReturn?: () => void,
): AsyncIterator<string> {
  return {
    next: () => new Promise<IteratorResult<string>>(() => {}),
    return: () => {
      onReturn?.();
      return new Promise<IteratorResult<string>>(() => {});
    },
  };
}

describe('closeIteratorBounded', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately when no iterator was acquired', async () => {
    await expect(closeIteratorBounded(undefined)).resolves.toBeUndefined();
  });

  it('returns immediately when the iterator has no return method', async () => {
    const iterator: AsyncIterator<string> = {
      next: async () => ({ done: true, value: undefined }),
    };

    await expect(closeIteratorBounded(iterator)).resolves.toBeUndefined();
  });

  it('bounds cleanup for a noncooperative iterator', async () => {
    vi.useFakeTimers();
    let completed = false;
    let cleanupRequested = false;

    const closing = closeIteratorBounded(
      createNoncooperativeIterator(() => {
        cleanupRequested = true;
      }),
    ).then(() => {
      completed = true;
    });

    expect(cleanupRequested).toBe(true);
    await vi.advanceTimersByTimeAsync(
      CLEANUP_TIMEOUT_MS - TIMEOUT_BOUNDARY_MARGIN_MS,
    );
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(TIMEOUT_BOUNDARY_MARGIN_MS);
    await closing;
    expect(completed).toBe(true);
  });

  it('uses a caller-provided cleanup timeout', async () => {
    vi.useFakeTimers();
    let completed = false;

    const closing = closeIteratorBounded(
      createNoncooperativeIterator(),
      undefined,
      25,
    ).then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(24);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(completed).toBe(true);
  });

  it('returns as soon as cooperative cleanup completes', async () => {
    vi.useFakeTimers();
    const iterator: AsyncIterator<string> = {
      next: async () => ({ done: true, value: undefined }),
      return: async () => ({ done: true, value: undefined }),
    };

    await closeIteratorBounded(iterator);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains rejected cleanup without leaving a timer', async () => {
    vi.useFakeTimers();
    const iterator: AsyncIterator<string> = {
      next: async () => ({ done: true, value: undefined }),
      return: async () => {
        throw new Error('cleanup failed');
      },
    };

    await expect(closeIteratorBounded(iterator)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requests cleanup without scheduling a timer after abort', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    abortController.abort();
    let cleanupRequested = false;

    await closeIteratorBounded(
      createNoncooperativeIterator(() => {
        cleanupRequested = true;
      }),
      abortController.signal,
    );

    expect(cleanupRequested).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting and clears the cleanup timer when aborted', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const closing = closeIteratorBounded(
      createNoncooperativeIterator(),
      abortController.signal,
    );

    expect(vi.getTimerCount()).toBe(1);
    abortController.abort();
    await closing;

    expect(vi.getTimerCount()).toBe(0);
  });
});
