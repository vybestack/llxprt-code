/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import type { IPty } from '@lydell/node-pty';
import { loadNodePty, type PtyImplementation } from '../utils/getPty.js';

function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  timeoutValue: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(timeoutValue), ms);
      timer.unref();
    }),
  ]);
}

/**
 * Bun's default POSIX backend has no process groups, so the group-kill branch
 * under test needs the lydell backend. It can exit without output under Bun
 * (oven-sh/bun#25822), so require consecutive successful probe rounds.
 */
const PROBE_ROUNDS = 3;

async function probeUsableForkptyPty(): Promise<PtyImplementation> {
  const ptyInfo = await withDeadline(loadNodePty(), 5000, null);
  if (ptyInfo === null) {
    return null;
  }
  for (let round = 0; round < PROBE_ROUNDS; round++) {
    const ok = await new Promise<boolean>((resolve, reject) => {
      let dataDisposable: { dispose(): void } | undefined;
      let exitDisposable: { dispose(): void } | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let result: boolean | undefined;
      let failure: Error | undefined;
      let probe: IPty | undefined;
      try {
        const spawnedProbe = ptyInfo.module.spawn(
          'bash',
          ['-c', 'echo PTY_PROBE_OK'],
          {
            cols: 80,
            rows: 30,
            env: { ...process.env, TERM: 'xterm-256color' },
          },
        );
        probe = spawnedProbe;
        const stop = (ok: boolean): void => {
          if (result !== undefined) {
            return;
          }
          result = ok;
          dataDisposable?.dispose();
          spawnedProbe.kill();
        };
        exitDisposable = spawnedProbe.onExit(() => {
          dataDisposable?.dispose();
          exitDisposable?.dispose();
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          if (failure !== undefined) {
            reject(failure);
            return;
          }
          resolve(result ?? false);
        });
        dataDisposable = spawnedProbe.onData((chunk: string) => {
          if (chunk.includes('PTY_PROBE_OK')) {
            stop(true);
          }
        });
        timeout = setTimeout(() => stop(false), 5000);
        timeout.unref();
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        if (probe === undefined || exitDisposable === undefined) {
          reject(failure);
          return;
        }
        result = false;
        dataDisposable?.dispose();
        probe.kill();
      }
    });
    if (!ok) {
      return null;
    }
  }
  return ptyInfo;
}

let forkptyBackend: PtyImplementation | null = null;
if (os.platform() !== 'win32') {
  try {
    forkptyBackend = await probeUsableForkptyPty();
  } catch {
    forkptyBackend = null;
  }
}

export { forkptyBackend };
