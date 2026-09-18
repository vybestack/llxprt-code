/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'bun:test';
import type * as childProcess from 'node:child_process';

/** The two mocked child_process entry points, named once for the routers. */
export type SpawnMock = Mock<typeof childProcess.spawn>;
export type ExecSyncMock = Mock<typeof childProcess.execSync>;

export const PODMAN_MACHINE_CONNECTION = JSON.stringify([
  {
    Name: 'podman-machine-default-root',
    URI: 'ssh://root@127.0.0.1:52322/run/podman/podman.sock?secure=true',
    Identity: '/tmp/issue3469-fake-key',
    Default: true,
  },
]);

export function deferredExit(): {
  signal: Promise<NodeJS.Signals | null>;
  track: (child: childProcess.ChildProcess) => void;
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
export interface TrackedChild {
  readonly child: childProcess.ChildProcess;
  readonly groupLeader: boolean;
}

/**
 * #3533 remediation: private deterministic readiness-gate barrier. The gate
 * counts every readiness request it observes, rejects the ones that arrive
 * before the sidecar registered, and owns the release file that a gated
 * sidecar's engine registration waits for.
 */
export interface ReadinessGate {
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
export function errnoCode(error: unknown): string | undefined {
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
export function killProcessGroup(groupId: number): void {
  try {
    process.kill(-groupId, 'SIGKILL');
  } catch (err) {
    if (errnoCode(err) !== 'ESRCH') throw err;
  }
}

/** Captures stderr written while the async `run` settles. */
export async function captureStderr(run: () => Promise<void>): Promise<string> {
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
