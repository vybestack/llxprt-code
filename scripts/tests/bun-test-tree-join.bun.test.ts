/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { ChildProcess, spawn } from 'node:child_process';
import * as nativeChildProcess from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import {
  killChildTreeAndWait,
  observeChildClose,
} from '../lib/bun-test-retry.js';
import {
  startNativeProcessTree,
  withTerminatedNativeProcessTree,
} from './native-process-tree-fixture.js';

const childProcess: {
  spawnSync: (
    command: string,
    args: readonly string[],
    options: nativeChildProcess.SpawnSyncOptionsWithStringEncoding,
  ) => nativeChildProcess.SpawnSyncReturns<string>;
} = nativeChildProcess;

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

describe.skipIf(process.platform === 'win32')(
  'owned observation deadline',
  () => {
    describe.each(['initial', 'post-close'])('%s query', (phase) => {
      it(`classifies ${phase} ps timeout with its native cause and no partial-output success`, async () => {
        const tree = startNativeProcessTree();
        const descendantPid = await tree.descendantPid;
        const table = childProcess.spawnSync(
          'ps',
          ['-axo', 'pid=,pgid=,lstart='],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const nativeTimeout = Object.assign(
          new Error('spawnSync ps ETIMEDOUT'),
          {
            code: 'ETIMEDOUT',
          },
        );
        const clock = spyOn(performance, 'now').mockReturnValue(0);
        let initial = true;
        const probe = spyOn(childProcess, 'spawnSync').mockImplementation(
          () => {
            if (initial && phase === 'post-close') {
              initial = false;
              return table;
            }
            clock.mockReturnValue(25);
            return { ...table, stdout: '', error: nativeTimeout, status: null };
          },
        );
        try {
          const error = await killChildTreeAndWait(tree.child, tree.closed, {
            reapTimeoutMs: 25,
          }).catch((failure: unknown) => failure);
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error)) throw new Error('Missing reap error');
          expect(error.message).toContain('did not complete within 25ms');
          expect(error.cause).toBe(nativeTimeout);
          if (phase === 'initial') {
            expect(tree.child.signalCode).toBeNull();
            expect(process.kill(descendantPid, 0)).toBe(true);
            if (tree.child.pid === undefined)
              throw new Error('Missing native PID');
            expect(process.kill(tree.child.pid, 0)).toBe(true);
          } else {
            await tree.closed;
            expect(tree.child.signalCode).toBe('SIGKILL');
            if (tree.child.pid === undefined)
              throw new Error('Missing native PID');
            for (const pid of [tree.child.pid, descendantPid]) {
              expect(() => process.kill(pid, 0)).toThrow(
                expect.objectContaining({ code: 'ESRCH' }),
              );
            }
          }
        } finally {
          probe.mockRestore();
          clock.mockRestore();
          await tree.dispose();
        }
      });

      it.each(['EPERM', 'ENOENT'])(
        `preserves ${phase} %s identity even after the deadline`,
        async (code) => {
          const tree = startNativeProcessTree();
          const descendantPid = await tree.descendantPid;
          const table = childProcess.spawnSync(
            'ps',
            ['-axo', 'pid=,pgid=,lstart='],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          const nativeError = Object.assign(new Error(`ps ${code}`), { code });
          const clock = spyOn(performance, 'now').mockReturnValue(0);
          let initial = true;
          const probe = spyOn(childProcess, 'spawnSync').mockImplementation(
            () => {
              if (initial && phase === 'post-close') {
                initial = false;
                return table;
              }
              clock.mockReturnValue(26);
              return { ...table, error: nativeError, status: null };
            },
          );
          try {
            await expect(
              killChildTreeAndWait(tree.child, tree.closed, {
                reapTimeoutMs: 25,
              }),
            ).rejects.toBe(nativeError);
            if (phase === 'initial') {
              expect(tree.child.signalCode).toBeNull();
              expect(process.kill(descendantPid, 0)).toBe(true);
            } else {
              await tree.closed;
              expect(tree.child.signalCode).toBe('SIGKILL');
              expect(() => process.kill(descendantPid, 0)).toThrow(
                expect.objectContaining({ code: 'ESRCH' }),
              );
            }
          } finally {
            probe.mockRestore();
            clock.mockRestore();
            await tree.dispose();
          }
        },
      );
    });

    it('spends one original budget across the initial and post-close queries', async () => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        detached: true,
        stdio: 'ignore',
      });
      const closed = observeChildClose(child);
      await closed;
      const table = childProcess.spawnSync(
        'ps',
        ['-axo', 'pid=,pgid=,lstart='],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const clock = spyOn(performance, 'now')
        .mockReturnValue(6)
        .mockReturnValueOnce(1);
      const budgets: Array<number | undefined> = [];
      const probe = spyOn(childProcess, 'spawnSync').mockImplementation(
        (_command, _args, options) => {
          budgets.push(options?.timeout);
          clock.mockReturnValue(11);
          return { ...table, stdout: '' };
        },
      );
      try {
        await killChildTreeAndWait(child, closed, { reapTimeoutMs: 25 });
        expect(budgets).toEqual([20, 15]);
        expect(child.exitCode).toBe(0);
        expect(child.signalCode).toBeNull();
      } finally {
        probe.mockRestore();
        clock.mockRestore();
      }
    });

    it.each(['initial', 'post-close'])(
      'does not start a %s query after the original budget expires',
      async (phase) => {
        const tree = startNativeProcessTree();
        const descendantPid = await tree.descendantPid;
        const table = childProcess.spawnSync(
          'ps',
          ['-axo', 'pid=,pgid=,lstart='],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const clock = spyOn(performance, 'now').mockReturnValue(0);
        if (phase === 'initial') {
          clock.mockReturnValue(25).mockReturnValueOnce(0);
        }
        const closed = tree.closed.then(() => {
          clock.mockReturnValue(25);
        });
        const forbiddenQuery = Object.assign(
          new Error('query outside budget'),
          {
            code: 'ENOENT',
          },
        );
        let initial = true;
        const probe = spyOn(childProcess, 'spawnSync').mockImplementation(
          () => {
            if (initial && phase === 'post-close') {
              initial = false;
              return table;
            }
            return { ...table, error: forbiddenQuery, status: null };
          },
        );
        try {
          const error = await killChildTreeAndWait(tree.child, closed, {
            reapTimeoutMs: 25,
          }).catch((failure: unknown) => failure);
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error)) throw new Error('Missing reap error');
          expect(error.message).toContain('did not complete within 25ms');
          expect(error.cause).toBeUndefined();
          if (phase === 'initial') {
            expect(tree.child.signalCode).toBeNull();
            expect(process.kill(descendantPid, 0)).toBe(true);
          } else {
            await tree.closed;
            expect(tree.child.signalCode).toBe('SIGKILL');
          }
        } finally {
          probe.mockRestore();
          clock.mockRestore();
          await tree.dispose();
        }
      },
    );

    it('preserves a pending close promise timeout as its original error', async () => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        detached: true,
        stdio: 'ignore',
      });
      await observeChildClose(child);
      const close = Promise.withResolvers<void>();
      const nativeError = Object.assign(new Error('close ETIMEDOUT'), {
        code: 'ETIMEDOUT',
      });
      const table = childProcess.spawnSync(
        'ps',
        ['-axo', 'pid=,pgid=,lstart='],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const clock = spyOn(performance, 'now').mockReturnValue(0);
      const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({
        ...table,
        stdout: '',
      });
      try {
        const reap = killChildTreeAndWait(child, close.promise, {
          reapTimeoutMs: 25,
        });
        const failure = reap.catch((error: unknown) => error);
        await Promise.resolve();
        close.reject(nativeError);
        expect(await failure).toBe(nativeError);
      } finally {
        probe.mockRestore();
        clock.mockRestore();
      }
    });

    it('waits for direct close after a successful absent-group snapshot', async () => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        detached: true,
        stdio: 'ignore',
      });
      await observeChildClose(child);
      const close = Promise.withResolvers<void>();
      const table = childProcess.spawnSync(
        'ps',
        ['-axo', 'pid=,pgid=,lstart='],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const clock = spyOn(performance, 'now').mockReturnValue(0);
      const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({
        ...table,
        stdout: '',
      });
      let settled = false;
      try {
        const reap = killChildTreeAndWait(child, close.promise, {
          reapTimeoutMs: 25,
        });
        void reap.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        close.resolve();
        await reap;
        expect(settled).toBe(true);
      } finally {
        close.resolve();
        probe.mockRestore();
        clock.mockRestore();
      }
    });

    it('reaches the direct-close deadline after a successful absent snapshot', async () => {
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        detached: true,
        stdio: 'ignore',
      });
      await observeChildClose(child);
      const table = childProcess.spawnSync(
        'ps',
        ['-axo', 'pid=,pgid=,lstart='],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const clock = spyOn(performance, 'now').mockReturnValue(0);
      const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({
        ...table,
        stdout: '',
      });
      let settled = false;
      try {
        const reap = killChildTreeAndWait(child, new Promise<void>(() => {}), {
          reapTimeoutMs: 25,
        });
        void reap.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        const failure = reap.catch((error: unknown) => error);
        await Promise.resolve();
        expect(settled).toBe(false);
        const error = await failure;
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error))
          throw new Error('Missing close deadline');
        expect(error.message).toContain('did not complete within 25ms');
        expect(settled).toBe(true);
      } finally {
        probe.mockRestore();
        clock.mockRestore();
      }
    });
  },
);
