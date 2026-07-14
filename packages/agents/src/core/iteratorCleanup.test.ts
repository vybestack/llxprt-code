/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeIteratorBounded } from './iteratorCleanup.js';

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

  it('bounds cleanup for a noncooperative iterator', async () => {
    vi.useFakeTimers();
    let completed = false;

    const closing = closeIteratorBounded(createNoncooperativeIterator()).then(
      () => {
        completed = true;
      },
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(completed).toBe(true);
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
