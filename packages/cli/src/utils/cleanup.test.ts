/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { FileOutput, ShellExecutionService } from '@vybestack/llxprt-code-core';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  registerSyncCleanup,
  runBestEffortSyncCleanup,
  runExitCleanup,
} from './cleanup';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('cleanup', () => {
  beforeEach(() => {
    // Reset cleanup state between tests
    __resetCleanupStateForTesting();
  });

  it('should preserve the caller flow when synchronous cleanup throws', () => {
    expect(() =>
      runBestEffortSyncCleanup(() => {
        throw new Error('cleanup failure');
      }),
    ).not.toThrow();
  });

  it('should report synchronous cleanup failures without throwing', () => {
    let reportedError: unknown;

    runBestEffortSyncCleanup(
      () => {
        throw new Error('cleanup failure');
      },
      (error) => {
        reportedError = error;
      },
    );

    expect(reportedError).toStrictEqual(new Error('cleanup failure'));
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

    expect(executionOrder).toStrictEqual([1, 2]);
  });

  it('should continue executing cleanup functions after an async cleanup rejects', async () => {
    let firstRan = false;
    let secondRan = false;

    registerCleanup(async () => {
      firstRan = true;
      throw new Error('Test Error');
    });
    registerCleanup(async () => {
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

  it('should dispose FileOutput after running registered cleanup handlers', async () => {
    const executionOrder: string[] = [];
    FileOutput.getInstance();
    const disposeSpy = vi
      .spyOn(FileOutput.prototype, 'dispose')
      .mockImplementation(async () => {
        executionOrder.push('file-output');
      });

    registerCleanup(() => {
      executionOrder.push('cleanup');
    });

    await runExitCleanup();

    expect(executionOrder).toStrictEqual(['cleanup', 'file-output']);
    expect(disposeSpy).toHaveBeenCalledOnce();
    disposeSpy.mockRestore();
  });

  it('should execute synchronous cleanups before asynchronous cleanups', async () => {
    const executionOrder: string[] = [];

    registerCleanup(async () => {
      executionOrder.push('async-1');
    });
    registerSyncCleanup(() => {
      executionOrder.push('sync-1');
    });
    registerCleanup(async () => {
      executionOrder.push('async-2');
    });
    registerSyncCleanup(() => {
      executionOrder.push('sync-2');
    });

    await runExitCleanup();

    expect(executionOrder).toStrictEqual([
      'sync-1',
      'sync-2',
      'async-1',
      'async-2',
    ]);
  });

  it('should continue executing sync cleanups even if one throws', async () => {
    let firstSyncRan = false;
    let secondSyncRan = false;

    registerSyncCleanup(() => {
      firstSyncRan = true;
      throw new Error('Sync cleanup error');
    });
    registerSyncCleanup(() => {
      secondSyncRan = true;
    });

    await runExitCleanup();

    expect(firstSyncRan).toBe(true);
    expect(secondSyncRan).toBe(true);
  });

  it('should drain callbacks registered via registerCleanup during async draining', async () => {
    const executionOrder: string[] = [];

    registerCleanup(async () => {
      executionOrder.push('async-1');
      registerCleanup(() => {
        executionOrder.push('async-appended');
      });
    });

    await runExitCleanup();

    expect(executionOrder).toStrictEqual(['async-1', 'async-appended']);
  });

  it('should run sync callbacks registered during sync draining (drain-until-empty)', async () => {
    const executionOrder: string[] = [];

    registerSyncCleanup(() => {
      executionOrder.push('sync-1');
      registerSyncCleanup(() => {
        executionOrder.push('sync-appended');
      });
    });

    await runExitCleanup();

    expect(executionOrder).toStrictEqual(['sync-1', 'sync-appended']);
  });
});

describe('cleanup state reset', () => {
  beforeEach(() => {
    __resetCleanupStateForTesting();
  });

  it('reset clears pending async callbacks so they do not run after reset', async () => {
    let asyncRan = false;
    registerCleanup(() => {
      asyncRan = true;
    });

    __resetCleanupStateForTesting();

    await runExitCleanup();

    expect(asyncRan).toBe(false);
  });

  it('reset clears pending sync callbacks so they do not run after reset', async () => {
    let syncRan = false;
    registerSyncCleanup(() => {
      syncRan = true;
    });

    __resetCleanupStateForTesting();

    await runExitCleanup();

    expect(syncRan).toBe(false);
  });

  it('reset returns the in-progress guard to idle allowing cleanup to run again', async () => {
    let firstCount = 0;
    registerCleanup(() => {
      firstCount++;
    });

    await runExitCleanup();
    expect(firstCount).toBe(1);

    // After completion the guard is still set — cleanup won't run again
    let secondCount = 0;
    registerCleanup(() => {
      secondCount++;
    });
    await runExitCleanup();
    expect(secondCount).toBe(0);

    // After reset, the guard is cleared and cleanup can run
    __resetCleanupStateForTesting();
    let thirdCount = 0;
    registerCleanup(() => {
      thirdCount++;
    });
    await runExitCleanup();
    expect(thirdCount).toBe(1);
  });

  it('reset clears both sync and async queues before draining', async () => {
    const order: string[] = [];
    registerSyncCleanup(() => {
      order.push('sync');
    });
    registerCleanup(async () => {
      order.push('async');
    });

    __resetCleanupStateForTesting();

    let ran = false;
    registerCleanup(() => {
      ran = true;
    });
    await runExitCleanup();

    expect(order).toStrictEqual([]);
    expect(ran).toBe(true);
  });
});

describe('cleanup-state module owns the reset state', () => {
  // These tests import directly from the lightweight state module to prove
  // that the state is actually owned there, not merely re-exported. The
  // behavior must be identical whether accessed via cleanup.ts (public API)
  // or cleanup-state.ts (internal owner).
  beforeEach(() => {
    __resetCleanupStateForTesting();
  });

  it('resetting via the state module clears callbacks registered via cleanup.ts', async () => {
    let ran = false;
    registerCleanup(() => {
      ran = true;
    });
    registerSyncCleanup(() => {
      ran = true;
    });

    // Import the state module's reset — must clear state owned by cleanup.ts
    const { __resetCleanupStateForTesting: resetFromState } = await import(
      './cleanup-state'
    );
    resetFromState();

    await runExitCleanup();
    expect(ran).toBe(false);
  });

  it('the state module reset allows cleanup to run again after completion', async () => {
    let count = 0;
    registerCleanup(() => {
      count++;
    });

    await runExitCleanup();
    expect(count).toBe(1);

    // Guard is now set; a second run won't fire
    registerCleanup(() => {
      count++;
    });
    await runExitCleanup();
    expect(count).toBe(1);

    const { __resetCleanupStateForTesting: resetFromState } = await import(
      './cleanup-state'
    );
    resetFromState();

    registerCleanup(() => {
      count++;
    });
    await runExitCleanup();
    expect(count).toBe(2);
  });
});

describe('cleanup-state dependency isolation', () => {
  it('cleanup-state.ts source has zero import declarations (pure lightweight module)', () => {
    const filePath = resolve(__dirname, 'cleanup-state.ts');
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    const imports = sourceFile.statements.filter(ts.isImportDeclaration);

    expect(imports).toHaveLength(0);
  });
});
