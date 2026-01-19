/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  applyTerminalContract,
  drainStdinBuffer,
  TERMINAL_CONTRACT_SEQUENCES,
} from './terminalContract.js';
import { Readable } from 'node:stream';

describe('terminalContract', () => {
  let mockStdout: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockStdout = { write: vi.fn().mockReturnValue(true) };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TERMINAL_CONTRACT_SEQUENCES', () => {
    it('includes mouse tracking sequences', () => {
      // LLxprt uses only button event tracking (1002h) and SGR extended mode (1006h)
      // Not basic X10 mode (1000h) for better drag detection
      expect(TERMINAL_CONTRACT_SEQUENCES).toContain('\x1b[?1002h');
      expect(TERMINAL_CONTRACT_SEQUENCES).toContain('\x1b[?1006h');
    });

    it('includes bracketed paste sequence', () => {
      expect(TERMINAL_CONTRACT_SEQUENCES).toContain('\x1b[?2004h');
    });

    it('includes focus tracking sequence', () => {
      expect(TERMINAL_CONTRACT_SEQUENCES).toContain('\x1b[?1004h');
    });

    it('includes show cursor sequence', () => {
      expect(TERMINAL_CONTRACT_SEQUENCES).toContain('\x1b[?25h');
    });
  });

  describe('applyTerminalContract', () => {
    it('writes all terminal contract sequences to stdout', () => {
      applyTerminalContract(mockStdout as unknown as NodeJS.WriteStream);

      expect(mockStdout.write).toHaveBeenCalledWith(
        TERMINAL_CONTRACT_SEQUENCES,
      );
    });

    it('does not write mouse sequences when includeMouseEvents is false', () => {
      applyTerminalContract(mockStdout as unknown as NodeJS.WriteStream, {
        includeMouseEvents: false,
      });

      const writtenData = mockStdout.write.mock.calls[0][0];
      expect(writtenData).not.toContain('\x1b[?1002h');
      expect(writtenData).not.toContain('\x1b[?1006h');
      // Should still include other sequences
      expect(writtenData).toContain('\x1b[?2004h');
    });

    it('uses process.stdout by default', () => {
      const originalWrite = process.stdout.write;
      const mockWrite = vi.fn().mockReturnValue(true);
      process.stdout.write = mockWrite;

      try {
        applyTerminalContract();
        expect(mockWrite).toHaveBeenCalled();
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe('drainStdinBuffer', () => {
    it('returns a promise that resolves', async () => {
      const mockStdin = new Readable({
        read() {
          // Simulate empty stdin
          this.push(null);
        },
      });

      const result = drainStdinBuffer(mockStdin, 10);
      await expect(result).resolves.toBeUndefined();
    });

    it('drains available data from stdin buffer', async () => {
      let readCalled = false;
      const mockStdin = new Readable({
        read() {
          if (!readCalled) {
            readCalled = true;
            // Simulate some garbage ANSI in the buffer
            this.push('\x1b[?1000l\x1b[0m');
            this.push(null);
          }
        },
      });

      await drainStdinBuffer(mockStdin, 10);
      // Should complete without error, having drained the buffer
      expect(readCalled).toBe(true);
    });

    it('times out after specified duration', async () => {
      const mockStdin = new Readable({
        read() {
          // Don't push anything - simulate blocked stdin
        },
      });

      const start = Date.now();
      await drainStdinBuffer(mockStdin, 50);
      const elapsed = Date.now() - start;

      // Should timeout around 50ms (with some tolerance)
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(200);
    });
  });
});
