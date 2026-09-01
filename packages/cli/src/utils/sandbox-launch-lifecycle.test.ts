/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Storage } from '@vybestack/llxprt-code-storage';
import { runContainerSandbox } from './sandbox-exec.js';

// The host credential-proxy server binds real sockets and reads the real
// keyring: an external I/O boundary. The #3450 launch-failure tests fake
// only that boundary; every container-argv and filesystem behavior stays
// real.
const realAuthProviderModule = {
  ...(await import('@vybestack/llxprt-code-providers/auth.js')),
};
void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  ...realAuthProviderModule,
  createAndStartProxy: vi.fn(async () => ({ stop: async () => {} })),
  getProxySocketPath: vi.fn(() => '/tmp/llxprt-issue3450-fake.sock'),
  getProxyCapabilityToken: vi.fn(() => 'issue3450-fake-capability-token'),
  stopProxy: vi.fn(async () => {}),
}));

// Explicit factory mock: execFile, execSync, and spawn are stubbed so these
// tests do not invoke the container engine (see sandbox-containers.test.ts for
// the full rationale; `exec` stays real so promisify(exec) keeps settling).
const __actual = { ...(await import('node:child_process')) };
void vi.mock('node:child_process', () => {
  const actual: typeof import('node:child_process') = __actual;
  return {
    ...actual,
    execFile: vi.fn(),
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const CONFIG = { command: 'docker', image: 'test' } as const;

function setNetworkEnvironment(
  primary: string | undefined,
  legacy: string | undefined,
  proxyCommand: string | undefined,
): void {
  const values = {
    LLXPRT_SANDBOX_NETWORK: primary,
    SANDBOX_NETWORK: legacy,
    LLXPRT_SANDBOX_PROXY_COMMAND: proxyCommand,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('#3450 private dependency storage lifecycle on a failed launch', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';
  let originalCwd = '';
  let isolatedCacheDir = '';

  function completedEngineProcess(stdout: string): childProcess.ChildProcess {
    const proc = new EventEmitter() as unknown as childProcess.ChildProcess;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    proc.stdout = stdoutStream;
    proc.stderr = stderrStream;
    queueMicrotask(() => {
      stdoutStream.end(stdout === '' ? undefined : Buffer.from(stdout));
      stderrStream.end();
      queueMicrotask(() => {
        proc.emit('close', 0);
      });
    });
    return proc;
  }

  /** Lets startup orphan recovery run against an empty managed-container list. */
  function satisfyOrphanRecoveryProbe(): void {
    const execFileMock = childProcess.execFile as unknown as Mock<
      typeof childProcess.execFile
    >;
    execFileMock.mockImplementation(((
      _command: string,
      _args: readonly string[],
      _options: childProcess.ExecFileOptionsWithStringEncoding,
      callback: (
        error: childProcess.ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      const proc = completedEngineProcess('');
      queueMicrotask(() => {
        callback(null, '', '');
      });
      return proc;
    }) as unknown as typeof childProcess.execFile);
  }

  /** Lets preparation continue past the selected-image presence check. */
  function satisfyImagePresenceProbe(): void {
    const spawnMock = childProcess.spawn as unknown as Mock<
      typeof childProcess.spawn
    >;
    spawnMock.mockImplementation(((_command: string, args: string[]) =>
      completedEngineProcess(
        args[0] === 'images' ? 'image-id\n' : '',
      )) as unknown as typeof childProcess.spawn);
  }

  /**
   * Keeps the image probe alive but makes every later engine invocation fail
   * synchronously, matching a real engine binary that vanished between the
   * image check and the launch.
   */
  function satisfyProbeThenFailLaunch(): void {
    const spawnMock = childProcess.spawn as unknown as Mock<
      typeof childProcess.spawn
    >;
    spawnMock.mockImplementation(((_command: string, args: string[]) => {
      if (args[0] === 'images') {
        return completedEngineProcess('image-id\n');
      }
      throw new Error('engine launch failed');
    }) as unknown as typeof childProcess.spawn);
  }

  function leakedRunRoots(): string[] {
    return fs
      .readdirSync(Storage.getGlobalCacheDir())
      .filter((entry) => entry.startsWith('sandbox-node-modules-'));
  }

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-3450-'));
    // Point the production Storage resolver at an isolated cache so these
    // #3450 tests never create or inspect run directories in the shared
    // live user cache (#3450 remediation F8).
    isolatedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-uc-'));
    process.env.LLXPRT_CACHE_HOME = isolatedCacheDir;
    originalCwd = process.cwd();
    // runContainerSandbox resolves the workspace from process.cwd(); launch
    // against the empty fixture instead of this repository's own tree.
    process.chdir(fixturePath);
    vi.resetAllMocks();
    (
      childProcess.execSync as Mock<typeof childProcess.execSync>
    ).mockReturnValue(Buffer.from('image-id\\n'));
    // The preparation-failure point must sit AFTER private storage creation:
    // on macOS with networking off, the credential bridge requirement aborts
    // the launch during prepareContainerSandbox.
    setNetworkEnvironment('off', undefined, undefined);
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    delete process.env.SSH_AUTH_SOCK;
    delete process.env.SANDBOX_ENV;
    delete process.env.SANDBOX_SET_UID_GID;
    delete process.env.LLXPRT_DEBUG_PORT;
    delete process.env.NODE_ENV;
    satisfyOrphanRecoveryProbe();
    satisfyImagePresenceProbe();
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      process.chdir(originalCwd);
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
    if (isolatedCacheDir !== '') {
      fs.rmSync(isolatedCacheDir, { recursive: true, force: true });
    }
  });

  it('rejects with the credential bridge error and leaves no per-run subtree', async () => {
    await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
      'macOS credential bridge requires container networking; enable networking or use Linux for network-off sandboxing.',
    );

    // Storage is created earlier in preparation; the handled failure must
    // remove it again rather than leak the private subtree in the cache.
    expect(leakedRunRoots()).toStrictEqual([]);
  });

  it('rejects and releases the per-run storage when the engine launch itself fails', async () => {
    // Preparation must complete, so the credential bridge requirement may
    // not fire: networking is unset (the macOS requirement triggers only
    // with `network: off`) and the os.platform spy still reports 'darwin'
    // here, while the host credential proxy boundary is faked (see the
    // vi.mock above).
    setNetworkEnvironment(undefined, undefined, undefined);
    satisfyProbeThenFailLaunch();

    await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
      'engine launch failed',
    );

    // The storage was created during preparation; a launch failure after
    // preparation must remove it again rather than leak the subtree.
    expect(leakedRunRoots()).toStrictEqual([]);
  });

  it('stops a recognized wrong-platform host tree before any engine invocation', async () => {
    // A host ELF addon under a macOS host: the preflight must abort the
    // production launch path with repair guidance, and the only engine
    // process ever invoked is the read-only image-presence probe.
    fs.mkdirSync(path.join(fixturePath, 'node_modules', 'host-pkg'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fixturePath, 'node_modules', 'host-pkg', 'addon.node'),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    );
    const spawnMock = childProcess.spawn as unknown as Mock<
      typeof childProcess.spawn
    >;

    await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
      'Sandbox dependency preflight failed',
    );

    const engineInvocations = spawnMock.mock.calls
      .map((call) => call[1])
      .filter((callArgs) => Array.isArray(callArgs));
    expect(engineInvocations).toHaveLength(1);
    expect(engineInvocations[0]?.[0]).toBe('images');
    expect(leakedRunRoots()).toStrictEqual([]);
  });
});
