/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  killChildTreeAndWait,
  observeChildClose,
} from '../lib/bun-test-retry.js';

export interface NativeProcessTree {
  readonly child: ChildProcess;
  readonly closed: Promise<void>;
  readonly descendantPid: Promise<number>;
  dispose(): Promise<void>;
}

export function startNativeProcessTree(): NativeProcessTree {
  const descendantScript =
    "process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 1000)";
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
      const { spawn } = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      setInterval(() => {}, 1000);
    `,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const closed = observeChildClose(child);
  const descendantPid = new Promise<number>((resolve, reject) => {
    let output = '';
    child.once('error', reject);
    child.once('close', () =>
      reject(new Error('Native tree closed before readiness')),
    );
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (!output.endsWith('\n')) return;
      const pid = Number(output.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        reject(
          new Error(
            'Native descendant did not publish a valid process identity',
          ),
        );
      } else {
        resolve(pid);
      }
    });
  });
  return {
    child,
    closed,
    descendantPid,
    dispose: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        await killChildTreeAndWait(child, closed, { reapTimeoutMs: 8000 });
      }
      await closed;
    },
  };
}

export async function withTerminatedNativeProcessTree(
  exercise: (child: ChildProcess, descendantPid: number) => void,
): Promise<void> {
  const tree = startNativeProcessTree();
  try {
    const descendantPid = await tree.descendantPid;
    await killChildTreeAndWait(tree.child, tree.closed, {
      reapTimeoutMs: 8000,
    });
    exercise(tree.child, descendantPid);
  } finally {
    await tree.dispose();
  }
}
