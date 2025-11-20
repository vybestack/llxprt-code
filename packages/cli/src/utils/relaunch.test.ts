/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { relaunchAppInChildProcess } from './relaunch.js';
import { RELAUNCH_EXIT_CODE } from './bootstrap.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('relaunchAppInChildProcess', () => {
  const mockSpawn = vi.mocked(spawn);
  let mockChildProcess: EventEmitter;

  beforeEach(() => {
    mockChildProcess = new EventEmitter();
    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should spawn child process with correct arguments', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    // Simulate child process exit
    mockChildProcess.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(nodeArgs),
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          LLXPRT_CODE_NO_RELAUNCH: 'true',
        }),
      }),
    );
  });

  it('should include original process argv after node args', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    // First should be the node args
    expect(spawnArgs[0]).toBe('--max-old-space-size=4096');
    // Remaining should be from process.argv.slice(1)
    expect(spawnArgs.slice(1)).toEqual(process.argv.slice(1));
  });

  it('should set LLXPRT_CODE_NO_RELAUNCH env var to prevent infinite loops', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnEnv = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
    expect(spawnEnv.LLXPRT_CODE_NO_RELAUNCH).toBe('true');
  });

  it('should return the exit code from child process', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 42);
    const exitCode = await promise;

    expect(exitCode).toBe(42);
  });

  it('should handle RELAUNCH_EXIT_CODE from child', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', RELAUNCH_EXIT_CODE);
    const exitCode = await promise;

    expect(exitCode).toBe(RELAUNCH_EXIT_CODE);
  });

  it('should handle null exit code', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', null);
    const exitCode = await promise;

    expect(exitCode).toBe(0);
  });

  it('should use stdio inherit for seamless I/O', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions?.stdio).toBe('inherit');
  });

  it('should preserve existing environment variables', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const originalEnv = { ...process.env, CUSTOM_VAR: 'test-value' };
    process.env = originalEnv;

    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnEnv = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
    expect(spawnEnv.CUSTOM_VAR).toBe('test-value');
  });
});
