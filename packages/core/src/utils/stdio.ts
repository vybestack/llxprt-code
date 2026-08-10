/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreEvents } from './events.js';

/**
 * The Node stdout write signature, covering both overloads:
 *   write(chunk, callback?) and write(chunk, encoding, callback?).
 */
type StdoutWriteArgs = Parameters<typeof process.stdout.write>;

/**
 * Second positional argument to stdout.write: either a BufferEncoding, a
 * callback, or absent.
 */
type StdoutEncodingArg = StdoutWriteArgs[1];

/**
 * Observer invoked once per real stdout write, after the write returns.
 * Internal observer/programming errors must propagate (D8) — this callback is
 * never wrapped in try/catch. Only the filesystem writer fails open.
 */
export interface StdoutWriteObserver {
  onWrite(encodedBytes: number, syncDurationMs: number): void;
}

/**
 * Computes the number of encoded bytes for a write chunk:
 * - Uint8Array (incl. Buffer): byteLength
 * - string: Buffer.byteLength using the supplied encoding (defaults to UTF-8)
 */
function encodedByteLength(
  chunk: Uint8Array | string,
  encodingOrCallback: StdoutEncodingArg,
): number {
  if (typeof chunk === 'string') {
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    return Buffer.byteLength(chunk, encoding);
  }
  return chunk.byteLength;
}

/**
 * Wraps an underlying stdout write with byte counting and synchronous-duration
 * measurement. Exported from this module so behavioral tests can inject a
 * deterministic underlying write to verify byte counting, backpressure,
 * callback forwarding, and error propagation without touching the real
 * process.stdout.
 *
 * The observer is called directly after the underlying write returns, with no
 * try/catch — internal/programming errors fail fast (D8). If the underlying
 * write throws synchronously, no observer sample is produced.
 */
export function createObservedStdoutWrite(
  underlyingWrite: (...args: StdoutWriteArgs) => boolean,
  observer: StdoutWriteObserver,
): (...args: StdoutWriteArgs) => boolean {
  return function observedStdoutWrite(...args: StdoutWriteArgs): boolean {
    const encodedBytes = encodedByteLength(args[0], args[1]);
    const start = performance.now();
    const ok = underlyingWrite(...args);
    const syncDurationMs = performance.now() - start;
    observer.onWrite(encodedBytes, syncDurationMs);
    return ok;
  };
}

// Capture the original stdout and stderr write methods before any monkey patching occurs.
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Module-level error handlers so the same references are used for add/remove.
const handleStdoutError = (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') {
    try {
      process.stderr.write(`stdout error: ${err.message}
`);
    } catch {
      // Swallow write failures to avoid infinite recursion
    }
  }
};

const handleStderrError = (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') {
    try {
      process.stderr.write(`stderr error: ${err.message}
`);
    } catch {
      // Swallow write failures to avoid infinite recursion
    }
  }
};

/**
 * Writes to the real stdout, bypassing any monkey patching on process.stdout.write.
 */
export function writeToStdout(
  ...args: Parameters<typeof process.stdout.write>
): boolean {
  return originalStdoutWrite(...args);
}

/**
 * Writes to the real stderr, bypassing any monkey patching on process.stderr.write.
 */
export function writeToStderr(
  ...args: Parameters<typeof process.stderr.write>
): boolean {
  return originalStderrWrite(...args);
}

/**
 * Monkey patches process.stdout.write and process.stderr.write to redirect output to the provided logger.
 * This prevents stray output from libraries (or the app itself) from corrupting the UI.
 * Returns a cleanup function that restores the original write methods.
 */
export function patchStdio(): () => void {
  const previousStdoutWrite = process.stdout.write;
  const previousStderrWrite = process.stderr.write;

  process.stdout.write = (
    chunk: Uint8Array | string,
    encodingOrCb?:
      | BufferEncoding
      | ((err?: NodeJS.ErrnoException | null) => void),
    cb?: (err?: NodeJS.ErrnoException | null) => void,
  ) => {
    const encoding =
      typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    coreEvents.emitOutput({ chunk, encoding, isStderr: false });
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
    if (callback) {
      callback();
    }
    return true;
  };

  process.stderr.write = (
    chunk: Uint8Array | string,
    encodingOrCb?:
      | BufferEncoding
      | ((err?: NodeJS.ErrnoException | null) => void),
    cb?: (err?: NodeJS.ErrnoException | null) => void,
  ) => {
    const encoding =
      typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    coreEvents.emitOutput({ chunk, encoding, isStderr: true });
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
    if (callback) {
      callback();
    }
    return true;
  };

  return () => {
    process.stdout.write = previousStdoutWrite;
    process.stderr.write = previousStderrWrite;
  };
}

/**
 * Creates proxies for process.stdout and process.stderr that use the real write methods
 * (writeToStdout and writeToStderr) bypassing any monkey patching.
 * This is used by Ink to render to the real output.
 *
 * Also adds error event handlers to prevent EPIPE crashes when output is piped
 * to a process that exits early.
 */
export function createInkStdio(observer?: StdoutWriteObserver) {
  // Remove any existing handlers to avoid duplicates, then re-add.
  // Handlers are defined at module scope so the same references are used.
  process.stdout.removeListener('error', handleStdoutError);
  process.stderr.removeListener('error', handleStderrError);

  process.stdout.on('error', handleStdoutError);
  process.stderr.on('error', handleStderrError);

  // When no observer is present, the write delegate is writeToStdout itself —
  // preserving the exact function identity and behaviour of today. When an
  // observer is supplied, a single observed wrapper is created and reused.
  const stdoutWrite = observer
    ? createObservedStdoutWrite(writeToStdout, observer)
    : writeToStdout;

  const inkStdout = new Proxy(process.stdout, {
    get(target, prop, receiver) {
      if (prop === 'write') {
        return stdoutWrite;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });

  const inkStderr = new Proxy(process.stderr, {
    get(target, prop, receiver) {
      if (prop === 'write') {
        return writeToStderr;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });

  return { stdout: inkStdout, stderr: inkStderr };
}
