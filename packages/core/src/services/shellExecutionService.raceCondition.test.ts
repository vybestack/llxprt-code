/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import EventEmitter from 'events';
import {
  ShellExecutionService,
  ShellOutputEvent,
} from './shellExecutionService.js';

// Hoisted Mocks
const mockPtySpawn = vi.hoisted(() => vi.fn());
const mockCpSpawn = vi.hoisted(() => vi.fn());
const mockIsBinary = vi.hoisted(() => vi.fn());
const mockPlatform = vi.hoisted(() => vi.fn());
const mockGetPty = vi.hoisted(() => vi.fn());

// Top-level Mocks
vi.mock('@lydell/node-pty', () => ({
  spawn: mockPtySpawn,
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('child_process');
  return {
    ...actual,
    spawn: mockCpSpawn,
  };
});
vi.mock('../utils/textUtils.js', () => ({
  isBinary: mockIsBinary,
}));
vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: () => '/tmp/test-home',
    constants: {
      signals: {
        SIGTERM: 15,
        SIGKILL: 9,
      },
    },
  },
  platform: mockPlatform,
  homedir: () => '/tmp/test-home',
  constants: {
    signals: {
      SIGTERM: 15,
      SIGKILL: 9,
    },
  },
}));
vi.mock('../utils/getPty.js', () => ({
  getPty: mockGetPty,
}));

vi.spyOn(process, 'kill').mockImplementation(() => true);

describe('ShellExecutionService - Issue #983 Race Condition Tests', () => {
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
  };
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    onOutputEventMock = vi.fn();

    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn();
    mockPtyProcess.onExit = vi.fn();

    mockPtySpawn.mockReturnValue(mockPtyProcess);
  });

  describe('Fast Command Race Condition (Issue #983)', () => {
    it('should finalize within timeout even if xterm write callback never fires', async () => {
      // This test simulates the scenario where xterm.write() callback never fires
      // The fix adds a timeout to prevent indefinite hanging

      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'echo hello',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Simulate data being sent but xterm.write callback potentially stalled
      mockPtyProcess.onData.mock.calls[0][0]('hello\n');

      // Immediately trigger exit - this creates the race condition where
      // the processing chain might not have completed
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });

      // The fix ensures this resolves within a reasonable timeout instead of hanging
      const result = await Promise.race([
        handle.result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      // Should have a result, not null (which would indicate timeout)
      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
    });

    it('should handle burst of output followed by immediate exit', async () => {
      // Simulates fast commands that output a burst of data and exit quickly
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'fast-command',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Rapid-fire data events followed by immediate exit
      for (let i = 0; i < 10; i++) {
        mockPtyProcess.onData.mock.calls[0][0](`line ${i}\n`);
      }

      // Exit immediately after data burst
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });

      // Should resolve without hanging
      const result = await Promise.race([
        handle.result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
    });

    it('should complete even with zero output commands', async () => {
      // Commands like 'rm file' that produce no output should not hang
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'rm somefile',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Exit with no data events
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });

      const result = await Promise.race([
        handle.result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      expect(result).not.toBeNull();
      expect(result?.exitCode).toBe(0);
      expect(result?.output).toBe('');
    });
  });

  describe('Processing Chain Timeout Protection', () => {
    it('should not wait indefinitely for processing chain after exit', async () => {
      vi.useFakeTimers();

      const abortController = new AbortController();
      const handlePromise = ShellExecutionService.execute(
        'test-command',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
      );

      await vi.advanceTimersByTimeAsync(0);
      const handle = await handlePromise;

      // Send data
      mockPtyProcess.onData.mock.calls[0][0]('output\n');

      // Exit while processing might still be pending
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });

      // Advance time past the finalization timeout
      await vi.advanceTimersByTimeAsync(1000);

      // The result should be available (not hanging)
      const result = await handle.result;

      vi.useRealTimers();

      expect(result.exitCode).toBe(0);
    });
  });
});
