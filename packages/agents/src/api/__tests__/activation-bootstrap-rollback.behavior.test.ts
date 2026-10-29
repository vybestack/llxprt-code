/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

describe('Acquisition rollback', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('joins failed bootstrap binding cleanup and retains both failures', async () => {
    const route = await openRouteBPreflight();
    const gate = createGate();
    const entered = createGate();
    const bindingError = new Error('bootstrap binding failed');
    const cleanupError = new Error('bootstrap cleanup failed');
    let disposals = 0;
    const binding = spyOn(
      route.config,
      'getProvidedInstructions',
    ).mockImplementation(() => {
      throw bindingError;
    });
    let settled = false;
    const pending = route
      .prepare({
        trustCleanup: async (): Promise<void> => {
          disposals += 1;
          entered.release();
          await gate.promise;
          throw cleanupError;
        },
      })
      .then(
        () => undefined,
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
    try {
      await Promise.race([
        entered.promise,
        pending.then((failure) => {
          throw failure;
        }),
      ]);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      gate.release();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError))
        throw new Error('Missing aggregate');
      expect(failure.errors).toStrictEqual([bindingError, cleanupError]);
      expect(disposals).toBe(1);
    } finally {
      gate.release();
      await pending;
      binding.mockRestore();
      await route.close();
    }
  }, 30000);
});
