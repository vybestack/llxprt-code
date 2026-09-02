/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SandboxLaunchLifecycle } from './sandbox-lifecycle.js';
import { createTcpToUdsBridge } from './sandbox-ssh.js';

/**
 * Contract tests for the #3469 launch ownership registry. Every resource is
 * real (child processes, TCP servers, temp directories); "exactly once" is
 * proven with a stateful resource whose second release throws — if the
 * registry double-released, the warning would surface on stderr.
 */

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Captures real stderr output written while `run` executes. */
function captureStderr(run: () => void): string {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: Uint8Array | string) => {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stderr.write;
  try {
    run();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

/** A resource that records its release in real state and rejects a second one. */
function onceOnlyResource(): {
  state: { released: boolean };
  release: () => void;
} {
  const state = { released: false };
  return {
    state,
    release: (): void => {
      if (state.released) throw new Error('resource released twice');
      state.released = true;
    },
  };
}

/** Resolves when the child has fully exited and been reaped. */
async function waitForExit(
  child: ReturnType<typeof spawn>,
): Promise<NodeJS.Signals | null> {
  return new Promise((resolve) => {
    child.on('close', (_code, signal) => {
      resolve(signal);
    });
  });
}

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SandboxLaunchLifecycle failure drain', () => {
  it('releases every owned resource in stage order regardless of acquisition order', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const dirs = new Map<string, string>([
      ['main container', makeTempDir('lc-main-')],
      ['proxy sidecar', makeTempDir('lc-sidecar-')],
      ['credential proxy server', makeTempDir('lc-proxy-')],
      ['credential proxy bridge', makeTempDir('lc-bridge-')],
      ['ssh tunnel', makeTempDir('lc-ssh-')],
      ['port forwarding', makeTempDir('lc-forward-')],
      ['session tmpdir', makeTempDir('lc-tmp-')],
      ['dependency volumes', makeTempDir('lc-volumes-')],
    ]);
    cleanupDirs.push(...dirs.values());
    // Acquisition order deliberately scrambled relative to release order:
    // volumes and the tmpdir are acquired first in a real launch, the main
    // container last. The stage, not the registration order, must fix that
    // containers release before the dependency volumes.
    lifecycle.own('dependency-volume', 'dependency volumes', () =>
      fs.rmSync(dirs.get('dependency volumes')!, { recursive: true }),
    );
    lifecycle.own('tunnel', 'ssh tunnel', () =>
      fs.rmSync(dirs.get('ssh tunnel')!, { recursive: true }),
    );
    lifecycle.own('credential-proxy', 'credential proxy server', () =>
      fs.rmSync(dirs.get('credential proxy server')!, { recursive: true }),
    );
    lifecycle.own('proxy-sidecar', 'proxy sidecar', () =>
      fs.rmSync(dirs.get('proxy sidecar')!, { recursive: true }),
    );
    lifecycle.own('session-tmpdir', 'session tmpdir', () =>
      fs.rmSync(dirs.get('session tmpdir')!, { recursive: true }),
    );
    lifecycle.own('main-container', 'main container', () =>
      fs.rmSync(dirs.get('main container')!, { recursive: true }),
    );
    lifecycle.own('tunnel', 'port forwarding', () =>
      fs.rmSync(dirs.get('port forwarding')!, { recursive: true }),
    );
    lifecycle.own('credential-proxy', 'credential proxy bridge', () =>
      fs.rmSync(dirs.get('credential proxy bridge')!, { recursive: true }),
    );

    lifecycle.releaseForFailedLaunch();

    expect(lifecycle.releasedResources()).toStrictEqual([
      'main container',
      'proxy sidecar',
      'credential proxy server',
      'credential proxy bridge',
      'ssh tunnel',
      'port forwarding',
      'session tmpdir',
      'dependency volumes',
    ]);
    for (const dir of dirs.values()) {
      expect(fs.existsSync(dir)).toBe(false);
    }
  });

  it('kills a real owned child process and closes a real bridge server', async () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const tunnel = spawn('sleep', ['30'], { stdio: 'ignore' });
    const bridge = await createTcpToUdsBridge(
      path.join(os.tmpdir(), 'absent.sock'),
    );
    expect(bridge.server.listening).toBe(true);
    lifecycle.own('tunnel', 'ssh tunnel', () => tunnel.kill('SIGTERM'));
    lifecycle.own('tunnel', 'credential bridge server', () =>
      bridge.server.close(),
    );

    const exitPromise = waitForExit(tunnel);
    lifecycle.releaseForFailedLaunch();
    const exitSignal = await exitPromise;
    lifecycle.releaseForFailedLaunch();

    expect(tunnel.killed).toBe(true);
    expect(exitSignal).toBe('SIGTERM');
    expect(bridge.server.listening).toBe(false);
  });

  it('releases each resource exactly once across repeated drains', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const once = onceOnlyResource();
    lifecycle.own('tunnel', 'ssh tunnel', once.release);

    const stderr = captureStderr(() => {
      lifecycle.releaseForFailedLaunch();
      lifecycle.releaseForFailedLaunch();
    });

    expect(once.state.released).toBe(true);
    expect(stderr).not.toContain('released twice');
    expect(lifecycle.releasedResources()).toStrictEqual(['ssh tunnel']);
  });

  it('keeps releasing later resources and stays visible when one release fails', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const healthy = makeTempDir('lc-healthy-');
    cleanupDirs.push(healthy);
    const failingDir = makeTempDir('lc-failing-');
    cleanupDirs.push(failingDir);
    lifecycle.own(
      'proxy-sidecar',
      'proxy sidecar',
      // Real filesystem failure: rmdir on a path that does not exist throws.
      () => fs.rmdirSync(path.join(failingDir, 'missing-child')),
    );
    lifecycle.own('dependency-volume', 'dependency volumes', () =>
      fs.rmSync(healthy, { recursive: true }),
    );

    const stderr = captureStderr(() => {
      lifecycle.releaseForFailedLaunch();
    });

    expect(stderr).toContain('Warning: failed to release proxy sidecar');
    expect(stderr).toContain('ENOENT');
    // The failure did not stop the drain: the later resource still released.
    expect(lifecycle.releasedResources()).toStrictEqual(['dependency volumes']);
    expect(fs.existsSync(healthy)).toBe(false);
  });

  it('fails fast when acquiring a resource after the lifecycle was drained', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    lifecycle.releaseForFailedLaunch();

    expect(() => lifecycle.own('tunnel', 'late tunnel', () => {})).toThrowError(
      /after the launch lifecycle was drained/,
    );
  });

  it('ignores acquisitions that produced no releasable resource', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const once = onceOnlyResource();
    lifecycle.own('tunnel', 'ssh tunnel', undefined);
    lifecycle.own('tunnel', 'port forwarding', once.release);

    lifecycle.releaseForFailedLaunch();

    expect(lifecycle.releasedResources()).toStrictEqual(['port forwarding']);
  });
});

describe('SandboxLaunchLifecycle success handoff', () => {
  it('transfers ownership without releasing and spends the lifecycle', () => {
    const lifecycle = new SandboxLaunchLifecycle();
    const dir = makeTempDir('lc-handoff-');
    cleanupDirs.push(dir);
    const once = onceOnlyResource();
    lifecycle.own('session-tmpdir', 'session tmpdir', () =>
      fs.rmSync(dir, { recursive: true }),
    );
    lifecycle.own('tunnel', 'ssh tunnel', once.release);

    lifecycle.transferToProcessHandlers();

    // The process handlers own the resources now: neither a drain of this
    // spent lifecycle nor a new acquisition may touch them.
    lifecycle.releaseForFailedLaunch();
    expect(fs.existsSync(dir)).toBe(true);
    expect(once.state.released).toBe(false);
    expect(lifecycle.releasedResources()).toStrictEqual([]);
    expect(() => lifecycle.own('tunnel', 'late tunnel', () => {})).toThrowError(
      /after the launch lifecycle was drained/,
    );
  });
});
