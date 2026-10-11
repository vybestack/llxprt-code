/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { initializeHookDefinitions } from './hook-initialization.js';

describe('initialization fixture lifetime', () => {
  afterEach(() => vi.useRealTimers());

  describe('hook initialization admission', () => {
    it('rejects an already cancelled admission with the exact reason and does no initialization', async () => {
      const controller = new AbortController();
      const reason = Symbol('cancelled before admission');
      controller.abort(reason);
      let activated = false;
      await expect(
        initializeHookDefinitions(async () => {
          activated = true;
        }, controller.signal),
      ).rejects.toBe(reason);
      expect(activated).toBe(false);
    });

    it('does not start initialization when cancelled before the admitted microtask executes', async () => {
      const controller = new AbortController();
      const reason = new Error('closed before initialization');
      let activated = false;
      const pending = initializeHookDefinitions(async () => {
        activated = true;
      }, controller.signal);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(activated).toBe(false);
    });

    it('bounds an external stalled loader and cancels its actual operation signal', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let operation: AbortSignal | undefined;
      const pending = initializeHookDefinitions(async (signal) => {
        operation = signal;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      }, controller.signal);
      const failure = pending.then(
        () => undefined,
        (error: unknown) => error,
      );
      await Promise.resolve();
      await advanceTimersByTimeAsync(29_999);
      expect(operation?.aborted).toBe(false);
      await advanceTimersByTimeAsync(1);
      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect(operation?.reason).toBe(error);
    });

    it('retains a rejected loader identity and does not abort a completed load later', async () => {
      vi.useFakeTimers();
      const reason = new Error('physical definition load failed');
      const controller = new AbortController();
      let operation: AbortSignal | undefined;
      await expect(
        initializeHookDefinitions(async (signal) => {
          operation = signal;
          throw reason;
        }, controller.signal),
      ).rejects.toBe(reason);
      controller.abort(new Error('later session retirement'));
      await advanceTimersByTimeAsync(30_001);
      expect(operation?.aborted).toBe(false);
    });
  });
});
