/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utilities for safely managing stdin raw mode with proper error handling.
 *
 * Issue #1020: After 28+ minutes, macOS terminals can experience transient I/O
 * errors on stdin when raw mode is enabled. Without error handlers, these crash
 * the entire process.
 *
 * This module provides helpers to:
 * 1. Enable raw mode with error handlers installed
 * 2. Disable raw mode with proper cleanup
 * 3. Handle EIO errors gracefully without crashing
 */

export interface StdinSafetyOptions {
  /** Enable debug logging of I/O errors */
  debug?: boolean;
  /** Custom error handler (optional) */
  onError?: (err: Error) => void;
}

/**
 * Error handler function that catches I/O errors on stdin and prevents crashes
 */
export type StdinErrorHandler = (err: Error) => void;

/**
 * Manages raw mode lifecycle with automatic error handling
 */
export class StdinRawModeManager {
  private errorHandler: StdinErrorHandler;
  private isEnabled = false;
  private wasRawBeforeEnable = false;
  private debugModeEnabled = false;

  constructor(private options?: StdinSafetyOptions) {
    this.errorHandler = this.createErrorHandler();
    this.debugModeEnabled = this.options?.debug ?? false;
  }

  /**
   * Create an error handler for stdin I/O errors
   */
  private createErrorHandler(): StdinErrorHandler {
    const handler: StdinErrorHandler = (err: Error) => {
      // Log the error in debug mode
      if (this.debugModeEnabled) {
        console.error('[stdin] I/O error (non-fatal):', err);
      }

      // Allow custom error handling
      if (this.options?.onError) {
        this.options.onError(err);
      }

      // Attempt to resume stdin if it was paused
      // This is a best-effort recovery attempt
      if (process.stdin.isPaused()) {
        try {
          process.stdin.resume();
        } catch (resumeErr) {
          // Ignore resume failures - we've already logged the original error
          if (this.debugModeEnabled) {
            console.error('[stdin] Failed to resume after error:', resumeErr);
          }
        }
      }

      // The key: do NOT re-throw, preventing the process from crashing
      // This allows the app to continue operating or gracefully shut down
    };

    // Give the handler a name for easier debugging/removal
    Object.defineProperty(handler, 'name', {
      value: 'stdinErrorHandler',
      configurable: false,
      writable: false,
    });

    return handler;
  }

  /**
   * Enable raw mode with error handling
   *
   * @returns true if raw mode was enabled, false if it was already in raw mode
   */
  enable(): boolean {
    // Check if stdin is a TTY before setting raw mode
    if (!process.stdin.isTTY) {
      return false;
    }

    // Store the current raw state before enabling
    this.wasRawBeforeEnable = !!process.stdin.isRaw;

    // If already in raw mode and we didn't set it, don't change anything
    if (process.stdin.isRaw && !this.isEnabled) {
      // We're inheriting raw mode from somewhere else
      // Still install error handler for safety
      if (!this.hasErrorHandler()) {
        process.stdin.on('error', this.errorHandler);
        this.isEnabled = true;
      }
      return false;
    }

    // Set raw mode
    try {
      process.stdin.setRawMode(true);
    } catch (err) {
      // setRawMode can fail in some terminal configs
      // Log and continue anyway
      if (this.debugModeEnabled) {
        console.error('[stdin] Failed to set raw mode:', err);
      }
      return false;
    }

    // Install error handler if not already present
    if (!this.hasErrorHandler()) {
      process.stdin.on('error', this.errorHandler);
    }

    this.isEnabled = true;
    return true;
  }

  /**
   * Disable raw mode and clean up error handler
   *
   * @param restorePreviousState If true, restore stdin to the state it was in before enable() was called
   *                              If false, force disable raw mode
   */
  disable(restorePreviousState: boolean = true): void {
    if (!this.isEnabled) {
      return;
    }

    // Remove our error handler
    const listeners = process.stdin.listeners('error') as Array<
      (err: Error) => void
    >;
    for (const listener of listeners) {
      if (listener === this.errorHandler) {
        process.stdin.removeListener('error', listener);
        break;
      }
    }

    // Restore raw mode state
    if (process.stdin.isTTY) {
      try {
        if (restorePreviousState) {
          process.stdin.setRawMode(this.wasRawBeforeEnable);
        } else {
          process.stdin.setRawMode(false);
        }
      } catch (_err) {
        // setRawMode can fail during cleanup
        // Ignore and continue
      }
    }

    this.isEnabled = false;
  }

  /**
   * Check if stdin already has our error handler installed
   */
  private hasErrorHandler(): boolean {
    const listeners = process.stdin.listeners('error');
    return listeners.includes(this.errorHandler);
  }

  /**
   * Check if raw mode is currently managed by this instance
   */
  getManaged(): boolean {
    return this.isEnabled;
  }

  /**
   * Get the error handler function (useful for manual cleanup or testing)
   */
  getErrorHandler(): StdinErrorHandler {
    return this.errorHandler;
  }
}

// Global singleton handler for installStdinErrorHandler
let globalStdinErrorHandler: StdinErrorHandler | null = null;

/**
 * Legacy helper function for backward compatibility
 * Installs a global stdin error handler without managing raw mode
 *
 * @deprecated Use StdinRawModeManager instead for better lifecycle management
 *
 * @param options - Error handling options (only used on first call)
 * @returns The error handler function (for removal later)
 */
export function installStdinErrorHandler(
  options?: StdinSafetyOptions,
): StdinErrorHandler {
  // Return existing handler if already installed (singleton pattern)
  if (globalStdinErrorHandler) {
    return globalStdinErrorHandler;
  }

  // Create and install the handler
  const manager = new StdinRawModeManager(options);
  const handler = manager.getErrorHandler();

  // Only install the handler if it's not already present
  if (!process.stdin.listeners('error').includes(handler)) {
    process.stdin.on('error', handler);
  }

  // Store as singleton for idempotency
  globalStdinErrorHandler = handler;

  return handler;
}

/**
 * Reset the global stdin error handler (for testing only)
 * @internal
 */
export function _resetGlobalStdinErrorHandler(): void {
  if (globalStdinErrorHandler) {
    // Remove all instances of this handler from the listeners
    try {
      process.stdin.removeListener('error', globalStdinErrorHandler);
    } catch (_err) {
      // Ignore if handler not found
    }
    globalStdinErrorHandler = null;
  }
}

/**
 * Helper to safely enable raw mode with error handling
 * Returns a cleanup function that should be called to restore the original state
 *
 * Note: If stdin is not a TTY or raw mode cannot be enabled, the wrapped
 * function still executes but no raw mode changes are made.
 *
 * @param options - Error handling options
 * @returns Cleanup function that restores stdin to its previous state
 */
export function withSafeRawMode<T>(
  fn: () => T | Promise<T>,
  options?: StdinSafetyOptions,
): () => T | Promise<T> {
  return () => {
    const manager = new StdinRawModeManager(options);
    const enabled = manager.enable();

    try {
      const result = fn();
      // Handle both sync and async functions
      if (result instanceof Promise) {
        return result.finally(() => {
          if (enabled) {
            manager.disable();
          }
        });
      } else {
        if (enabled) {
          manager.disable();
        }
        return result;
      }
    } catch (err) {
      if (enabled) {
        manager.disable();
      }
      throw err;
    }
  };
}
