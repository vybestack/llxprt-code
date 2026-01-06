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
} from './stdinSafety.js';

describe('stdin EIO error handling', () => {
  let originalIsTTY: boolean;
  let originalIsRaw: boolean | undefined;
  let mockSetRawMode: ReturnType<typeof vi.fn>;
  let mockResume: ReturnType<typeof vi.fn>;
  let mockPause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalIsRaw = process.stdin.isRaw;

    mockSetRawMode = vi.fn();
    mockResume = vi.fn(() => process.stdin);
    mockPause = vi.fn(() => process.stdin);

    // Mock process.stdin methods
    (process.stdin as any).setRawMode = mockSetRawMode;
    (process.stdin as any).resume = mockResume;
    (process.stdin as any).pause = mockPause;
  });

  afterEach(() => {
    // Restore original methods
    (process.stdin as any).isTTY = originalIsTTY;
    (process.stdin as any).isRaw = originalIsRaw;
    mockSetRawMode.mockRestore();
    mockResume.mockRestore();
    mockPause.mockRestore();

    // Clean up any error listeners
    const listeners = process.stdin.listeners('error') as Array<
      (err: Error) => void
    >;
    for (const listener of listeners) {
      if (listener.name === 'stdinErrorHandler') {
        process.stdin.removeListener('error', listener);
      }
    }
  });

  describe('StdinRawModeManager', () => {
    it('should enable raw mode with error handling', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

      const manager = new StdinRawModeManager({ debug: true });

      manager.enable();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(manager.getManaged()).toBe(true);

      manager.disable();
    });

    it('should install error handler when enabling raw mode', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

      const manager = new StdinRawModeManager();

      manager.enable();

      const errorHandler = manager.getErrorHandler();
      const listeners = process.stdin.listeners('error');
      expect(listeners).toContain(errorHandler);

      manager.disable();
    });

    it('should handle EIO errors without crashing', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

      const onError = vi.fn();
      const manager = new StdinRawModeManager({ onError });

      manager.enable();

      // Simulate EIO error
      const eioError = new Error('read EIO');
      (eioError as any).code = 'EIO';
      (eioError as any).errno = -5;

      // This should not throw
      expect(() => {
        process.stdin.emit('error', eioError);
      }).not.toThrow();

      // Verify custom error handler was called
      expect(onError).toHaveBeenCalledWith(eioError);

      manager.disable();
    });

    it('should resume stdin if paused after error', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;
      (process.stdin as any).isPaused = vi.fn(() => true);

      const manager = new StdinRawModeManager();

      manager.enable();

      const testError = new Error('test error');
      process.stdin.emit('error', testError);

      expect(mockResume).toHaveBeenCalled();

      manager.disable();
      delete (process.stdin as any).isPaused;
    });

    it('should log errors in debug mode', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

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
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

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
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = true;

      const manager = new StdinRawModeManager();
      manager.enable();

      manager.disable(true); // restorePreviousState = true

      expect(mockSetRawMode).toHaveBeenCalledWith(true); // Was raw, restore to raw
    });

    it('should handle being enabled when already in raw mode', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = true; // Already in raw mode

      const manager = new StdinRawModeManager();
      manager.enable();

      // Should not call setRawMode, but should install error handler
      expect(mockSetRawMode).not.toHaveBeenCalled();
      expect(manager.getManaged()).toBe(true);

      manager.disable();
    });

    it('should not enable if not a TTY', () => {
      (process.stdin as any).isTTY = false;

      const manager = new StdinRawModeManager();
      const enabled = manager.enable();

      expect(enabled).toBe(false);
      expect(mockSetRawMode).not.toHaveBeenCalled();
      expect(manager.getManaged()).toBe(false);
    });

    it('should handle setRawMode failures gracefully', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;
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
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

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
      const handler1 = installStdinErrorHandler();
      const handler2 = installStdinErrorHandler();

      const listeners = process.stdin.listeners('error');
      const uniqueHandlers = listeners.filter((l) => l === handler1);

      expect(uniqueHandlers.length).toBe(1);

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
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

      const fn = vi.fn(() => 'result');
      const safeFn = withSafeRawMode(fn);

      const result = safeFn();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockSetRawMode).toHaveBeenCalledWith(false); // Cleanup
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should enable raw mode for async function', async () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

      const fn = vi.fn(async () => 'async-result');
      const safeFn = withSafeRawMode(fn);

      const result = await safeFn();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockSetRawMode).toHaveBeenCalledWith(false); // Cleanup
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('async-result');
    });

    it('should cleanup on error', () => {
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

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
      (process.stdin as any).isTTY = true;
      (process.stdin as any).isRaw = false;

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