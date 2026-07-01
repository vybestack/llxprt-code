/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { FatalError } from '@vybestack/llxprt-code-core';
import {
  relaunchUnderBunIfNeeded,
  runBunLauncherIfNeeded,
} from './bun-launcher.js';

const providerAuthMocks = vi.hoisted(() => ({
  createAndStartProxy: vi.fn(),
  getProxySocketPath: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-providers/auth.js', () => providerAuthMocks);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe('relaunchUnderBunIfNeeded', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;
  let createdSocketDir: string | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = process.env;
    createdSocketDir = undefined;
    process.env = { ...process.env };
    providerAuthMocks.createAndStartProxy.mockImplementation(
      async ({ socketPath }: { socketPath: string }) => {
        createdSocketDir = socketPath;
        return { stop: vi.fn(async () => {}) };
      },
    );
    providerAuthMocks.getProxySocketPath.mockImplementation(() =>
      createdSocketDir === undefined
        ? undefined
        : `${createdSocketDir}/proxy.sock`,
    );
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('does nothing when already running under Bun', async () => {
    const spawnFn = vi.fn();
    const result = await relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => true,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn,
    });

    expect(result.relaunched).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does nothing when LLXPRT_BUN_RELAUNCHED guard is set', async () => {
    const spawnFn = vi.fn();
    const result = await relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => true,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn,
    });

    expect(result.relaunched).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('throws FatalError with actionable message when bun cannot be resolved', async () => {
    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => null),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toMatch(/npm install/);
    expect(fatal.message).toMatch(/bun/);
    expect(fatal.message).toMatch(/PATH|bun\.sh/);
  });

  it('throws FatalError with actionable message when entry cannot be resolved', async () => {
    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => null),
        spawn: vi.fn(),
      }),
    ).rejects.toThrowError(/entry/);
  });

  it('entry-not-found FatalError mentions dist/index.js alongside legacy entry locations', async () => {
    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => null),
        spawn: vi.fn(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toMatch(/dist\/index\.js/);
    expect(fatal.message).toMatch(/reinstall/i);
  });

  it('spawns resolved bun with entry and forwarded args, stdio inherit', async () => {
    process.argv = ['/node', '/script.js', '--foo', 'bar'];
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 0);
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalledWith(
      '/path/to/bun',
      ['/entry.ts', '--foo', 'bar'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          LLXPRT_BUN_RELAUNCHED: 'true',
        }),
      }),
    );
  });

  it('propagates child close code as exitCode', async () => {
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 7);
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(7);
  });

  it('treats child signal termination as a failure exitCode', async () => {
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', null, 'SIGTERM');
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(143);
  });

  it('treats unmapped child signal termination as a failure exitCode', async () => {
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', null, 'SIGRTMIN');
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('treats null code without signal as a failure exitCode', async () => {
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', null, null);
    const result = await promise;

    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('preserves existing environment variables in spawned process', async () => {
    process.env['CUSTOM_LAUNCHER_VAR'] = 'hello';
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 0);
    await promise;

    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.CUSTOM_LAUNCHER_VAR).toBe('hello');
  });

  it('starts a credential proxy before spawning Bun and stops it after close', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.argv = ['/node', '/script.js'];
    let capturedChild: EventEmitter | null = null;
    const stopProxy = vi.fn(async () => {});
    const createCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/lxcp-test.sock',
      stop: stopProxy,
    }));
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
      createCredentialProxy,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    expect(createCredentialProxy).toHaveBeenCalledTimes(1);
    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.LLXPRT_CREDENTIAL_SOCKET).toBe('/tmp/lxcp-test.sock');

    capturedChild!.emit('close', 0);
    await promise;

    expect(stopProxy).toHaveBeenCalledTimes(1);
  });

  it('passes through an existing credential socket without starting a proxy', async () => {
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/already-running.sock';
    let capturedChild: EventEmitter | null = null;
    const createCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/unused.sock',
      stop: vi.fn(async () => {}),
    }));
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
      createCredentialProxy,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 0);
    await promise;

    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.LLXPRT_CREDENTIAL_SOCKET).toBe('/already-running.sock');
    expect(createCredentialProxy).not.toHaveBeenCalled();
  });

  it('restores process credential socket mutations from the default proxy lifecycle', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.argv = ['/node', '/script.js'];
    let capturedChild: EventEmitter | null = null;
    const stopProxy = vi.fn(async () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    });
    providerAuthMocks.createAndStartProxy.mockImplementation(
      async ({ socketPath }: { socketPath: string }) => {
        createdSocketDir = socketPath;
        process.env.LLXPRT_CREDENTIAL_SOCKET = `${socketPath}/proxy.sock`;
        return { stop: stopProxy };
      },
    );
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
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(createdSocketDir).not.toBeUndefined();
    expect(spawnEnv.LLXPRT_CREDENTIAL_SOCKET).toBe(
      `${createdSocketDir}/proxy.sock`,
    );
    expect(process.env.LLXPRT_CREDENTIAL_SOCKET).toBeUndefined();

    capturedChild!.emit('close', 0);
    await promise;

    expect(stopProxy).toHaveBeenCalledTimes(1);
    expect(process.env.LLXPRT_CREDENTIAL_SOCKET).toBeUndefined();
    expect(createdSocketDir).not.toBeUndefined();
    expect(await pathExists(createdSocketDir!)).toBe(false);
  });

  it('cleans up the temp dir when default credential proxy startup fails', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    providerAuthMocks.createAndStartProxy.mockImplementation(
      async ({ socketPath }: { socketPath: string }) => {
        createdSocketDir = socketPath;
        throw new Error('listen EINVAL');
      },
    );

    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
      }),
    ).rejects.toThrow(/credential proxy/);

    expect(createdSocketDir).not.toBeUndefined();
    expect(await pathExists(createdSocketDir!)).toBe(false);
    expect(process.env.LLXPRT_CREDENTIAL_SOCKET).toBeUndefined();
  });

  it('stops and cleans up when default credential proxy starts without a socket path', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    const stopProxy = vi.fn(async () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    });
    providerAuthMocks.createAndStartProxy.mockImplementation(
      async ({ socketPath }: { socketPath: string }) => {
        createdSocketDir = socketPath;
        process.env.LLXPRT_CREDENTIAL_SOCKET = `${socketPath}/proxy.sock`;
        return { stop: stopProxy };
      },
    );
    providerAuthMocks.getProxySocketPath.mockReturnValue(undefined);

    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
      }),
    ).rejects.toThrow(/socket path/);

    expect(stopProxy).toHaveBeenCalledTimes(1);
    expect(createdSocketDir).not.toBeUndefined();
    expect(await pathExists(createdSocketDir!)).toBe(false);
    expect(process.env.LLXPRT_CREDENTIAL_SOCKET).toBeUndefined();
  });

  it('stops the credential proxy when spawn throws synchronously', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    const stopProxy = vi.fn(async () => {});
    const createCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/lxcp-test.sock',
      stop: stopProxy,
    }));
    const spawnFn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });

    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
        createCredentialProxy,
      }),
    ).rejects.toBeInstanceOf(FatalError);

    expect(stopProxy).toHaveBeenCalledTimes(1);
  });

  it('stops the credential proxy when the child emits an async error', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    let capturedChild: EventEmitter | null = null;
    const stopProxy = vi.fn(async () => {});
    const createCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/lxcp-test.sock',
      stop: stopProxy,
    }));
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      createCredentialProxy,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toBeInstanceOf(FatalError);
    expect(stopProxy).toHaveBeenCalledTimes(1);
  });

  it('spawns a Windows .cmd shim with shell:true so child_process can execute it safely', async () => {
    process.argv = ['/node', '/script.js'];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(
      (
        _cmd: string,
        _args: string[],
        _options: { env: NodeJS.ProcessEnv; shell?: boolean },
      ) => {
        capturedChild = new EventEmitter();
        return capturedChild;
      },
    );

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => 'C:/repo/node_modules/.bin/bun.cmd'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      platform: 'win32',
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 0);
    await promise;

    expect(spawnFn).toHaveBeenCalledWith(
      'C:/repo/node_modules/.bin/bun.cmd',
      expect.any(Array),
      expect.objectContaining({ shell: true }),
    );
  });

  it('rejects unsafe Windows .cmd shim arguments and cleans up the credential proxy', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.argv = ['/node', '/script.js', '--prompt', 'hello & whoami'];
    const stopProxy = vi.fn(async () => {});
    const spawnFn = vi.fn();

    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => 'C:/repo/node_modules/.bin/bun.cmd'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
        platform: 'win32',
        createCredentialProxy: vi.fn(async () => ({
          socketPath: '/tmp/lxcp-test.sock',
          stop: stopProxy,
        })),
      }),
    ).rejects.toThrow(/command-shell metacharacters/i);

    expect(spawnFn).not.toHaveBeenCalled();
    expect(stopProxy).toHaveBeenCalledTimes(1);
  });

  it('does not set shell:true when spawning a direct non-cmd executable', async () => {
    process.argv = ['/node', '/script.js'];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(
      (
        _cmd: string,
        _args: string[],
        _options: { env: NodeJS.ProcessEnv; shell?: boolean },
      ) => {
        capturedChild = new EventEmitter();
        return capturedChild;
      },
    );

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/usr/local/bin/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 0);
    await promise;

    const opts = spawnFn.mock.calls[0][2] as {
      env: NodeJS.ProcessEnv;
      shell?: boolean;
    };
    expect(opts.shell).toBeFalsy();
  });

  it('converts a synchronous spawn throw into FatalError naming the Bun path and suggesting reinstall/PATH', async () => {
    const spawnFn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });

    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      });
    } catch (error) {
      thrown = error;
    }

    expect(spawnFn).toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toContain('/resolved/path/to/bun');
    expect(fatal.message).toMatch(/reinstall|npm install/i);
    expect(fatal.message).toMatch(/PATH|executable/i);
  });

  it('converts an asynchronous child error event into FatalError without hanging', async () => {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    // Emit an 'error' event (async spawn failure) instead of 'close'.
    capturedChild!.emit('error', new Error('spawn ENOENT'));

    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toContain('/resolved/path/to/bun');
    expect(fatal.message).toMatch(/reinstall|npm install/i);
    expect(fatal.message).toMatch(/PATH|executable/i);
  });

  it('settles on error then ignores a later close event (no double-resolve, no crash)', async () => {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    // Error arrives first, then a close event follows.
    capturedChild!.emit('error', new Error('spawn ENOENT'));
    capturedChild!.emit('close', 1);

    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }

    // The promise must reject with the error, not resolve with exitCode 1.
    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.message).toMatch(/ENOENT/);
  });

  it('settles on close then ignores a later error event (no double-resolve, no crash)', async () => {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    // Close arrives first, then an error event follows.
    capturedChild!.emit('close', 0);
    capturedChild!.emit('error', new Error('late EPIPE'));

    // The promise must resolve with exitCode 0, not reject.
    const result = await promise;
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('removes settling listeners after close so the child does not leak handlers', async () => {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    const child = capturedChild!;
    // Before settlement, we have exactly one close and one error listener.
    expect(child.listenerCount('close')).toBe(1);
    expect(child.listenerCount('error')).toBe(1);

    child.emit('close', 0);
    await promise;

    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('late error'))).not.toThrow();
  });
});

describe('runBunLauncherIfNeeded', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = process.env;
    process.env = { ...process.env };
    providerAuthMocks.createAndStartProxy.mockClear();
    providerAuthMocks.getProxySocketPath.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('propagates FatalError without calling exit when bun cannot be resolved', async () => {
    const exitCalls: number[] = [];

    await expect(
      runBunLauncherIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => null),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
        exit: (code?: number) => {
          exitCalls.push(code ?? 0);
          return undefined as never;
        },
      }),
    ).rejects.toBeInstanceOf(FatalError);

    expect(exitCalls).toHaveLength(0);
  });

  it('stops the credential proxy before exiting with the child close code', async () => {
    const exitCalls: number[] = [];
    const stopCalls: string[] = [];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = runBunLauncherIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
      createCredentialProxy: vi.fn(async () => ({
        socketPath: '/tmp/lxcp-test.sock',
        stop: async () => {
          stopCalls.push('stop');
        },
      })),
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 9);
    await promise;

    expect(stopCalls).toStrictEqual(['stop']);
    expect(exitCalls).toStrictEqual([9]);
  });

  it('does not call exit when no relaunch is needed (already under bun)', async () => {
    const exitCalls: number[] = [];
    const spawnFn = vi.fn();

    await runBunLauncherIfNeeded({
      isRunningUnderBun: () => true,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
    });

    expect(exitCalls).toHaveLength(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('propagates async child error without calling exit', async () => {
    const exitCalls: number[] = [];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = runBunLauncherIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
      createCredentialProxy: vi.fn(async () => null),
    });

    await vi.waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toBeInstanceOf(FatalError);
    expect(exitCalls).toHaveLength(0);
  });
});
