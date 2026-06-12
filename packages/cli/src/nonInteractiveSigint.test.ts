/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installNonInteractiveSigintHandler } from './cli.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

class ExitCalledError extends Error {
  readonly exitCode: number;
  constructor(code: number) {
    super(`process.exit(${code}) called`);
    this.name = 'ExitCalledError';
    this.exitCode = code;
  }
}

describe('installNonInteractiveSigintHandler', () => {
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let capturedSigintListeners: Array<() => void> = [];

  beforeEach(() => {
    capturedSigintListeners = [];
    stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new ExitCalledError(typeof code === 'number' ? code : 0);
    }) as typeof process.exit);
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

  it('should write cancellation message to stderr and hard-exit 130 on SIGINT', () => {
    installNonInteractiveSigintHandler();

    expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);
    const handler = capturedSigintListeners[capturedSigintListeners.length - 1];

    let caughtExit: ExitCalledError | undefined;
    try {
      handler();
    } catch (error: unknown) {
      if (error instanceof ExitCalledError) {
        caughtExit = error;
      } else {
        throw error;
      }
    }

    expect(caughtExit).toBeDefined();
    expect(caughtExit!.exitCode).toBe(130);

    const stderrOutput = stderrWriteSpy.mock.calls
      .map(([value]: [string]) => value)
      .join('');
    expect(stderrOutput).toContain('Cancelled');
  });

  it('should not double-exit on repeated SIGINT signals', () => {
    installNonInteractiveSigintHandler();

    const handler = capturedSigintListeners[capturedSigintListeners.length - 1];

    try {
      handler();
    } catch (error: unknown) {
      if (!(error instanceof ExitCalledError)) {
        throw error;
      }
    }

    processExitSpy.mockClear();
    stderrWriteSpy.mockClear();

    handler();

    expect(processExitSpy).not.toHaveBeenCalled();
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
      const removalFn = installNonInteractiveSigintHandler();

      expect(capturedSigintListeners.length).toBeGreaterThanOrEqual(1);
      const handler =
        capturedSigintListeners[capturedSigintListeners.length - 1];

      // Simulate an async gap (like validateNonInteractiveAuth or
      // triggerSessionStartHook) where SIGINT could arrive.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // SIGINT during the async gap should still be handled
      let caughtExit: ExitCalledError | undefined;
      try {
        handler();
      } catch (error: unknown) {
        if (error instanceof ExitCalledError) {
          caughtExit = error;
        } else {
          throw error;
        }
      }

      expect(caughtExit).toBeDefined();
      expect(caughtExit!.exitCode).toBe(130);

      removalFn();
    });
  });
});
