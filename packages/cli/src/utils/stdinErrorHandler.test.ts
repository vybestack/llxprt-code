/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for stdin error handling to prevent EIO crashes.
 *
 * Issue #1020: After 28+ minutes, macOS terminals can experience transient I/O
 * errors on stdin when raw mode is enabled. Without error handlers, these crash
 * the entire process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StdinRawModeManager,
  installStdinErrorHandler,
  withSafeRawMode,
  _resetGlobalStdinErrorHandler,
} from './stdinSafety.js';

type TestStdin = NodeJS.ReadStream & {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode: (mode: boolean) => NodeJS.ReadStream;
  resume: () => NodeJS.ReadStream;
  pause: () => NodeJS.ReadStream;
};

const stdin = process.stdin as TestStdin;

describe('stdin EIO error handling', () => {
  let originalIsTTY: boolean | undefined;
  let originalIsRaw: boolean | undefined;
  let mockSetRawMode: ReturnType<typeof vi.fn>;
  let mockResume: ReturnType<typeof vi.fn>;
  let mockPause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalIsTTY = stdin.isTTY;
    originalIsRaw = stdin.isRaw;

    mockSetRawMode = vi.fn<(mode: boolean) => NodeJS.ReadStream>(() => stdin);
    mockResume = vi.fn<() => NodeJS.ReadStream>(() => stdin);
    mockPause = vi.fn<() => NodeJS.ReadStream>(() => stdin);

    // Mock process.stdin methods
    stdin.setRawMode = mockSetRawMode;
    stdin.resume = mockResume;
    stdin.pause = mockPause;

    // Ensure isPaused is available (if it wasn't already)
    if (
      typeof (stdin as unknown as Record<string, unknown>).isPaused !==
      'function'
    ) {
      (stdin as unknown as Record<string, unknown>).isPaused = vi.fn(
        () => false,
      );
    }
  });

  afterEach(() => {
    // Restore original methods
    if (originalIsTTY !== undefined) {
      stdin.isTTY = originalIsTTY;
    }
    if (originalIsRaw !== undefined) {
      stdin.isRaw = originalIsRaw;
    }
    mockSetRawMode.mockRestore();
    mockResume.mockRestore();
    mockPause.mockRestore();

    // Clean up the isPaused mock if it was added during the test
    const stdinRecord = stdin as unknown as Record<string, unknown>;
    const isPaused = stdinRecord.isPaused;
    if (
      typeof isPaused === 'function' &&
      isPaused &&
      (isPaused as unknown as { mockRestore: () => void }).mockRestore
    ) {
      (isPaused as unknown as { mockRestore: () => void }).mockRestore();
      delete stdinRecord.isPaused;
    }

    // Clean up any error listeners
    const listeners = process.stdin.listeners('error') as Array<
      (err: Error) => void
    >;
    for (const listener of listeners) {
      if (listener.name === 'stdinErrorHandler') {
        process.stdin.removeListener('error', listener);
      }
    }

    // Reset global handler state
    _resetGlobalStdinErrorHandler();
  });

  describe('StdinRawModeManager', () => {
    it('should enable raw mode with error handling', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const manager = new StdinRawModeManager({ debug: true });

      manager.enable();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(manager.getManaged()).toBe(true);

      manager.disable();
    });

    it('should install error handler when enabling raw mode', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const manager = new StdinRawModeManager();

      manager.enable();

      const errorHandler = manager.getErrorHandler();
      const listeners = process.stdin.listeners('error');
      expect(listeners).toContain(errorHandler);

      manager.disable();
    });

    it('should handle EIO errors without crashing', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const onError = vi.fn();
      const manager = new StdinRawModeManager({ onError });

      manager.enable();

      // Simulate EIO error
      const eioError: NodeJS.ErrnoException = new Error('read EIO');
      eioError.code = 'EIO';
      eioError.errno = -5;

      // This should not throw
      expect(() => {
        process.stdin.emit('error', eioError);
      }).not.toThrow();

      // Verify custom error handler was called
      expect(onError).toHaveBeenCalledWith(eioError);

      manager.disable();
    });

    it('should resume stdin if paused after error', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;
      // Mock isPaused to return true
      const mockIsPaused = vi.fn(() => true);
      (stdin as unknown as Record<string, unknown>).isPaused = mockIsPaused;

      const manager = new StdinRawModeManager();

      manager.enable();

      const testError = new Error('test error');
      process.stdin.emit('error', testError);

      expect(mockResume).toHaveBeenCalled();

      manager.disable();
      // Cleanup happens in afterEach
    });

    it('should log errors in debug mode', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const consoleErrorSpy = vi.spyOn(console, 'error');
      const manager = new StdinRawModeManager({ debug: true });

      manager.enable();

      const testError = new Error('test error');
      process.stdin.emit('error', testError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[stdin] I/O error (non-fatal):',
        testError,
      );

      manager.disable();
      consoleErrorSpy.mockRestore();
    });

    it('should disable raw mode and remove error handler', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const manager = new StdinRawModeManager();
      manager.enable();

      const errorHandler = manager.getErrorHandler();
      expect(process.stdin.listeners('error')).toContain(errorHandler);

      manager.disable();

      expect(mockSetRawMode).toHaveBeenCalledWith(false);
      expect(process.stdin.listeners('error')).not.toContain(errorHandler);
      expect(manager.getManaged()).toBe(false);
    });

    it('should restore previous raw state on disable', () => {
      stdin.isTTY = true;
      stdin.isRaw = true;

      const manager = new StdinRawModeManager();
      manager.enable();

      manager.disable(true); // restorePreviousState = true

      expect(mockSetRawMode).toHaveBeenCalledWith(true); // Was raw, restore to raw
    });

    it('should handle being enabled when already in raw mode', () => {
      stdin.isTTY = true;
      stdin.isRaw = true; // Already in raw mode

      const manager = new StdinRawModeManager();
      manager.enable();

      // Should not call setRawMode, but should install error handler
      expect(mockSetRawMode).not.toHaveBeenCalled();
      expect(manager.getManaged()).toBe(true);

      manager.disable();
    });

    it('should not enable if not a TTY', () => {
      stdin.isTTY = false;

      const manager = new StdinRawModeManager();
      const enabled = manager.enable();

      expect(enabled).toBe(false);
      expect(mockSetRawMode).not.toHaveBeenCalled();
      expect(manager.getManaged()).toBe(false);
    });

    it('should handle setRawMode failures gracefully', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;
      mockSetRawMode.mockImplementation(() => {
        throw new Error('Cannot set raw mode');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error');
      const manager = new StdinRawModeManager({ debug: true });

      const enabled = manager.enable();

      expect(enabled).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(manager.getManaged()).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it('should call custom error handler', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const customHandler = vi.fn();
      const manager = new StdinRawModeManager({ onError: customHandler });

      manager.enable();

      const testError = new Error('custom error');
      process.stdin.emit('error', testError);

      expect(customHandler).toHaveBeenCalledWith(testError);

      manager.disable();
    });
  });

  describe('installStdinErrorHandler', () => {
    it('should install a global stdin error handler', () => {
      const handler = installStdinErrorHandler({ debug: true });

      const listeners = process.stdin.listeners('error');
      expect(listeners).toContain(handler);

      // Remove it after test
      process.stdin.removeListener('error', handler);
    });

    it('should not install duplicate handlers', () => {
      const initialCount = process.stdin.listeners('error').length;
      const handler1 = installStdinErrorHandler();
      const countAfterFirst = process.stdin.listeners('error').length;
      const handler2 = installStdinErrorHandler();
      const countAfterSecond = process.stdin.listeners('error').length;

      expect(countAfterFirst).toBe(initialCount + 1);
      expect(countAfterSecond).toBe(countAfterFirst);

      process.stdin.removeListener('error', handler1);
      process.stdin.removeListener('error', handler2);
    });

    it('should handle errors without crashing', () => {
      const handler = installStdinErrorHandler();

      const testError = new Error('test error');
      expect(() => {
        process.stdin.emit('error', testError);
      }).not.toThrow();

      process.stdin.removeListener('error', handler);
    });
  });

  describe('withSafeRawMode', () => {
    it('should enable raw mode for synchronous function', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const fn = vi.fn(() => 'result');
      const safeFn = withSafeRawMode(fn);

      const result = safeFn();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockSetRawMode).toHaveBeenCalledWith(false); // Cleanup
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should enable raw mode for async function', async () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const fn = vi.fn(async () => 'async-result');
      const safeFn = withSafeRawMode(fn);

      const result = await safeFn();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockSetRawMode).toHaveBeenCalledWith(false); // Cleanup
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('async-result');
    });

    it('should cleanup on error', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const fn = vi.fn(() => {
        throw new Error('test error');
      });
      const safeFn = withSafeRawMode(fn);

      expect(() => {
        safeFn();
      }).toThrow('test error');

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockSetRawMode).toHaveBeenCalledWith(false); // Cleanup
    });

    it('should install error handler while function runs', () => {
      stdin.isTTY = true;
      stdin.isRaw = false;

      const fn = vi.fn(() => {
        const listeners = process.stdin.listeners('error');
        expect(listeners).toBeDefined();
        expect(listeners.length).toBeGreaterThan(0);
      });
      const safeFn = withSafeRawMode(fn);

      safeFn();

      expect(fn).toHaveBeenCalled();
    });
  });
});
