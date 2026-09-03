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
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Storage } from '@vybestack/llxprt-code-storage';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { runContainerSandbox } from './sandbox-exec.js';

/**
 * #3469 launch-boundary tests: every resource acquired during sandbox
 * preparation or launch must be released when a later step fails, using the
 * same cleanup behavior as a normally completed session.
 *
 * The host credential proxy is faked with real on-disk state (a marker file
 * that exists exactly while the proxy runs) because it binds real sockets
 * and reads the real keyring, an external I/O boundary. Everything else is
 * real: tunnels are real `sleep` child processes, forwarded ports are real
 * TCP listeners, containers and volumes run against the executable fake
 * engine through PATH, and the session tmpdir is a real directory.
 */

const realAuthProviderModule = {
  ...(await import('@vybestack/llxprt-code-providers/auth.js')),
};

/** Real on-disk state for the fake credential proxy server. */
const proxyFake = {
  markerPath: '',
  socketPath: undefined as string | undefined,
};

void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  ...realAuthProviderModule,
  createAndStartProxy: vi.fn(async (config: { socketPath: string }) => {
    fs.mkdirSync(path.dirname(proxyFake.markerPath), { recursive: true });
    fs.writeFileSync(proxyFake.markerPath, 'running\n');
    proxyFake.socketPath = path.join(config.socketPath, 'issue3469.sock');
    return { stop: async () => {} };
  }),
  getProxySocketPath: vi.fn(() => proxyFake.socketPath),
  getProxyCapabilityToken: vi.fn(() => 'issue3469-fake-capability-token'),
  stopProxy: vi.fn(async () => {
    fs.rmSync(proxyFake.markerPath, { force: true });
    proxyFake.socketPath = undefined;
  }),
}));

// Main-container spawn and shell-based probes are routed per test; the fake
// engine itself still runs for real through spawnSync (dependency volumes)
// and through the sidecar pass-through below.
const __actual = { ...(await import('node:child_process')) };
void vi.mock('node:child_process', () => {
  const actual: typeof import('node:child_process') = __actual;
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const PODMAN_MACHINE_CONNECTION = JSON.stringify([
  {
    Name: 'podman-machine-default-root',
    URI: 'ssh://root@127.0.0.1:52322/run/podman/podman.sock?secure=true',
    Identity: '/tmp/issue3469-fake-key',
    Default: true,
  },
]);

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

/**
 * Deferred exit signal for children spawned during the launch itself: the
 * resolver is handed to the spawn router, so the promise exists before the
 * child does.
 */
function deferredExit(): {
  signal: Promise<NodeJS.Signals | null>;
  track: (child: ChildProcess) => void;
} {
  let resolveSignal: ((signal: NodeJS.Signals | null) => void) | undefined;
  const signal = new Promise<NodeJS.Signals | null>((resolve) => {
    resolveSignal = resolve;
  });
  return {
    signal,
    track: (child) => {
      child.on('close', (_code, childSignal) => {
        resolveSignal?.(childSignal);
      });
    },
  };
}

/**
 * #3533 remediation: a real child this file spawned. Sidecar children are
 * spawned detached, so each is a process-group leader whose release must
 * cover the entire group it created.
 */
interface TrackedChild {
  readonly child: ChildProcess;
  readonly groupLeader: boolean;
}

/**
 * #3533 remediation: private deterministic readiness-gate barrier. The gate
 * counts every readiness request it observes, rejects the ones that arrive
 * before the sidecar registered, and owns the release file that a gated
 * sidecar's engine registration waits for.
 */
interface ReadinessGate {
  /** Readiness requests destroyed while the sidecar was not registered. */
  rejections: number;
  /** Readiness requests answered 200 after registration. */
  acceptances: number;
  /**
   * Created by the gate only after the first observed rejection, so gated
   * registration is causally ordered behind a rejected readiness request.
   */
  readonly releasePath: string;
}

/** narrows a Node kill error to its errno code */
function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code: unknown = error.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * #3533 remediation: kills every member of a sidecar process group this
 * fixture created. The group may already be gone, which is not an error.
 */
function killProcessGroup(groupId: number): void {
  try {
    process.kill(-groupId, 'SIGKILL');
  } catch (err) {
    if (errnoCode(err) !== 'ESRCH') throw err;
  }
}

/** Captures stderr written while the async `run` settles. */
async function captureStderr(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: Uint8Array | string): boolean => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stderr.write;
  try {
    await run();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

describe('#3469 launch resource release', () => {
  const engine = useFakeEngine();
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';
  let originalCwd = '';
  let isolatedCacheDir = '';
  const trackedChildren: TrackedChild[] = [];
  const trackedServers: net.Server[] = [];
  const createdSessionTmpdirs: string[] = [];
  let tmpdirSnapshot = new Set<string>();
  let proxyMarkerDir = '';

  /**
   * Session tmpdirs this test's own launches created. A whole-directory scan
   * races against sibling test processes creating the same prefix; the
   * recorded paths are exactly the ones this launch must release.
   */
  function assertSessionTmpdirsReleased(): void {
    expect(createdSessionTmpdirs.length).toBeGreaterThan(0);
    for (const dir of createdSessionTmpdirs) {
      expect(fs.existsSync(dir)).toBe(false);
    }
  }

  /**
   * Best-effort sweep for the afterEach: cleans anything new under the
   * prefix, whether or not it came from this file's processes.
   */
  function leakedTmpdirs(): string[] {
    return fs
      .readdirSync(fs.realpathSync(os.tmpdir()))
      .filter(
        (entry) =>
          entry.startsWith('llxprt-sandbox-') && !tmpdirSnapshot.has(entry),
      );
  }

  function leakedRunRoots(): string[] {
    return fs
      .readdirSync(Storage.getGlobalCacheDir())
      .filter((entry) => entry.startsWith('sandbox-node-modules-'));
  }

  /** The fake engine must end with no resource still recorded. */
  function assertEngineEmpty(): void {
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(engine.containerNames()).toStrictEqual([]);
  }

  /**
   * #3533 remediation: terminates and reaps every real child this file
   * spawned and returns the process-group ids of the sidecar groups this
   * run created. Detached sidecar children lead a process group that also
   * holds the engine's real shell descendants, so their release must
   * terminate the whole group, not only the tracked direct child.
   */
  async function terminateTrackedChildren(): Promise<number[]> {
    const terminatedGroups: number[] = [];
    for (const { child, groupLeader } of trackedChildren.splice(0)) {
      // Await exit so the direct child is collected, never left a zombie.
      const whenExited = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.once('error', () => resolve());
      });
      if (groupLeader && child.pid !== undefined) {
        terminatedGroups.push(child.pid);
        // #3533 remediation: the sidecar group also holds the fake
        // engine's real shell descendants; killing only the tracked
        // direct child orphans them (PPID 1 `sleep 120` leftovers).
        killProcessGroup(child.pid);
      } else if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await whenExited;
    }
    return terminatedGroups;
  }

  /**
   * #3533 remediation regression: a fully terminated and reaped sidecar
   * leaves no living or zombie member in its process group; probing the
   * group then fails with ESRCH. Only groups this run created are probed.
   */
  function processGroupAlive(groupId: number): boolean {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch (err) {
      if (errnoCode(err) !== 'ESRCH') throw err;
      return false;
    }
  }

  async function expectProcessGroupsGone(
    groupIds: readonly number[],
  ): Promise<void> {
    expect(groupIds.length).toBeGreaterThan(0);
    const deadline = Date.now() + 5_000;
    for (const groupId of groupIds) {
      while (processGroupAlive(groupId)) {
        if (Date.now() > deadline) {
          throw new Error(
            `sidecar process group ${groupId} still has live members after termination`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * #3533 remediation: after heavy readiness-poll churn, closing the
   * fixed-port listener can leave the port briefly unbindable; wait until a
   * probe bind succeeds so the next scenario starts deterministically. A
   * real holder is never hidden: when the port does not come back, the next
   * test's listenAt still rejects with the bind error.
   */
  async function awaitPortRebindable(port: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const probe = net.createServer();
      const outcome = new Promise<'bound' | 'busy'>((resolve) => {
        probe.once('listening', () => resolve('bound'));
        probe.once('error', () => resolve('busy'));
      });
      probe.listen(port, '127.0.0.1');
      if ((await outcome) === 'busy') {
        if (Date.now() > deadline) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      // Return only once this probe's own listen socket is fully released,
      // so the next real bind cannot race the probe's unbind.
      await new Promise<void>((resolve) => {
        probe.once('close', resolve);
        probe.close();
      });
      return;
    }
  }

  /**
   * Routes child_process spawns: the image probe gets a present image, `ssh`
   * invocations become real long-lived children standing in for tunnels, the
   * proxy sidecar runs against the fake engine for real, and the main
   * container launch behaves as requested.
   */
  function routeSpawns(
    mainLaunch: 'throw' | 'attach',
    onTunnel?: (child: ChildProcess) => void,
    sidecarGate?: ReadinessGate,
  ): void {
    const spawnMock = childProcess.spawn as unknown as Mock<
      typeof childProcess.spawn
    >;
    spawnMock.mockImplementation(((
      command: string,
      args: string[],
      options: childProcess.SpawnOptions,
    ) => {
      if (command === 'ssh-add') {
        return completedEngineProcess('');
      }
      if (command === 'ssh') {
        const child = __actual.spawn('sleep', ['120'], { stdio: 'ignore' });
        trackedChildren.push({ child, groupLeader: false });
        onTunnel?.(child);
        return child;
      }
      if (args[0] === 'images') {
        return completedEngineProcess('image-id\n');
      }
      if (
        args[0] === 'run' &&
        args.includes('--name') &&
        args.includes('llxprt-code-sandbox-proxy')
      ) {
        // #3533: a gated sidecar cannot reach the fake engine until the
        // readiness gate creates the release file, so its registration is
        // deterministically ordered behind an observed readiness request.
        // `exec` hands the tracked child's pid to the engine process
        // itself, keeping the child a process-group leader.
        const child =
          sidecarGate === undefined
            ? __actual.spawn(command, args, options)
            : __actual.spawn(
                'sh',
                [
                  '-c',
                  `until [ -e '${sidecarGate.releasePath}' ]; do sleep 0.05; done; exec "$@"`,
                  'sh',
                  command,
                  ...args,
                ],
                options,
              );
        trackedChildren.push({ child, groupLeader: true });
        return child;
      }
      if (args[0] === 'run') {
        if (mainLaunch === 'throw') {
          throw new Error('engine launch failed');
        }
        const attachArgs = ['run', '--name', args[args.indexOf('--name') + 1]];
        for (let index = 0; index < args.length - 1; index++) {
          if (args[index] === '--mount') {
            attachArgs.push('--mount', args[index + 1]);
          }
        }
        attachArgs.push(engine.config.image, 'true');
        const attached = __actual.spawnSync(engine.command, attachArgs, {
          encoding: 'utf8',
          env: process.env,
        });
        if (attached.status !== 0) {
          throw new Error(`Fake main container failed: ${attached.stderr}`);
        }
        return completedEngineProcess('');
      }
      return completedEngineProcess('');
    }) as unknown as typeof childProcess.spawn);
  }

  /**
   * Routes shell probes: podman-machine SSH checks succeed, container name
   * lookup fails where the test injects a post-acquisition failure, and the
   * user identity probe fails where a test pins the current-user path.
   */
  function routeExecSync(failure: {
    nameLookup?: boolean;
    identityProbe?: boolean;
  }): void {
    const execSyncMock = childProcess.execSync as unknown as Mock<
      typeof childProcess.execSync
    >;
    execSyncMock.mockImplementation(((command: string) => {
      if (command.includes('system connection list')) {
        return Buffer.from(PODMAN_MACHINE_CONNECTION);
      }
      if (command.startsWith('podman machine ssh')) {
        return Buffer.from('ok');
      }
      if (command.includes('ps -a --format')) {
        if (failure.nameLookup === true) {
          throw new Error('engine name lookup failed');
        }
        return Buffer.from('');
      }
      if (command === 'id -u' || command === 'id -g') {
        if (failure.identityProbe === true) {
          throw new Error('identity probe failed');
        }
        return Buffer.from(command === 'id -u' ? '501' : '20');
      }
      if (command.includes('network inspect')) {
        return Buffer.from('');
      }
      if (
        command.startsWith('docker rm -f') ||
        command.startsWith('podman rm -f')
      ) {
        return __actual.execSync(command, { env: process.env });
      }
      return Buffer.from('');
    }) as unknown as typeof childProcess.execSync);
  }

  /** A real TCP listener; the sidecar readiness probe needs an HTTP reply. */
  /**
   * Binds a real TCP listener. Port 0 binds an ephemeral port so concurrent
   * test processes never race on a fixed one; the fixed 8877 sidecar case
   * rejects with the bind error instead of failing downstream.
   */
  async function listenAt(
    port: number,
    respond: (socket: net.Socket) => void,
  ): Promise<{ server: net.Server; port: number }> {
    const server = net.createServer(respond);
    const whenListening = new Promise<number>((resolve, reject) => {
      server.once('listening', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('listener did not bind a TCP port'));
          return;
        }
        resolve(address.port);
      });
      server.once('error', reject);
    });
    server.listen(port, '127.0.0.1');
    trackedServers.push(server);
    return { server, port: await whenListening };
  }

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-3469-'));
    isolatedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3469-uc-'));
    process.env.LLXPRT_CACHE_HOME = isolatedCacheDir;
    originalCwd = process.cwd();
    process.chdir(fixturePath);
    vi.resetAllMocks();
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    delete process.env.LLXPRT_SANDBOX_NETWORK;
    delete process.env.SANDBOX_NETWORK;
    delete process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
    delete process.env.SANDBOX_SET_UID_GID;
    delete process.env.SSH_AUTH_SOCK;
    delete process.env.SANDBOX_PORTS;
    delete process.env.SANDBOX_ENV;
    delete process.env.DEBUG;
    delete process.env.LLXPRT_DEBUG_PORT;
    delete process.env.NODE_ENV;
    tmpdirSnapshot = new Set(
      fs
        .readdirSync(fs.realpathSync(os.tmpdir()))
        .filter((entry) => entry.startsWith('llxprt-sandbox-')),
    );
    createdSessionTmpdirs.length = 0;
    const realMkdtempSync = fs.mkdtempSync;
    vi.spyOn(fs, 'mkdtempSync').mockImplementation(((
      prefix: string,
    ): string => {
      const dir = realMkdtempSync(prefix);
      if (dir.includes('llxprt-sandbox-')) createdSessionTmpdirs.push(dir);
      return dir;
    }) as typeof fs.mkdtempSync);
    proxyMarkerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3469-proxy-'));
    proxyFake.markerPath = path.join(proxyMarkerDir, 'proxy-running');
    proxyFake.socketPath = undefined;
  });

  afterEach(async () => {
    await terminateTrackedChildren();
    const servers = trackedServers.splice(0);
    for (const server of servers) {
      server.close();
    }
    if (servers.length > 0) {
      await awaitPortRebindable(8877);
    }
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      process.chdir(originalCwd);
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
    fs.rmSync(isolatedCacheDir, { recursive: true, force: true });
    fs.rmSync(proxyMarkerDir, { recursive: true, force: true });
    for (const leaked of leakedTmpdirs()) {
      fs.rmSync(path.join(fs.realpathSync(os.tmpdir()), leaked), {
        recursive: true,
        force: true,
      });
    }
  });

  it('releases a live SSH agent tunnel when a later preparation step fails', async () => {
    fs.writeFileSync(path.join(fixturePath, 'agent.sock'), '');
    process.env.SSH_AUTH_SOCK = path.join(fixturePath, 'agent.sock');
    routeExecSync({ nameLookup: true });

    const tunnel = deferredExit();
    routeSpawns('throw', tunnel.track);

    const stderr = await captureStderr(async () => {
      await expect(
        runContainerSandbox(engine.podmanConfig, []),
      ).rejects.toThrowError('engine name lookup failed');
    });
    const signal = await tunnel.signal;

    // The reverse tunnel really was up before the failure.
    expect(signal).toBe('SIGTERM');
    expect(stderr).not.toContain('Warning: failed to release');
    assertEngineEmpty();
    expect(leakedRunRoots()).toStrictEqual([]);
    assertSessionTmpdirsReleased();
  }, 30_000);

  it('releases a live port-forward tunnel when a later preparation step fails', async () => {
    // Ephemeral port: the tunnel's readiness poll connects for real.
    const { port } = await listenAt(0, (socket) => {
      socket.destroy();
    });
    process.env.SANDBOX_PORTS = String(port);
    routeExecSync({ nameLookup: true });

    const tunnel = deferredExit();
    routeSpawns('throw', tunnel.track);

    const stderr = await captureStderr(async () => {
      await expect(
        runContainerSandbox(engine.podmanConfig, []),
      ).rejects.toThrowError('engine name lookup failed');
    });
    const signal = await tunnel.signal;

    expect(signal).toBe('SIGTERM');
    expect(stderr).not.toContain('Warning: failed to release');
    assertEngineEmpty();
    expect(leakedRunRoots()).toStrictEqual([]);
    assertSessionTmpdirsReleased();
  }, 30_000);

  it('stops the credential proxy and removes the session tmpdir when user setup fails', async () => {
    process.env.SANDBOX_SET_UID_GID = '1';
    routeSpawns('throw', undefined);
    routeExecSync({ identityProbe: true });

    const stderr = await captureStderr(async () => {
      await expect(runContainerSandbox(engine.config, [])).rejects.toThrowError(
        'identity probe failed',
      );
    });

    // The proxy marker existed while the proxy ran: the launch failure must
    // stop it again, exactly like a normally completed session.
    expect(fs.existsSync(proxyFake.markerPath)).toBe(false);
    expect(stderr).not.toContain('Warning: failed to release');
    assertEngineEmpty();
    expect(leakedRunRoots()).toStrictEqual([]);
    assertSessionTmpdirsReleased();
  }, 30_000);

  /**
   * Runs the proxied-network launch scenario: the proxy sidecar runs for
   * real against the fake engine, the 8877 listener stands in for the
   * sidecar's HTTP readiness endpoint, and the main container launch is
   * injected to throw. With `sidecar: 'gated'` the sidecar child's engine
   * registration waits for the readiness gate's release file, which the
   * gate creates only after it observed and rejected a pre-registration
   * readiness request (#3533). Returns the captured launch stderr and the
   * gate's observable request counts.
   */
  async function runProxiedLaunchFailure(
    sidecar?: 'gated',
  ): Promise<{ stderr: string; gate: ReadinessGate }> {
    process.env.LLXPRT_SANDBOX_NETWORK = 'proxied';
    process.env.LLXPRT_SANDBOX_PROXY_COMMAND = 'sleep 120';
    // macOS has no `timeout`; the readiness probe shells out to it. A shim
    // that drops the duration and executes the command keeps the probe real.
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3469-bin-'));
    fs.writeFileSync(
      path.join(shimDir, 'timeout'),
      '#!/bin/sh\nshift\nexec "$@"\n',
      { mode: 0o755 },
    );
    const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3533-gate-'));
    const gate: ReadinessGate = {
      rejections: 0,
      acceptances: 0,
      releasePath: path.join(gateDir, 'released'),
    };
    const originalPath = process.env.PATH ?? '';
    const scenarioServers: net.Server[] = [];
    try {
      process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH}`;
      scenarioServers.push(
        (
          await listenAt(8877, (socket) => {
            // #3533: readiness must reflect the engine record, not the
            // listener bind. A reply before the fake engine persisted the
            // sidecar lets the launch proceed to `network connect`, which
            // finds no container. Destroying the connection keeps the
            // production retry loop polling; a never-registering sidecar
            // still runs into the readiness timeout.
            if (
              !engine.containerNames().includes('llxprt-code-sandbox-proxy')
            ) {
              gate.rejections++;
              // #3533: the first observed rejection releases the gated
              // registration, so the request order is causal: no
              // registration can precede an observed, rejected readiness
              // request.
              if (gate.rejections === 1) {
                fs.writeFileSync(gate.releasePath, 'released\n');
              }
              socket.destroy();
              return;
            }
            gate.acceptances++;
            socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
          })
        ).server,
      );
      routeSpawns('throw', undefined, sidecar === 'gated' ? gate : undefined);
      routeExecSync({});
      const stderr = await captureStderr(async () => {
        await expect(
          runContainerSandbox(engine.config, []),
        ).rejects.toThrowError('engine launch failed');
      });
      return { stderr, gate };
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(shimDir, { recursive: true, force: true });
      fs.rmSync(gateDir, { recursive: true, force: true });
      // #3533 remediation: the scenario owns its fixed-port listener so
      // repeated scenarios (and the process-group regression loop) rebind
      // deterministically instead of racing the teardown sweep.
      for (const server of scenarioServers) {
        const index = trackedServers.indexOf(server);
        if (index >= 0) trackedServers.splice(index, 1);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (scenarioServers.length > 0) {
        await awaitPortRebindable(8877);
      }
    }
  }

  /**
   * Engine invocation-log indices for the proxied launch: where the sidecar
   * ran, where it was connected to the sandbox network, and where the launch
   * failure released it and the dependency volume, in order.
   */
  function sidecarReleaseOrder(): {
    sidecarRun: number;
    networkConnect: number;
    sidecarRm: number;
    volumeRm: number;
  } {
    const invocations = engine.invocations();
    return {
      sidecarRun: invocations.findIndex(
        (argv) =>
          argv[0] === 'run' && argv.includes('llxprt-code-sandbox-proxy'),
      ),
      networkConnect: invocations.findIndex(
        (argv) => argv[0] === 'network' && argv[1] === 'connect',
      ),
      sidecarRm: invocations.findIndex(
        (argv) =>
          argv[0] === 'rm' && argv.includes('llxprt-code-sandbox-proxy'),
      ),
      volumeRm: invocations.findIndex(
        (argv) => argv[0] === 'volume' && argv[1] === 'rm',
      ),
    };
  }

  it('stops a started proxy sidecar when the main engine spawn throws', async () => {
    const { stderr } = await runProxiedLaunchFailure();
    const { sidecarRun, networkConnect, sidecarRm, volumeRm } =
      sidecarReleaseOrder();
    // The sidecar really started: its container was recorded and connected
    // to the sandbox network before the launch failure, then removed again
    // (AC2), before the volumes.
    expect(sidecarRun).toBeGreaterThanOrEqual(0);
    expect(networkConnect).toBeGreaterThan(sidecarRun);
    expect(sidecarRm).toBeGreaterThan(networkConnect);
    expect(volumeRm).toBeGreaterThan(sidecarRm);
    expect(engine.containerNames()).toStrictEqual([]);
    expect(fs.existsSync(proxyFake.markerPath)).toBe(false);
    expect(stderr).not.toContain('Warning: failed to release');
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(leakedRunRoots()).toStrictEqual([]);
    assertSessionTmpdirsReleased();
  }, 60_000);

  it('network-connects a proxy sidecar whose registration the readiness gate releases only after a rejected pre-registration request', async () => {
    const { stderr, gate } = await runProxiedLaunchFailure('gated');
    const { sidecarRun, networkConnect, sidecarRm, volumeRm } =
      sidecarReleaseOrder();
    // #3533: the gated child could not register until the gate observed and
    // rejected a real pre-registration readiness request, so the request
    // order is proven, not assumed from scheduler timing. The launch then
    // passed network connect before the injected main-container failure
    // released everything.
    expect(gate.rejections).toBeGreaterThanOrEqual(1);
    expect(gate.acceptances).toBeGreaterThanOrEqual(1);
    expect(sidecarRun).toBeGreaterThanOrEqual(0);
    expect(networkConnect).toBeGreaterThan(sidecarRun);
    expect(sidecarRm).toBeGreaterThan(networkConnect);
    expect(volumeRm).toBeGreaterThan(sidecarRm);
    expect(engine.containerNames()).toStrictEqual([]);
    expect(fs.existsSync(proxyFake.markerPath)).toBe(false);
    expect(stderr).not.toContain('Warning: failed to release');
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(leakedRunRoots()).toStrictEqual([]);
    assertSessionTmpdirsReleased();
  }, 60_000);

  it('leaves no sidecar process-group descendants after repeated proxied launches', async () => {
    // #3533 remediation: the sidecar child leads a real process group that
    // also holds the fake engine's shell descendants; every group this run
    // created must be fully terminated and reaped, repeatedly.
    const groupIds: number[] = [];
    for (let launch = 0; launch < 3; launch++) {
      await runProxiedLaunchFailure();
      groupIds.push(...(await terminateTrackedChildren()));
    }
    expect(groupIds.length).toBeGreaterThanOrEqual(3);
    await expectProcessGroupsGone(groupIds);
  }, 120_000);

  it('keeps the normal success path on the wired close handlers', async () => {
    fs.writeFileSync(path.join(fixturePath, 'agent.sock'), '');
    process.env.SSH_AUTH_SOCK = path.join(fixturePath, 'agent.sock');
    routeExecSync({});

    const tunnel = deferredExit();
    routeSpawns('attach', tunnel.track);

    let exitCode: number | undefined;
    const stderr = await captureStderr(async () => {
      const result = await runContainerSandbox(engine.podmanConfig, []);
      exitCode = result.exitCode;
    });
    const signal = await tunnel.signal;

    expect(exitCode).toBe(0);
    // The tunnel is released by the normal close wiring, not by a drain.
    expect(signal).toBe('SIGTERM');
    expect(stderr).not.toContain('Warning: failed to release');
    assertEngineEmpty();
    expect(leakedRunRoots()).toStrictEqual([]);
  }, 30_000);
});
