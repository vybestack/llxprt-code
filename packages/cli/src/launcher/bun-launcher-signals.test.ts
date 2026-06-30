/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { relaunchUnderBunIfNeeded } from './bun-launcher.js';

describe('relaunchUnderBunIfNeeded signal handling', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = process.env;
    process.env = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  it('forwards termination signals to the Bun child until settlement', async () => {
    let capturedChild:
      | (EventEmitter & { killed: boolean; kill: ReturnType<typeof vi.fn> })
      | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = Object.assign(new EventEmitter(), {
        killed: false,
        kill: vi.fn(),
      });
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      createCredentialProxy: vi.fn(async () => null),
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    process.emit('SIGTERM', 'SIGTERM');
    expect(capturedChild!.kill).toHaveBeenCalledWith('SIGTERM');
    process.emit('SIGBREAK', 'SIGBREAK');
    expect(capturedChild!.kill).toHaveBeenCalledWith('SIGBREAK');

    capturedChild!.emit('close', 0);
    await promise;
    capturedChild!.kill.mockClear();
    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGBREAK', 'SIGBREAK');
    expect(capturedChild!.kill).not.toHaveBeenCalled();
  });

  it('maps child SIGBREAK termination to the Windows Ctrl+Break exit code', async () => {
    process.argv = ['/node', '/script.js'];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(
      (_cmd: string, _args: string[], _options: { env: NodeJS.ProcessEnv }) => {
        capturedChild = new EventEmitter();
        return capturedChild;
      },
    );

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      createCredentialProxy: vi.fn(async () => null),
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', null, 'SIGBREAK');
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(149);
  });
});
