/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { relaunchAppInChildProcess, sanitizeNodeOptions } from './relaunch.js';
import { RELAUNCH_EXIT_CODE } from './bootstrap.js';

vi.mock('node:child_process');

const mockedChildProcess = vi.mocked(childProcess);

describe('relaunchAppInChildProcess', () => {
  let mockChildProcess: EventEmitter;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    mockChildProcess = new EventEmitter();
    mockedChildProcess.spawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof childProcess.spawn>,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should spawn child process with correct arguments', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    const promise = relaunchAppInChildProcess(nodeArgs);

    // Simulate child process exit
    mockChildProcess.emit('close', 0);
    await promise;

    expect(mockedChildProcess.spawn).toHaveBeenCalledWith(
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

    const spawnArgs = mockedChildProcess.spawn.mock.calls[0][1] as string[];
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

    const spawnEnv = mockedChildProcess.spawn.mock.calls[0][2]?.env as Record<
      string,
      string
    >;
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

    const spawnOptions = mockedChildProcess.spawn.mock.calls[0][2];
    expect(spawnOptions?.stdio).toBe('inherit');
  });

  it('should preserve existing environment variables', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    process.env = { ...process.env, CUSTOM_VAR: 'test-value' };

    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnEnv = mockedChildProcess.spawn.mock.calls[0][2]?.env as Record<
      string,
      string
    >;
    expect(spawnEnv.CUSTOM_VAR).toBe('test-value');
  });

  it('should sanitize NODE_OPTIONS to remove --localstorage-file', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    process.env = {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=2048 --localstorage-file --enable-source-maps',
    };

    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnEnv = mockedChildProcess.spawn.mock.calls[0][2]?.env as Record<
      string,
      string | undefined
    >;
    expect(spawnEnv.NODE_OPTIONS).toBe(
      '--max-old-space-size=2048 --enable-source-maps',
    );
  });

  it('should remove NODE_OPTIONS entirely if only --localstorage-file present', async () => {
    const nodeArgs = ['--max-old-space-size=4096'];
    process.env = { ...process.env, NODE_OPTIONS: '--localstorage-file' };

    const promise = relaunchAppInChildProcess(nodeArgs);

    mockChildProcess.emit('close', 0);
    await promise;

    const spawnEnv = mockedChildProcess.spawn.mock.calls[0][2]?.env as Record<
      string,
      string | undefined
    >;
    expect(spawnEnv.NODE_OPTIONS).toBeUndefined();
  });
});

describe('sanitizeNodeOptions', () => {
  it('should return undefined for undefined input', () => {
    expect(sanitizeNodeOptions(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(sanitizeNodeOptions('')).toBeUndefined();
  });

  it('should remove --localstorage-file without value', () => {
    expect(sanitizeNodeOptions('--localstorage-file')).toBeUndefined();
  });

  it('should remove --localstorage-file with equals value', () => {
    expect(sanitizeNodeOptions('--localstorage-file=/some/path')).toBeUndefined();
  });

  it('should remove --localstorage-file with space-separated value', () => {
    expect(sanitizeNodeOptions('--localstorage-file /some/path')).toBeUndefined();
  });

  it('should preserve other options before --localstorage-file', () => {
    expect(sanitizeNodeOptions('--max-old-space-size=4096 --localstorage-file')).toBe(
      '--max-old-space-size=4096',
    );
  });

  it('should preserve other options after --localstorage-file', () => {
    expect(
      sanitizeNodeOptions('--localstorage-file --enable-source-maps'),
    ).toBe('--enable-source-maps');
  });

  it('should preserve options on both sides of --localstorage-file', () => {
    expect(
      sanitizeNodeOptions(
        '--max-old-space-size=4096 --localstorage-file --enable-source-maps',
      ),
    ).toBe('--max-old-space-size=4096 --enable-source-maps');
  });

  it('should not consume following flags as values', () => {
    expect(
      sanitizeNodeOptions('--localstorage-file --other-flag value'),
    ).toBe('--other-flag value');
  });

  it('should handle multiple spaces', () => {
    expect(
      sanitizeNodeOptions('  --max-old-space-size=4096   --localstorage-file   '),
    ).toBe('--max-old-space-size=4096');
  });
});
