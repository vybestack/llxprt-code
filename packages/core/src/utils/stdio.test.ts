/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { patchStdio, createInkStdio } from './stdio.js';
import { coreEvents } from './events.js';

vi.mock('./events.js', () => ({
  coreEvents: {
    emitOutput: vi.fn(),
  },
}));

describe('stdio utils', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    vi.clearAllMocks();
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    vi.restoreAllMocks();
  });

  it('patchStdio redirects stdout and stderr to coreEvents', () => {
    const cleanup = patchStdio();

    process.stdout.write('test stdout');
    expect(coreEvents.emitOutput).toHaveBeenCalledWith({
      chunk: 'test stdout',
      encoding: undefined,
      isStderr: false,
    });

    process.stderr.write('test stderr');
    expect(coreEvents.emitOutput).toHaveBeenCalledWith({
      chunk: 'test stderr',
      encoding: undefined,
      isStderr: true,
    });

    cleanup();

    // Verify cleanup
    expect(process.stdout.write).toBe(originalStdoutWrite);
    expect(process.stderr.write).toBe(originalStderrWrite);
  });

  it('createInkStdio writes to real stdout/stderr bypassing patch', () => {
    const cleanup = patchStdio();
    const { stdout: inkStdout, stderr: inkStderr } = createInkStdio();

    inkStdout.write('ink stdout');
    expect(coreEvents.emitOutput).not.toHaveBeenCalled();

    inkStderr.write('ink stderr');
    expect(coreEvents.emitOutput).not.toHaveBeenCalled();

    cleanup();
  });

  describe('stdio hardening (EPIPE resilience)', () => {
    it('createInkStdio attaches error handlers to stdout and stderr', () => {
      // Call createInkStdio to trigger hardening
      createInkStdio();

      // Check that error handlers are attached
      const stdoutListeners = process.stdout.listeners('error');
      const stderrListeners = process.stderr.listeners('error');

      expect(stdoutListeners.length).toBeGreaterThan(0);
      expect(stderrListeners.length).toBeGreaterThan(0);
    });

    it('EPIPE errors on stdout do not crash the process', () => {
      // Call createInkStdio to trigger hardening
      createInkStdio();

      // Create an EPIPE error
      const epipeError = new Error('write EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';

      // This should not throw
      expect(() => {
        process.stdout.emit('error', epipeError);
      }).not.toThrow();
    });

    it('EPIPE errors on stderr do not crash the process', () => {
      // Call createInkStdio to trigger hardening
      createInkStdio();

      // Create an EPIPE error
      const epipeError = new Error('write EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';

      // This should not throw
      expect(() => {
        process.stderr.emit('error', epipeError);
      }).not.toThrow();
    });

    it('non-EPIPE errors on stdout are logged', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      // Call createInkStdio to trigger hardening
      createInkStdio();

      // Create a non-EPIPE error
      const otherError = new Error('other error') as NodeJS.ErrnoException;
      otherError.code = 'EOTHER';

      // Emit the error
      process.stdout.emit('error', otherError);

      // Should have been logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('stdout error'),
      );

      consoleWarnSpy.mockRestore();
    });

    it('non-EPIPE errors on stderr are logged', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      // Call createInkStdio to trigger hardening
      createInkStdio();

      // Create a non-EPIPE error
      const otherError = new Error('other error') as NodeJS.ErrnoException;
      otherError.code = 'EOTHER';

      // Emit the error
      process.stderr.emit('error', otherError);

      // Should have been logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('stderr error'),
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
