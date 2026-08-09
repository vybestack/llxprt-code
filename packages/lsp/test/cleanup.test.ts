/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { runCleanupTaskGroups } from './cleanup.js';

describe('runCleanupTaskGroups', () => {
  it('attempts every task in every group and aggregates all failures', async () => {
    let attempts: string[] = [];
    const record = (name: string): void => {
      attempts = [...attempts, name];
    };

    let thrown: unknown;
    try {
      await runCleanupTaskGroups(
        [
          [
            () => {
              record('shutdown-a');
              throw new Error('shutdown-a failed');
            },
            () => {
              record('shutdown-b');
              throw new Error('shutdown-b failed');
            },
          ],
          [
            () => {
              record('temp-cleanup');
              throw new Error('temp-cleanup failed');
            },
          ],
        ],
        'cleanup failed',
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(attempts.sort()).toEqual([
      'shutdown-a',
      'shutdown-b',
      'temp-cleanup',
    ]);
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) {
      throw new Error('Expected cleanup to throw AggregateError');
    }
    expect(thrown.errors).toHaveLength(3);
  });

  it('throws a single failure without wrapping it', async () => {
    const failure = new Error('single failure');

    await expect(
      runCleanupTaskGroups([[() => Promise.reject(failure)]], 'cleanup failed'),
    ).rejects.toBe(failure);
  });
});
