/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { ShellExecutionService } from '@vybestack/llxprt-code-core';
import { installNonInteractiveSigintHandler } from '../session/signalHandlers.js';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from './cleanup.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('runExitCleanup overlapping callers (issue #3517)', () => {
  beforeEach(() => {
    __resetCleanupStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not settle a second caller until the first caller has finished PTY group teardown', async () => {
    const teardown = deferred();
    vi.spyOn(ShellExecutionService, 'destroyAllPtys').mockImplementation(
      () => teardown.promise,
    );

    let secondSettled = false;
    const first = runExitCleanup();
    const second = runExitCleanup().then(() => {
      secondSettled = true;
    });

    await flushMicrotasks();
    expect(secondSettled).toBe(false);

    teardown.resolve();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
  });

  it('runs registered cleanups and PTY teardown once across overlapping callers', async () => {
    const teardown = deferred();
    const destroyAll = vi
      .spyOn(ShellExecutionService, 'destroyAllPtys')
      .mockImplementation(() => teardown.promise);
    let cleanupRuns = 0;
    registerCleanup(() => {
      cleanupRuns++;
    });

    const callers = [runExitCleanup(), runExitCleanup(), runExitCleanup()];
    teardown.resolve();
    await Promise.all(callers);

    expect(cleanupRuns).toBe(1);
    expect(destroyAll).toHaveBeenCalledTimes(1);
  });

  it('does not run the exit callback of an overlapping SIGINT handler before PTY teardown completes', async () => {
    const teardown = deferred();
    vi.spyOn(ShellExecutionService, 'destroyAllPtys').mockImplementation(
      () => teardown.promise,
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let sigintListener: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, listener: (...args: never[]) => void) => {
        if (event === 'SIGINT') {
          sigintListener = listener as () => void;
        }
        return process;
      },
    );
    vi.spyOn(process, 'off').mockImplementation(() => process);
    const exitCodes: number[] = [];
    const uninstall = installNonInteractiveSigintHandler((code) => {
      exitCodes.push(code);
      return undefined as never;
    });

    // The normal exit path owns teardown first; the signal arrives mid-teardown.
    const normalExit = runExitCleanup();
    sigintListener?.();
    await flushMicrotasks();
    expect(exitCodes).toStrictEqual([]);

    teardown.resolve();
    await normalExit;
    await flushMicrotasks();
    expect(exitCodes).toStrictEqual([130]);
    uninstall();
  });
});
