/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from './cleanup';
import { ShellExecutionService } from '@vybestack/llxprt-code-core';

describe('cleanup', () => {
  beforeEach(() => {
    // Reset cleanup state between tests
    __resetCleanupStateForTesting();
  });

  it('should execute registered synchronous cleanup function', async () => {
    let cleaned = false;
    registerCleanup(() => {
      cleaned = true;
    });

    await runExitCleanup();

    expect(cleaned).toBe(true);
  });

  it('should execute registered asynchronous cleanup function', async () => {
    let cleaned = false;
    registerCleanup(async () => {
      cleaned = true;
    });

    await runExitCleanup();

    expect(cleaned).toBe(true);
  });

  it('should execute multiple registered functions in order', async () => {
    const executionOrder: number[] = [];

    registerCleanup(() => {
      executionOrder.push(1);
    });
    registerCleanup(async () => {
      executionOrder.push(2);
    });

    await runExitCleanup();

    expect(executionOrder).toEqual([1, 2]);
  });

  it('should continue executing cleanup functions even if one throws an error', async () => {
    let firstRan = false;
    let secondRan = false;

    registerCleanup(() => {
      firstRan = true;
      throw new Error('Test Error');
    });
    registerCleanup(() => {
      secondRan = true;
    });

    await runExitCleanup();

    expect(firstRan).toBe(true);
    expect(secondRan).toBe(true);
  });

  it('should not execute cleanup functions more than once when called concurrently', async () => {
    let callCount = 0;
    registerCleanup(() => {
      callCount++;
    });

    // Call runExitCleanup multiple times concurrently
    await Promise.all([runExitCleanup(), runExitCleanup(), runExitCleanup()]);

    // Should only execute once due to reentrancy guard
    expect(callCount).toBe(1);
  });

  it('should clear registered cleanup functions after execution', async () => {
    let firstCleanupCount = 0;
    registerCleanup(() => {
      firstCleanupCount++;
    });

    await runExitCleanup();
    expect(firstCleanupCount).toBe(1);

    // Register new cleanup after first run
    let secondCleanupCount = 0;
    registerCleanup(() => {
      secondCleanupCount++;
    });

    // This won't run because cleanupInProgress flag is still true
    // This is the expected behavior - cleanup should only run once per process
    await runExitCleanup();

    expect(firstCleanupCount).toBe(1); // Should not run again
    expect(secondCleanupCount).toBe(0); // Should not run due to guard
  });

  it('should tolerate duplicate destroyAllPtys calls when also registered as manual cleanup', async () => {
    const destroyAllSpy = vi
      .spyOn(ShellExecutionService, 'destroyAllPtys')
      .mockImplementation(() => {});

    // Simulate legacy code that also registers destroyAllPtys manually
    registerCleanup(() => {
      ShellExecutionService.destroyAllPtys();
    });

    await runExitCleanup();

    // Called twice: once by runExitCleanup itself, once by the registered cleanup
    expect(destroyAllSpy).toHaveBeenCalledTimes(2);
    destroyAllSpy.mockRestore();
  });

  it('should invoke ShellExecutionService.destroyAllPtys automatically without manual registration', async () => {
    const destroyAllSpy = vi
      .spyOn(ShellExecutionService, 'destroyAllPtys')
      .mockImplementation(() => {});

    // No registerCleanup call — runExitCleanup should invoke destroyAllPtys itself
    await runExitCleanup();

    expect(destroyAllSpy).toHaveBeenCalledOnce();
    destroyAllSpy.mockRestore();
  });

  it('should not throw if ShellExecutionService.destroyAllPtys throws during cleanup', async () => {
    const destroyAllSpy = vi
      .spyOn(ShellExecutionService, 'destroyAllPtys')
      .mockImplementation(() => {
        throw new Error('PTY cleanup error');
      });

    let cleanupRan = false;
    registerCleanup(() => {
      cleanupRan = true;
    });

    await runExitCleanup();

    expect(destroyAllSpy).toHaveBeenCalledOnce();
    expect(cleanupRan).toBe(true);
    destroyAllSpy.mockRestore();
  });
});
