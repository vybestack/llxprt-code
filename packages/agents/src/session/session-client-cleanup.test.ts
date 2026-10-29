/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { rethrowAfterCleanup } from './session-client-cleanup.js';

describe('rethrowAfterCleanup', () => {
  it('rethrows the original failure once its cleanup has finished', async () => {
    const failure = new Error('binding failed');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const cleanupEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let cleanups = 0;
    let settled = false;
    const pending = rethrowAfterCleanup(
      failure,
      async () => {
        cleanups += 1;
        entered();
        await held;
      },
      'cleanup failed',
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });

    await cleanupEntered;
    expect(settled).toBe(false);
    release();

    expect(await pending).toBe(failure);
    expect(cleanups).toBe(1);
  });

  it('joins a cleanup failure to the original failure after the held cleanup finishes', async () => {
    const failure = new Error('policy binding failed');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const cleanupEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let cleanups = 0;
    let settled = false;
    const pending = rethrowAfterCleanup(
      failure,
      async () => {
        cleanups += 1;
        entered();
        await held;
        throw new Error('policy client cleanup failed');
      },
      'Session policy binding cleanup failed',
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });

    await cleanupEntered;
    expect(settled).toBe(false);
    release();

    const joined = await pending;
    expect(joined).toBeInstanceOf(AggregateError);
    if (!(joined instanceof AggregateError)) throw joined;
    expect(joined.message).toBe('Session policy binding cleanup failed');
    expect(joined.errors[0]).toBe(failure);
    expect(joined.errors[1]).toBeInstanceOf(Error);
    expect((joined.errors[1] as Error).message).toBe(
      'policy client cleanup failed',
    );
    expect(cleanups).toBe(1);
  });
});
