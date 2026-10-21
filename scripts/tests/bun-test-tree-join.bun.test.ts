/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { ChildProcess, spawn } from 'node:child_process';
import * as childProcess from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import {
  killChildTreeAndWait,
  observeChildClose,
} from '../lib/bun-test-retry.js';
import {
  startNativeProcessTree,
  withTerminatedNativeProcessTree,
} from './native-process-tree-fixture.js';

describe.skipIf(process.platform === 'win32')('POSIX process tree join', () => {
  it('does not complete at direct-child close while the owned group still exists', async () => {
    const tree = startNativeProcessTree();
    await tree.descendantPid;
    const parentPid = tree.child.pid;
    if (parentPid === undefined) throw new Error('Missing native PID');
    const nativeKill = process.kill.bind(process);
    let groupVisible = true;
    let settled = false;
    let reap: Promise<void> | undefined;
    const table = childProcess.spawnSync('ps', ['-axo', 'pid=,pgid=,lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const probe = spyOn(childProcess, 'spawnSync').mockImplementation(() => ({
      ...table,
      stdout: groupVisible ? table.stdout : '',
    }));
    try {
      const descendantPid = await tree.descendantPid;
      expect(nativeKill(descendantPid, 0)).toBe(true);
      reap = killChildTreeAndWait(tree.child, tree.closed, {
        reapTimeoutMs: 8000,
      });
      void reap.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await tree.closed;
      await setImmediate();
      expect(tree.child.signalCode).toBe('SIGKILL');
      expect(settled).toBe(false);
      groupVisible = false;
      await reap;
      expect(() => nativeKill(descendantPid, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      );
    } finally {
      groupVisible = false;
      probe.mockRestore();
      await reap;
      await tree.dispose();
    }
  });

  it('fails within the reap budget when the owned group remains visible', async () => {
    const tree = startNativeProcessTree();
    await tree.descendantPid;
    const parentPid = tree.child.pid;
    if (parentPid === undefined) throw new Error('Missing native PID');
    const table = childProcess.spawnSync('ps', ['-axo', 'pid=,pgid=,lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const probe = spyOn(childProcess, 'spawnSync').mockReturnValue(table);
    try {
      await tree.descendantPid;
      await expect(
        killChildTreeAndWait(tree.child, tree.closed, { reapTimeoutMs: 25 }),
      ).rejects.toThrow('did not complete within 25ms');
      await tree.closed;
      expect(tree.child.signalCode).toBe('SIGKILL');
    } finally {
      probe.mockRestore();
      await tree.dispose();
    }
  });

  it('propagates process-group probe permission errors rather than treating them as absence', async () => {
    const tree = startNativeProcessTree();
    await tree.descendantPid;
    const parentPid = tree.child.pid;
    if (parentPid === undefined) throw new Error('Missing native PID');
    const denied = Object.assign(new Error('process visibility denied'), {
      code: 'EPERM',
    });
    const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: denied,
    });
    try {
      await tree.descendantPid;
      await expect(
        killChildTreeAndWait(tree.child, tree.closed, { reapTimeoutMs: 8000 }),
      ).rejects.toBe(denied);
    } finally {
      probe.mockRestore();
      await tree.dispose();
    }
  });

  it('joins real native descendants without substituting process observations', async () => {
    await withTerminatedNativeProcessTree((child, descendantPid) => {
      if (child.pid === undefined) throw new Error('Missing native PID');
      for (const pid of [child.pid, descendantPid]) {
        expect(() => process.kill(pid, 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        );
      }
      expect(child.signalCode).toBe('SIGKILL');
    });
  });

  it('accepts an already-absent native process group', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], {
      detached: true,
      stdio: 'ignore',
    });
    const closed = observeChildClose(child);
    await closed;
    await killChildTreeAndWait(child, closed, { reapTimeoutMs: 8000 });
    expect(child.exitCode).toBe(7);
    expect(child.signalCode).toBeNull();
  });

  it('still requires direct-child close even when the group is absent', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      detached: true,
      stdio: 'ignore',
    });
    await observeChildClose(child);
    await expect(
      killChildTreeAndWait(child, new Promise<void>(() => {}), {
        reapTimeoutMs: 25,
      }),
    ).rejects.toThrow('did not complete within 25ms');
  });

  it('rejects a missing process identity before signalling', async () => {
    await expect(
      killChildTreeAndWait(new ChildProcess(), Promise.resolve()),
    ).rejects.toThrow('Cannot reap test process without a PID');
  });
});
