/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installNonInteractiveSigintHandler } from './cli.js';
import { runExitCleanup } from './utils/cleanup.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('./utils/cleanup.js', () => ({
  runExitCleanup: vi.fn(async () => {}),
}));

describe('installNonInteractiveSigintHandler', () => {
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let capturedSigintListeners: Array<() => void> = [];

  beforeEach(() => {
    capturedSigintListeners = [];
    vi.mocked(runExitCleanup).mockClear();
    stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') {
          capturedSigintListeners.push(listener as () => void);
        }
        return process;
      },
    );
    vi.spyOn(process, 'off').mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') {
          capturedSigintListeners = capturedSigintListeners.filter(
            (l) => l !== (listener as () => void),
          );
        }
        return process;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register a SIGINT listener', () => {
    installNonInteractiveSigintHandler();

    expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);
  });

  it('should write cancellation message to stderr, clean up, and hard-exit 130 on SIGINT', async () => {
    const exitProcess = vi.fn<(code: number) => never>();
    installNonInteractiveSigintHandler(exitProcess);

    expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);
    const handler = capturedSigintListeners[capturedSigintListeners.length - 1];

    handler();
    await vi.waitFor(() => {
      expect(exitProcess).toHaveBeenCalledWith(130);
      expect(runExitCleanup).toHaveBeenCalledTimes(1);
    });

    const stderrOutput = stderrWriteSpy.mock.calls
      .map(([value]: [string]) => value)
      .join('');
    expect(stderrOutput).toContain('Cancelled');
  });

  it('should not double-exit on repeated SIGINT signals', async () => {
    const exitProcess = vi.fn<(code: number) => never>();
    installNonInteractiveSigintHandler(exitProcess);

    const handler = capturedSigintListeners[capturedSigintListeners.length - 1];

    handler();
    await vi.waitFor(() => {
      expect(exitProcess).toHaveBeenCalledWith(130);
    });

    vi.mocked(exitProcess).mockClear();
    vi.mocked(runExitCleanup).mockClear();
    stderrWriteSpy.mockClear();

    handler();

    expect(exitProcess).not.toHaveBeenCalled();
    expect(runExitCleanup).not.toHaveBeenCalled();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it('should return a removal function that unregisters the SIGINT listener', () => {
    const remove = installNonInteractiveSigintHandler();

    const listenerCountBefore = capturedSigintListeners.length;
    remove();

    expect(capturedSigintListeners.length).toBeLessThan(listenerCountBefore);
  });

  describe('handler installation ordering', () => {
    it('should provide the removal function synchronously so callers can install before async operations', () => {
      // The handler must be installed synchronously (not deferred via
      // setImmediate, setTimeout, or process.nextTick) so that the caller
      // in cli.tsx can wrap subsequent async operations (auth validation,
      // session-start hook) with the handler already active.
      const removalFn = installNonInteractiveSigintHandler();

      // The listener should already be registered synchronously
      expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);

      // Removal function should also work synchronously
      removalFn();
    });

    it('should allow SIGINT to be caught during async setup when installed early', async () => {
      const exitProcess = vi.fn<(code: number) => never>();
      const removalFn = installNonInteractiveSigintHandler(exitProcess);

      expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);
      const handler =
        capturedSigintListeners[capturedSigintListeners.length - 1];

      // Simulate an async gap (like validateNonInteractiveAuth or
      // triggerSessionStartHook) where SIGINT could arrive.
      await new Promise((resolve) => setTimeout(resolve, 0));

      handler();
      await vi.waitFor(() => {
        expect(exitProcess).toHaveBeenCalledWith(130);
      });

      removalFn();
    });
  });
});
