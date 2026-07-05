/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { spawn as spawnType } from 'node:child_process';

const cliPackageRoot = resolve(__dirname, '..', '..');
const binPath = resolve(cliPackageRoot, 'bin', 'llxprt.cjs');
const loadCommonJsModule = createRequire(import.meta.url);
const credentialSocketEnv = 'LLXPRT_CREDENTIAL_SOCKET';

// The launcher only accepts a sidecar socket directory that is a direct
// lxcp-prefixed child of the OS temp dir, so fixtures must be built from the
// real tmpdir() (which is not '/tmp' on macOS). These are parse-only fixtures:
// the mock child process emits them as stdout text but never materializes them
// on disk, so no mkdtemp/cleanup is needed.
const fixtureSocketDir = join(tmpdir(), 'lxcp-fixture');
const fixtureSocketPath = join(fixtureSocketDir, 'llxprt-credential.sock');
const proxyStartupLine = `${JSON.stringify({
  socketDir: fixtureSocketDir,
  socketPath: fixtureSocketPath,
})}
`;

interface CredentialProxyHandle {
  socketPath: string;
  socketDir?: string;
  stop: () => Promise<void>;
}

interface ProxyExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface CredentialProxyStartOptions {
  onUnexpectedExit?: (info: ProxyExitInfo) => void;
  onProxyCreated?: (proxy: CredentialProxyHandle) => void;
}

interface RunCliBinOptions {
  exit?: ExitFn;
  spawn?: typeof spawnType;
  resolveBun?: () => string | null;
  resolveEntry?: () => string | null;
  startCredentialProxy?: (
    options?: CredentialProxyStartOptions,
  ) => Promise<CredentialProxyHandle>;
}

type ExitFn = (code?: number) => never;
type RunCliBin = (options?: RunCliBinOptions) => Promise<void>;
type CreateCredentialProxyDefault = (options?: {
  spawn?: typeof spawnType;
  onUnexpectedExit?: (info: ProxyExitInfo) => void;
  onProxyCreated?: (proxy: CredentialProxyHandle) => void;
}) => Promise<CredentialProxyHandle>;

interface CliBinModule {
  runCliBin: RunCliBin;
  createCredentialProxyDefault: CreateCredentialProxyDefault;
}

interface TestChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

function recordingExit(sink: number[]): ExitFn {
  const exit: ExitFn = (code?: number) => {
    sink.push(code ?? 0);
    return undefined as never;
  };
  return exit;
}

function isCliBinModule(module: unknown): module is CliBinModule {
  if (typeof module !== 'object' || module === null) {
    return false;
  }
  const { runCliBin, createCredentialProxyDefault } = module as {
    runCliBin?: unknown;
    createCredentialProxyDefault?: unknown;
  };
  return (
    typeof runCliBin === 'function' &&
    typeof createCredentialProxyDefault === 'function'
  );
}

function loadCliBin(): CliBinModule {
  const module = loadCommonJsModule(binPath);
  if (!isCliBinModule(module)) {
    throw new Error('cli bin module did not expose expected test seams');
  }
  return module;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createChildProcess({
  autoClose = true,
}: { autoClose?: boolean } = {}): TestChildProcess {
  const child = new EventEmitter() as TestChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.kill = vi.fn((signal?: NodeJS.Signals | 'SIGKILL') => {
    child.killed = true;
    if (autoClose) {
      process.nextTick(() => child.emit('close', null, signal ?? null));
    }
    return true;
  });
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('cli bin (packages/cli/bin/llxprt.cjs)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];
  let runCliBin: RunCliBin;
  let createCredentialProxyDefault: CreateCredentialProxyDefault;

  beforeEach(() => {
    originalEnv = process.env;
    originalArgv = process.argv;
    process.env = { ...process.env };
    process.argv = ['/node', '/llxprt.cjs'];
    const bin = loadCliBin();
    runCliBin = bin.runCliBin;
    createCredentialProxyDefault = bin.createCredentialProxyDefault;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  async function runLauncher(overrides: RunCliBinOptions = {}) {
    const exitCalls: number[] = [];
    const child = createChildProcess();
    const proxyStop = vi.fn(async () => {});
    const spawnFn = vi.fn(() => child);
    let receivedOnUnexpectedExit: ((info: ProxyExitInfo) => void) | undefined;
    const startCredentialProxy = vi.fn(
      async (proxyOptions?: CredentialProxyStartOptions) => {
        receivedOnUnexpectedExit = proxyOptions?.onUnexpectedExit;
        return { socketPath: '/tmp/llxprt-credential.sock', stop: proxyStop };
      },
    );

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
      ...overrides,
    });

    return {
      child,
      exitCalls,
      proxyStop,
      spawnFn,
      startCredentialProxy,
      receivedOnUnexpectedExit: () => receivedOnUnexpectedExit,
    };
  }

  it('starts a Node-owned credential proxy and passes its socket to the Bun child', async () => {
    delete process.env[credentialSocketEnv];
    process.argv = ['/node', '/llxprt.cjs', '--profile-load', 'dev'];
    const exitCalls: number[] = [];
    const proxyStop = vi.fn(async () => {});
    const child = createChildProcess();
    const spawnFn = vi.fn(() => child);
    const startCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/llxprt-credential.sock',
      stop: proxyStop,
    }));

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
    });

    expect(startCredentialProxy).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(
      '/path/to/bun',
      ['/entry.ts', '--profile-load', 'dev'],
      expect.objectContaining({
        env: expect.objectContaining({
          LLXPRT_BUN_RELAUNCHED: 'true',
          [credentialSocketEnv]: '/tmp/llxprt-credential.sock',
        }),
      }),
    );
    child.emit('close', 0, null);
    await vi.waitFor(() => {
      expect(proxyStop).toHaveBeenCalledTimes(1);
      expect(exitCalls).toStrictEqual([0]);
    });
  });

  it('forwards an existing credential socket unchanged without nesting a proxy', async () => {
    process.env[credentialSocketEnv] = '/tmp/existing.sock';
    const exitCalls: number[] = [];
    const child = createChildProcess();
    const spawnFn = vi.fn(() => child);
    const startCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/new.sock',
      stop: vi.fn(async () => {}),
    }));

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
    });

    expect(startCredentialProxy).not.toHaveBeenCalled();
    expect(spawnFn.mock.calls[0][2]).toStrictEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          LLXPRT_BUN_RELAUNCHED: 'true',
          [credentialSocketEnv]: '/tmp/existing.sock',
        }),
      }),
    );
    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it.each([
    [['--provider', 'openai', '--key', 'sk-test']],
    [['--provider', 'openai', '--key=sk-test']],
    [['--provider', 'openai', '--keyfile', '/tmp/provider-key.txt']],
    [['--provider', 'openai', '--keyfile=/tmp/provider-key.txt']],
  ] satisfies string[][][])(
    'still starts the credential proxy and forwards the socket for --key/--keyfile: %j',
    async (args) => {
      delete process.env[credentialSocketEnv];
      process.argv = ['/node', '/llxprt.cjs', ...args];
      const { child, exitCalls, spawnFn, startCredentialProxy } =
        await runLauncher();

      expect(startCredentialProxy).toHaveBeenCalledTimes(1);
      expect(spawnFn).toHaveBeenCalledWith(
        '/path/to/bun',
        ['/entry.ts', ...args],
        expect.objectContaining({
          env: expect.objectContaining({
            [credentialSocketEnv]: '/tmp/llxprt-credential.sock',
          }),
        }),
      );
      child.emit('close', 0, null);
      await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
    },
  );

  it.each([
    [['--key']],
    [['--key=']],
    [['--key', '--provider']],
    [['--keyfile']],
    [['--keyfile=']],
    [['--keyfile', '--model']],
  ] satisfies string[][][])(
    'starts the credential proxy when direct credential flag has no value: %j',
    async (args) => {
      delete process.env[credentialSocketEnv];
      process.argv = ['/node', '/llxprt.cjs', ...args];
      const { child, exitCalls, spawnFn, startCredentialProxy } =
        await runLauncher();

      expect(startCredentialProxy).toHaveBeenCalledTimes(1);
      expect(spawnFn.mock.calls[0][2]).toStrictEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            [credentialSocketEnv]: '/tmp/llxprt-credential.sock',
          }),
        }),
      );
      child.emit('close', 0, null);
      await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
    },
  );

  it('still starts the credential proxy for named saved credentials', async () => {
    delete process.env[credentialSocketEnv];
    process.argv = ['/node', '/llxprt.cjs', '--key-name', 'work'];
    const { child, exitCalls, startCredentialProxy, spawnFn } =
      await runLauncher();

    expect(startCredentialProxy).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0][2]).toStrictEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          [credentialSocketEnv]: '/tmp/llxprt-credential.sock',
        }),
      }),
    );
    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it('treats an empty credential socket as missing and starts a proxy', async () => {
    process.env[credentialSocketEnv] = '';
    const exitCalls: number[] = [];
    const child = createChildProcess();
    const spawnFn = vi.fn(() => child);
    const startCredentialProxy = vi.fn(async () => ({
      socketPath: '/tmp/new.sock',
      stop: vi.fn(async () => {}),
    }));

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
    });

    expect(startCredentialProxy).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0][2]).toStrictEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          [credentialSocketEnv]: '/tmp/new.sock',
        }),
      }),
    );
    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it('stops the credential proxy when Bun emits an async spawn error', async () => {
    delete process.env[credentialSocketEnv];
    const { child, exitCalls, proxyStop } = await runLauncher();

    child.emit('error', new Error('spawn failed'));

    await vi.waitFor(() => {
      expect(proxyStop).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(exitCalls).toStrictEqual([43]);
    });
  });

  it('exits after Bun closes even when credential proxy cleanup rejects', async () => {
    delete process.env[credentialSocketEnv];
    const proxyStop = vi.fn(async () => {
      throw new Error('stop failed');
    });
    const { child, exitCalls } = await runLauncher({
      startCredentialProxy: vi.fn(async () => ({
        socketPath: '/tmp/llxprt-credential.sock',
        stop: proxyStop,
      })),
    });

    child.emit('close', 0, null);

    await vi.waitFor(() => {
      expect(proxyStop).toHaveBeenCalledTimes(1);
      expect(exitCalls).toStrictEqual([0]);
    });
  });

  it('stops the credential proxy when Bun spawn throws synchronously', async () => {
    delete process.env[credentialSocketEnv];
    const proxyStop = vi.fn(async () => {});

    const { exitCalls } = await runLauncher({
      spawn: vi.fn(() => {
        throw new Error('sync spawn failed');
      }) as unknown as typeof spawnType,
      startCredentialProxy: vi.fn(async () => ({
        socketPath: '/tmp/llxprt-credential.sock',
        stop: proxyStop,
      })),
    });

    expect(proxyStop).toHaveBeenCalledTimes(1);
    expect(exitCalls).toStrictEqual([43]);
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
    ['SIGBREAK', 149],
  ] satisfies Array<[NodeJS.Signals, number]>)(
    'forwards %s to the Bun child until close',
    async (signal, exitCode) => {
      delete process.env[credentialSocketEnv];
      const { child, exitCalls } = await runLauncher();

      process.emit(signal, signal);
      child.emit('close', null, signal);
      await vi.waitFor(() => expect(exitCalls).toStrictEqual([exitCode]));

      expect(child.kill).toHaveBeenCalledWith(signal);
    },
  );

  it('exits directly when a signal arrives before Bun starts', async () => {
    delete process.env[credentialSocketEnv];
    const exitCalls: number[] = [];
    const proxyStop = vi.fn(async () => {});
    const child = createChildProcess();
    const spawnFn = vi.fn(() => child);
    const startCredentialProxy = vi.fn(
      async (proxyOptions?: CredentialProxyStartOptions) => {
        const proxy = {
          socketPath: '',
          stop: proxyStop,
        };
        proxyOptions?.onProxyCreated?.(proxy);
        process.nextTick(() => process.emit('SIGINT', 'SIGINT'));
        await new Promise((resolve) => setImmediate(resolve));
        proxy.socketPath = '/tmp/llxprt-credential.sock';
        return proxy;
      },
    );

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(proxyStop).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(exitCalls).toStrictEqual([130]);
    });
  });

  it('exits with code 1 when the Bun child closes without code or signal', async () => {
    delete process.env[credentialSocketEnv];
    const { child, exitCalls } = await runLauncher();

    child.emit('close', null, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([1]));
  });

  it('exits before starting a proxy when Bun cannot be resolved', async () => {
    const { exitCalls, startCredentialProxy } = await runLauncher({
      resolveBun: () => null,
    });

    expect(startCredentialProxy).not.toHaveBeenCalled();
    expect(exitCalls).toStrictEqual([43]);
  });

  it('exits before starting a proxy when the CLI entry cannot be resolved', async () => {
    const { exitCalls, startCredentialProxy } = await runLauncher({
      resolveEntry: () => null,
    });

    expect(startCredentialProxy).not.toHaveBeenCalled();
    expect(exitCalls).toStrictEqual([43]);
  });

  it('fails closed when credential proxy startup fails', async () => {
    delete process.env[credentialSocketEnv];
    const spawnFn = vi.fn(() => createChildProcess());
    const { exitCalls } = await runLauncher({
      spawn: spawnFn as unknown as typeof spawnType,
      startCredentialProxy: vi.fn(async () => {
        throw new Error('proxy failed');
      }),
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCalls).toStrictEqual([43]);
  });

  it('rejects when the proxy host spawn throws synchronously', async () => {
    const proxyPromise = createCredentialProxyDefault({
      spawn: vi.fn(() => {
        throw new Error('proxy spawn failed');
      }) as unknown as typeof spawnType,
    });

    await expect(proxyPromise).rejects.toThrow(
      /Failed to start the credential proxy needed for Bun runtime access to saved provider credentials/,
    );
  });

  it('starts the no-compile Node proxy host with parent socket stripped', async () => {
    const proxyHost = createChildProcess();
    process.env[credentialSocketEnv] = '/tmp/parent.sock';
    const spawnFn = vi.fn(() => proxyHost);
    let createdProxy: CredentialProxyHandle | undefined;
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
      onProxyCreated: (proxy) => {
        createdProxy = proxy;
      },
    });

    expect(createdProxy?.socketPath).toBe('');
    // Split the startup JSON across two chunks to exercise the buffered parser.
    const startupJson = JSON.stringify({
      socketDir: fixtureSocketDir,
      socketPath: fixtureSocketPath,
    });
    const splitAt = startupJson.indexOf('socketDir');
    proxyHost.stdout.emit('data', Buffer.from(startupJson.slice(0, splitAt)));

    proxyHost.stdout.emit(
      'data',
      Buffer.from(`${startupJson.slice(splitAt)}\nignored\n`),
    );
    const proxy = await proxyPromise;

    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        '--disable-warning=ExperimentalWarning',
        expect.stringContaining('credential-proxy-host.cjs'),
      ]),
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.not.objectContaining({
          [credentialSocketEnv]: expect.anything(),
        }),
      }),
    );
    expect(proxy).toBe(createdProxy);
    expect(proxy.socketPath).toBe(fixtureSocketPath);
    expect(proxy.socketDir).toBe(fixtureSocketDir);

    const stopPromise = proxy.stop();
    proxyHost.emit('close', 0, null);
    await stopPromise;
    expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
    delete process.env[credentialSocketEnv];
  });

  it('resolves proxy stop without killing when proxy host already exited', async () => {
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stdout.emit('data', Buffer.from(proxyStartupLine));
    const proxy = await proxyPromise;
    proxyHost.exitCode = 0;

    await proxy.stop();

    expect(proxyHost.kill).not.toHaveBeenCalled();
  });

  it('invokes onUnexpectedExit when the proxy host dies after startup', async () => {
    const onUnexpectedExit = vi.fn();
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
      onUnexpectedExit,
    });

    proxyHost.stdout.emit('data', Buffer.from(proxyStartupLine));
    await proxyPromise;

    expect(onUnexpectedExit).not.toHaveBeenCalled();

    proxyHost.exitCode = 1;
    proxyHost.emit('close', 1, null);

    expect(onUnexpectedExit).toHaveBeenCalledTimes(1);
    expect(onUnexpectedExit).toHaveBeenCalledWith({ code: 1, signal: null });
  });

  it('does not invoke onUnexpectedExit when the proxy host exits during an intentional stop', async () => {
    const onUnexpectedExit = vi.fn();
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
      onUnexpectedExit,
    });

    proxyHost.stdout.emit('data', Buffer.from(proxyStartupLine));
    const proxy = await proxyPromise;

    const stopPromise = proxy.stop();
    proxyHost.emit('close', 0, null);
    await stopPromise;

    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });

  it('kills the Bun child and exits fatally when the proxy host dies after startup', async () => {
    delete process.env[credentialSocketEnv];
    const { child, exitCalls, receivedOnUnexpectedExit } = await runLauncher();

    const callback = receivedOnUnexpectedExit();
    expect(callback).toBeDefined();
    callback?.({ code: 1, signal: null });

    await vi.waitFor(() => {
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(exitCalls).toStrictEqual([43]);
    });
  });

  it('exits without spawning Bun when the proxy host dies before Bun starts', async () => {
    delete process.env[credentialSocketEnv];
    const exitCalls: number[] = [];
    const child = createChildProcess();
    const spawnFn = vi.fn(() => child);
    const proxyStop = vi.fn(async () => {});
    const startCredentialProxy = vi.fn(
      async (proxyOptions?: CredentialProxyStartOptions) => {
        const proxy = {
          socketPath: '',
          stop: proxyStop,
        };
        proxyOptions?.onProxyCreated?.(proxy);
        await new Promise<void>((resolve) => {
          process.nextTick(() => {
            proxyOptions?.onUnexpectedExit?.({ code: 1, signal: null });
            resolve();
          });
        });
        proxy.socketPath = '/tmp/llxprt-credential.sock';
        return proxy;
      },
    );

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      startCredentialProxy,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(proxyStop).toHaveBeenCalledTimes(1);
      expect(exitCalls).toStrictEqual([43]);
    });
  });

  it('escalates proxy host shutdown to SIGKILL when close never arrives', async () => {
    vi.useFakeTimers();
    try {
      const proxyHost = createChildProcess({ autoClose: false });
      const spawnFn = vi.fn(() => proxyHost);
      const proxyPromise = createCredentialProxyDefault({
        spawn: spawnFn as unknown as typeof spawnType,
      });

      proxyHost.stdout.emit('data', Buffer.from(proxyStartupLine));
      const proxy = await proxyPromise;
      const stopPromise = proxy.stop();

      expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
      // Advance past the SIGTERM deadline (SIGKILL) plus the secondary
      // post-SIGKILL reap deadline before the stop promise settles.
      await vi.advanceTimersByTimeAsync(2000);
      await stopPromise;
      expect(proxyHost.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the sidecar-reported socket dir when forced shutdown escalates to SIGKILL', async () => {
    vi.useFakeTimers();
    const socketDir = await mkdtemp(join(tmpdir(), 'lxcp-test-'));
    try {
      const proxyHost = createChildProcess({ autoClose: false });
      const spawnFn = vi.fn(() => proxyHost);
      const proxyPromise = createCredentialProxyDefault({
        spawn: spawnFn as unknown as typeof spawnType,
      });

      expect(await pathExists(socketDir)).toBe(true);

      proxyHost.stdout.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({
            socketDir,
            socketPath: join(socketDir, 'credential.sock'),
          })}\n`,
        ),
      );
      const proxy = await proxyPromise;

      const stopPromise = proxy.stop();
      // Advance past the SIGTERM deadline (SIGKILL), the secondary post-SIGKILL
      // reap deadline, and the full removeSocketDirWithRetry backoff window
      // (2 inter-attempt delays x 50ms = 100ms) so a retryable rm() error on a
      // slow/flaky filesystem cannot leave the stop promise hanging under fake
      // timers.
      await vi.advanceTimersByTimeAsync(3000);
      await stopPromise;

      expect(proxyHost.kill).toHaveBeenCalledWith('SIGKILL');
      expect(await pathExists(socketDir)).toBe(false);
    } finally {
      vi.useRealTimers();
      await rm(socketDir, { force: true, recursive: true });
    }
  });

  it('leaves the sidecar-reported socket dir intact on a graceful stop', async () => {
    const socketDir = await mkdtemp(join(tmpdir(), 'lxcp-test-'));
    try {
      const proxyHost = createChildProcess();
      const spawnFn = vi.fn(() => proxyHost);
      const proxyPromise = createCredentialProxyDefault({
        spawn: spawnFn as unknown as typeof spawnType,
      });

      proxyHost.stdout.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({
            socketDir,
            socketPath: join(socketDir, 'credential.sock'),
          })}\n`,
        ),
      );
      const proxy = await proxyPromise;

      const stopPromise = proxy.stop();
      proxyHost.emit('close', 0, null);
      await stopPromise;

      // A graceful SIGTERM shutdown lets the sidecar remove its own directory;
      // the parent must not delete it (there is no forced SIGKILL here).
      expect(proxyHost.kill).not.toHaveBeenCalledWith('SIGKILL');
      expect(await pathExists(socketDir)).toBe(true);
    } finally {
      await rm(socketDir, { force: true, recursive: true });
    }
  });

  it('rejects and stops the proxy host when startup never reports a socket', async () => {
    vi.useFakeTimers();
    try {
      const proxyHost = createChildProcess({ autoClose: false });
      const spawnFn = vi.fn(() => proxyHost);
      const proxyPromise = createCredentialProxyDefault({
        spawn: spawnFn as unknown as typeof spawnType,
      });
      const rejection = proxyPromise.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
      // SIGKILL deadline plus the secondary post-SIGKILL reap deadline.
      await vi.advanceTimersByTimeAsync(2000);
      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('credential proxy');
      expect(proxyHost.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects and stops the proxy host when stdout contains malformed JSON', async () => {
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stdout.emit('data', Buffer.from('{"not valid json\n'));

    await expect(proxyPromise).rejects.toThrow(/credential proxy/);
    expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects and stops the proxy host when stdout exceeds the socket line limit', async () => {
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stdout.emit('data', Buffer.from('x'.repeat(8193)));

    await expect(proxyPromise).rejects.toThrow(/credential proxy/);
    expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects when the no-compile proxy host exits before reporting a socket', async () => {
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stderr.emit('data', Buffer.from('proxy init failed\n'));
    proxyHost.emit('close', 1, null);

    await expect(proxyPromise).rejects.toThrow(/credential proxy/);
    expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each([
    // A bare filename: dirname() === '.', which must be rejected so force-kill
    // cleanup can never target the launcher's working directory.
    ['proxy.sock'],
    // A file directly under the OS temp dir: dirname() yields tmpdir() itself,
    // whose basename (e.g. 'tmp') does not carry the lxcp- prefix, so it is
    // rejected at the basename guard before the parent === tmpdir() check.
    [join(tmpdir(), 'proxy.sock')],
    // The filesystem root: dirname('/proxy.sock') === '/'.
    ['/proxy.sock'],
    // An absolute path outside the OS temp dir.
    ['/var/data/lxcp-abc/proxy.sock'],
    // A socket file whose directory is a direct tmpdir child lacking the lxcp-
    // prefix. This exercises the basename prefix guard specifically: the derived
    // dir <tmpdir>/notlxcp-dir is rejected by the prefix check before the
    // parent === tmpdir() check is evaluated.
    [join(tmpdir(), 'notlxcp-dir', 'proxy.sock')],
  ])(
    'rejects a startup line whose derived socket dir is unsafe: %j',
    async (socketPath) => {
      const proxyHost = createChildProcess();
      const spawnFn = vi.fn(() => proxyHost);
      const proxyPromise = createCredentialProxyDefault({
        spawn: spawnFn as unknown as typeof spawnType,
      });

      proxyHost.stdout.emit(
        'data',
        Buffer.from(`${JSON.stringify({ socketPath })}\n`),
      );

      await expect(proxyPromise).rejects.toThrow(/credential proxy/);
      expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
    },
  );

  it('rejects an explicitly reported socketDir that is an unsafe path', async () => {
    // The explicit socketDir branch must be validated too: a tampered/buggy
    // sidecar could report '/' and trigger a catastrophic recursive rm().
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ socketDir: '/', socketPath: '/proxy.sock' })}\n`,
      ),
    );

    await expect(proxyPromise).rejects.toThrow(/credential proxy/);
    expect(proxyHost.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('accepts a fallback socket dir that is a direct lxcp- child of the OS temp dir', async () => {
    // Parse-only: verifies validation of the reported path; the launcher never
    // materializes this directory on disk, so no mkdtemp/cleanup is needed.
    const socketDir = join(tmpdir(), 'lxcp-abc');
    const socketPath = join(socketDir, 'proxy.sock');
    const proxyHost = createChildProcess();
    const spawnFn = vi.fn(() => proxyHost);
    const proxyPromise = createCredentialProxyDefault({
      spawn: spawnFn as unknown as typeof spawnType,
    });

    proxyHost.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ socketPath })}\n`),
    );
    const proxy = await proxyPromise;

    expect(proxy.socketPath).toBe(socketPath);
    expect(proxy.socketDir).toBe(socketDir);
  });

  it('exposes runCliBin as a function without executing the launcher on import', () => {
    const bin = loadCliBin();
    expect(typeof bin.runCliBin).toBe('function');
  });

  it('real sidecar reports a socket usable by ProxySocketClient handshake', async () => {
    delete process.env[credentialSocketEnv];
    const proxy = await createCredentialProxyDefault();

    try {
      expect(typeof proxy.socketPath).toBe('string');
      expect(proxy.socketPath.length).toBeGreaterThan(0);

      const { ProxySocketClient } = await import('@vybestack/llxprt-code-core');
      const client = new ProxySocketClient(proxy.socketPath);
      try {
        await expect(client.ensureConnected()).resolves.toBeUndefined();
      } finally {
        try {
          client.close();
        } catch {
          // Preserve the original connection assertion failure if close also fails.
        }
      }
    } finally {
      try {
        await proxy.stop();
      } catch {
        // Preserve the original test failure if cleanup also fails.
      }
    }
  }, 20_000);
});
