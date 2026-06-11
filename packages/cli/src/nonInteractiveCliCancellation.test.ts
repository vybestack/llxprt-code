/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStdinCancellation } from './nonInteractiveCli.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

type TestStdin = NodeJS.ReadStream & {
  isTTY?: boolean;
  isRaw?: boolean;
};

const stdin = process.stdin as TestStdin;

class ExitCalledError extends Error {
  readonly exitCode: number;
  constructor(code: number) {
    super(`process.exit(${code}) called`);
    this.name = 'ExitCalledError';
    this.exitCode = code;
  }
}

function catchExit(fn: () => void): ExitCalledError | undefined {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof ExitCalledError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

function setupTtyStdin(): {
  simulateKeypress: (
    str: string,
    key: { name?: string; ctrl?: boolean },
  ) => void;
  getRemoveListenerCalls: () => Array<{
    event: string;
    listener: (...args: unknown[]) => void;
  }>;
  getRemoveAllListenersCalls: () => number;
  restore: () => void;
} {
  const keypressListeners: Array<
    (str: string, key: { name?: string; ctrl?: boolean }) => void
  > = [];

  const mockSetRawMode = vi.fn<(mode: boolean) => TestStdin>(() => stdin);
  const mockResume = vi.fn<() => TestStdin>(() => stdin);
  const mockPause = vi.fn<() => TestStdin>(() => stdin);
  const mockRemoveAllListeners = vi.fn<() => TestStdin>(() => stdin);
  const removeListenerCalls: Array<{
    event: string;
    listener: (...args: unknown[]) => void;
  }> = [];

  // Capture originals before any mocking so restore puts back the real
  // process.stdin methods instead of the mock fns.
  const origOn = stdin.on.bind(stdin);
  const origRemoveListener = stdin.removeListener.bind(stdin);
  const origSetRawMode = stdin.setRawMode;
  const origResume = stdin.resume;
  const origPause = stdin.pause;
  const origRemoveAllListeners = stdin.removeAllListeners;
  const origIsTTY = stdin.isTTY;
  const origIsRaw = stdin.isRaw;

  stdin.setRawMode = mockSetRawMode;
  stdin.resume = mockResume;
  stdin.isTTY = true;
  stdin.isRaw = false;

  vi.spyOn(stdin, 'on').mockImplementation(
    (event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'keypress') {
        keypressListeners.push(
          listener as (
            str: string,
            key: { name?: string; ctrl?: boolean },
          ) => void,
        );
      }
      return stdin;
    },
  );
  vi.spyOn(stdin, 'removeListener').mockImplementation(
    (event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (typeof event === 'string') {
        removeListenerCalls.push({ event, listener });
        if (event === 'keypress') {
          const idx = keypressListeners.indexOf(
            listener as (
              str: string,
              key: { name?: string; ctrl?: boolean },
            ) => void,
          );
          if (idx !== -1) {
            keypressListeners.splice(idx, 1);
          }
        }
      }
      return stdin;
    },
  );
  stdin.removeAllListeners = mockRemoveAllListeners;
  stdin.pause = mockPause;

  return {
    simulateKeypress: (str: string, key: { name?: string; ctrl?: boolean }) => {
      for (const listener of keypressListeners) {
        listener(str, key);
      }
    },
    getRemoveListenerCalls: () => removeListenerCalls,
    getRemoveAllListenersCalls: () => mockRemoveAllListeners.mock.calls.length,
    restore: () => {
      stdin.on = origOn;
      stdin.removeListener = origRemoveListener;
      stdin.setRawMode = origSetRawMode;
      stdin.resume = origResume;
      stdin.pause = origPause;
      stdin.removeAllListeners = origRemoveAllListeners;
      stdin.isTTY = origIsTTY;
      stdin.isRaw = origIsRaw;
    },
  };
}

describe('createStdinCancellation', () => {
  let abortController: AbortController;
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: boolean | undefined;
  let originalIsRaw: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = stdin.isTTY;
    originalIsRaw = stdin.isRaw;
    abortController = new AbortController();
    stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new ExitCalledError(typeof code === 'number' ? code : 0);
    }) as typeof process.exit);
  });

  afterEach(() => {
    stdin.isTTY = originalIsTTY;
    stdin.isRaw = originalIsRaw;
    vi.restoreAllMocks();
  });

  describe('Ctrl-C keypress handling', () => {
    it('should write cancellation message to stderr and hard-exit 130 on Ctrl-C', () => {
      const { simulateKeypress, restore } = setupTtyStdin();
      try {
        const cancellation = createStdinCancellation(abortController);
        cancellation.setup();

        const caughtExit = catchExit(() =>
          simulateKeypress('\u0003', { name: 'c', ctrl: true }),
        );

        expect(caughtExit).toBeDefined();
        expect(caughtExit!.exitCode).toBe(130);

        const stderrOutput = stderrWriteSpy.mock.calls
          .map(([value]: [string]) => value)
          .join('');
        expect(stderrOutput).toContain('Cancelled');

        expect(abortController.signal.aborted).toBe(true);
      } finally {
        restore();
      }
    });

    it('should hard-exit 130 immediately without a delayed timer', () => {
      vi.useFakeTimers();
      try {
        const { simulateKeypress, restore } = setupTtyStdin();
        try {
          const cancellation = createStdinCancellation(abortController);
          cancellation.setup();

          const caughtExit = catchExit(() =>
            simulateKeypress('\u0003', { name: 'c', ctrl: true }),
          );

          expect(caughtExit).toBeDefined();
          expect(caughtExit!.exitCode).toBe(130);

          vi.advanceTimersByTime(500);
          expect(processExitSpy).toHaveBeenCalledTimes(1);
        } finally {
          restore();
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not double-exit on repeated Ctrl-C', () => {
      const { simulateKeypress, restore } = setupTtyStdin();
      try {
        const cancellation = createStdinCancellation(abortController);
        cancellation.setup();

        catchExit(() => simulateKeypress('\u0003', { name: 'c', ctrl: true }));

        processExitSpy.mockClear();
        stderrWriteSpy.mockClear();

        simulateKeypress('\u0003', { name: 'c', ctrl: true });

        expect(processExitSpy).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('should handle Ctrl-C via raw \\u0003 character without ctrl flag', () => {
      const { simulateKeypress, restore } = setupTtyStdin();
      try {
        const cancellation = createStdinCancellation(abortController);
        cancellation.setup();

        const caughtExit = catchExit(() =>
          simulateKeypress('\u0003', { name: 'x', ctrl: false }),
        );

        expect(caughtExit).toBeDefined();
        expect(caughtExit!.exitCode).toBe(130);
        expect(abortController.signal.aborted).toBe(true);
      } finally {
        restore();
      }
    });
  });

  describe('non-TTY stdin', () => {
    it('should not register keypress listener when stdin is not a TTY', () => {
      stdin.isTTY = false;
      const onSpy = vi.spyOn(stdin, 'on');

      const cancellation = createStdinCancellation(abortController);
      cancellation.setup();

      expect(onSpy).not.toHaveBeenCalledWith('keypress', expect.any(Function));
    });

    it('should not call removeListener for keypress when stdin is not a TTY', () => {
      stdin.isTTY = false;
      const removeListenerSpy = vi.spyOn(stdin, 'removeListener');

      const cancellation = createStdinCancellation(abortController);
      cancellation.setup();
      cancellation.cleanup();

      expect(removeListenerSpy).not.toHaveBeenCalledWith(
        'keypress',
        expect.any(Function),
      );
    });
  });

  describe('targeted cleanup', () => {
    it('should use removeListener instead of removeAllListeners for keypress', () => {
      const { getRemoveListenerCalls, getRemoveAllListenersCalls, restore } =
        setupTtyStdin();
      try {
        const cancellation = createStdinCancellation(abortController);
        cancellation.setup();
        cancellation.cleanup();

        const removeListenerCalls = getRemoveListenerCalls();
        const keypressRemovals = removeListenerCalls.filter(
          (c) => c.event === 'keypress',
        );
        expect(keypressRemovals.length).toBe(1);

        expect(getRemoveAllListenersCalls()).toBe(0);
      } finally {
        restore();
      }
    });

    it('should remove only its own keypress listener and preserve unrelated ones', () => {
      const { simulateKeypress, getRemoveListenerCalls, restore } =
        setupTtyStdin();
      try {
        const unrelatedCalls: string[] = [];
        const unrelatedListener = (
          _str: string,
          key: { name?: string; ctrl?: boolean },
        ): void => {
          unrelatedCalls.push(key.name ?? '');
        };

        // Add an unrelated keypress listener before setup
        process.stdin.on('keypress', unrelatedListener);

        const cancellation = createStdinCancellation(abortController);
        cancellation.setup();

        // Both listeners should be active — simulate a non-Ctrl-C keypress
        simulateKeypress('a', { name: 'a', ctrl: false });
        // The Ctrl-C handler exits, so only test with a regular key.
        // We can't easily check the cancellation handler ran on regular keys
        // (it only reacts to Ctrl-C), but the unrelated listener should fire.
        expect(unrelatedCalls).toContain('a');

        cancellation.cleanup();

        // After cleanup, only the cancellation listener should have been removed.
        // Unrelated listener should still be present.
        const removeListenerCalls = getRemoveListenerCalls();
        const keypressRemovals = removeListenerCalls.filter(
          (c) => c.event === 'keypress',
        );
        expect(keypressRemovals.length).toBe(1);
        // The removed listener should NOT be our unrelated one
        expect(keypressRemovals[0].listener).not.toBe(unrelatedListener);

        // Clean up the unrelated listener
        process.stdin.removeListener('keypress', unrelatedListener);
      } finally {
        restore();
      }
    });
  });
});
