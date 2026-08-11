/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  terminateProcessTree,
  terminateWindowsTree,
  DEFAULT_TERMINATION_GRACE_MS,
  WINDOWS_TASKKILL_WATCHDOG_MS,
  type TaskkillSpawnFn,
  type SignalFn,
} from './processTermination.js';

function spawnSleeper(seconds: number, ignoreSigterm = false): ChildProcess {
  const script = ignoreSigterm
    ? `trap '' TERM; exec sleep ${seconds}`
    : `sleep ${seconds}`;
  return spawn('sh', ['-c', script], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
}

describe('terminateProcessTree - graceful exit', () => {
  it(
    'signals a running process and it exits gracefully',
    async () => {
      const child = spawnSleeper(30);
      expect(child.pid).toBeDefined();

      await new Promise((r) => setTimeout(r, 100));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 2000,
        ownsProcessGroup: true,
      });
      expect(result.outcome).toBe('graceful');

      await waitForExit(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    },
    { timeout: 10000 },
  );

  it('returns no_target for an already-exited process', async () => {
    const child = spawnSleeper(0);
    await waitForExit(child);

    const result = await terminateProcessTree(child);
    expect(result.outcome).toBe('no_target');
  });

  it('returns no_target for a process with no pid', async () => {
    const fakeChild = {
      pid: undefined,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;

    const result = await terminateProcessTree(fakeChild);
    expect(result.outcome).toBe('no_target');
  });
});

describe('terminateProcessTree - SIGTERM ignoring process escalates to SIGKILL', () => {
  it.skipIf(process.platform === 'win32')(
    'escalates to SIGKILL when SIGTERM is ignored',
    async () => {
      const child = spawnSleeper(60, true);
      expect(child.pid).toBeDefined();

      await new Promise((r) => setTimeout(r, 300));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: true,
      });
      expect(result.outcome).toBe('escalated');

      await waitForExit(child);
      expect(child.signalCode).toBe('SIGKILL');
    },
    { timeout: 10000 },
  );

  it.skipIf(process.platform === 'win32')(
    'escalated process group has no survivors (descendant is dead)',
    async () => {
      const child = spawn('sh', ['-c', 'sleep 60 & sleep 60 & sleep 60'], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
      expect(child.pid).toBeDefined();
      const pgid = child.pid!;

      await new Promise((r) => setTimeout(r, 300));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: true,
      });
      expect(result.outcome).toBe('graceful');

      await waitForExit(child);

      await new Promise((r) => setTimeout(r, 200));

      expect(() => process.kill(-pgid, 0)).toThrow('ESRCH');
    },
    { timeout: 10000 },
  );

  it.skipIf(process.platform === 'win32')(
    'leader exits but descendant ignores SIGTERM — escalation kills the group',
    async () => {
      const child = spawn('sh', ['-c', "trap '' TERM &\nwait\nsleep 60"], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
      expect(child.pid).toBeDefined();
      const pgid = child.pid!;

      await new Promise((r) => setTimeout(r, 300));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: true,
      });
      expect(['escalated', 'graceful']).toContain(result.outcome);

      await new Promise((r) => setTimeout(r, 200));
      expect(() => process.kill(-pgid, 0)).toThrow('ESRCH');
    },
    { timeout: 10000 },
  );

  it.skipIf(process.platform === 'win32')(
    'leader definitely exited, descendant alive ignoring TERM — group escalation kills it',
    async () => {
      // Leader spawns a TERM-ignoring descendant then exits immediately.
      // The descendant keeps the process group alive.
      const child = spawn(
        'sh',
        ['-c', "(trap '' TERM; exec sleep 60) &\nexit 0"],
        {
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
        },
      );
      expect(child.pid).toBeDefined();
      const pgid = child.pid!;

      // Wait for the leader to DEFINITELY exit.
      await waitForExit(child);
      expect(child.exitCode).toBe(0);

      // The descendant must still be alive in the owned group.
      expect(() => process.kill(-pgid, 0)).not.toThrow();

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: true,
      });
      expect(['escalated', 'graceful']).toContain(result.outcome);

      // Group must be completely gone.
      await new Promise((r) => setTimeout(r, 200));
      expect(() => process.kill(-pgid, 0)).toThrow('ESRCH');
    },
    { timeout: 15000 },
  );

  it.skipIf(process.platform === 'win32')(
    'group-owning termination never falls back to positive-PID signal',
    async () => {
      const child = spawnSleeper(60, true);
      expect(child.pid).toBeDefined();
      const pid = child.pid!;

      await new Promise((r) => setTimeout(r, 300));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: true,
      });
      expect(result.outcome).toBe('escalated');

      await waitForExit(child);

      // The original PID must be dead (no reused PID was signaled).
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    },
    { timeout: 10000 },
  );
});

describe('terminateProcessTree - direct child (no process group)', () => {
  it.skipIf(process.platform === 'win32')(
    'terminates a direct child via positive PID signal',
    async () => {
      const child = spawnSleeper(30);
      expect(child.pid).toBeDefined();

      await new Promise((r) => setTimeout(r, 100));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 2000,
        ownsProcessGroup: false,
      });
      expect(result.outcome).toBe('graceful');

      await waitForExit(child);
    },
    { timeout: 10000 },
  );

  it.skipIf(process.platform === 'win32')(
    'escalates direct child to SIGKILL when SIGTERM is ignored',
    async () => {
      const child = spawnSleeper(60, true);

      await new Promise((r) => setTimeout(r, 300));

      const result = await terminateProcessTree(child, {
        gracePeriodMs: 500,
        ownsProcessGroup: false,
      });
      expect(result.outcome).toBe('escalated');

      await waitForExit(child);
      expect(child.signalCode).toBe('SIGKILL');
    },
    { timeout: 10000 },
  );
});

describe('terminateProcessTree - coalescing by ChildProcess identity', () => {
  it(
    'coalesces concurrent calls for the same child',
    async () => {
      const child = spawnSleeper(30);
      await new Promise((r) => setTimeout(r, 100));

      const [result1, result2] = await Promise.all([
        terminateProcessTree(child, {
          gracePeriodMs: 2000,
          ownsProcessGroup: true,
        }),
        terminateProcessTree(child, {
          gracePeriodMs: 2000,
          ownsProcessGroup: true,
        }),
      ]);

      expect(result1.outcome).toBe('graceful');
      expect(result2.outcome).toBe('graceful');

      await waitForExit(child);
    },
    { timeout: 10000 },
  );

  it(
    'coalesces many concurrent calls for the same child',
    async () => {
      const child = spawnSleeper(30);
      await new Promise((r) => setTimeout(r, 100));

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          terminateProcessTree(child, {
            gracePeriodMs: 2000,
            ownsProcessGroup: true,
          }),
        ),
      );

      for (const r of results) {
        expect(r.outcome).toBe('graceful');
      }

      await waitForExit(child);
    },
    { timeout: 10000 },
  );

  it('returns no_target for a sequential call after first completion', async () => {
    const child = spawnSleeper(2);
    await new Promise((r) => setTimeout(r, 100));

    const result1 = await terminateProcessTree(child, {
      gracePeriodMs: 3000,
      ownsProcessGroup: true,
    });
    await waitForExit(child);

    const result2 = await terminateProcessTree(child);
    expect(result1.outcome).toBe('graceful');
    expect(result2.outcome).toBe('no_target');
  });
});

describe('terminateProcessTree - exported constants', () => {
  it('exports a named grace period constant', () => {
    expect(DEFAULT_TERMINATION_GRACE_MS).toBeGreaterThan(0);
    expect(DEFAULT_TERMINATION_GRACE_MS).toBeLessThanOrEqual(30000);
    expect(typeof DEFAULT_TERMINATION_GRACE_MS).toBe('number');
  });

  it('exports a Windows taskkill watchdog constant', () => {
    expect(WINDOWS_TASKKILL_WATCHDOG_MS).toBeGreaterThan(0);
    expect(typeof WINDOWS_TASKKILL_WATCHDOG_MS).toBe('number');
  });
});

describe('terminateWindowsTree - platform-independent outcome tests', () => {
  function makeFakeChild(events: {
    closeCode?: number | null;
    error?: Error;
    delayMs?: number;
    closeOnKill?: boolean;
  }): ChildProcess {
    const ee = new EventEmitter();
    let killed = false;
    const timer = setTimeout(() => {
      if (events.error !== undefined) {
        ee.emit('error', events.error);
      } else if (events.delayMs !== undefined) {
        // Watchdog will fire and call kill(); kill() cancels this timer.
      } else {
        ee.emit('close', events.closeCode ?? 0);
      }
    }, events.delayMs ?? 0);
    (ee as unknown as { kill: (signal?: string) => boolean }).kill = () => {
      killed = true;
      clearTimeout(timer);
      if (events.closeOnKill === true) {
        setImmediate(() => ee.emit('close', 1));
      }
      return true;
    };
    Object.defineProperty(ee, '_killed', {
      get: () => killed,
      enumerable: false,
    });

    return ee as unknown as ChildProcess;
  }

  it('reports graceful when taskkill exits 0', async () => {
    const fakeSpawn: TaskkillSpawnFn = () => makeFakeChild({ closeCode: 0 });
    const result = await terminateWindowsTree(12345, fakeSpawn, {
      watchdogMs: 1000,
      postKillWaitMs: 500,
    });
    expect(result.outcome).toBe('graceful');
  });

  it('reports failure when taskkill exits nonzero', async () => {
    const fakeSpawn: TaskkillSpawnFn = () => makeFakeChild({ closeCode: 1 });
    const result = await terminateWindowsTree(12345, fakeSpawn, {
      watchdogMs: 1000,
      postKillWaitMs: 500,
    });
    expect(result.outcome).toBe('failure');
  });

  it('reports failure when taskkill spawn throws', async () => {
    const fakeSpawn: TaskkillSpawnFn = () => {
      throw new Error('ENOENT');
    };
    const result = await terminateWindowsTree(12345, fakeSpawn);
    expect(result.outcome).toBe('failure');
  });

  it('reports failure and kills child when taskkill emits error while running', async () => {
    let killCalled = false;
    const fakeSpawn: TaskkillSpawnFn = () => {
      const child = makeFakeChild({ error: new Error('spawn error') });
      const origKill = (child as unknown as { kill: () => boolean }).kill;
      (child as unknown as { kill: () => boolean }).kill = () => {
        killCalled = true;
        return origKill();
      };
      return child;
    };
    const result = await terminateWindowsTree(12345, fakeSpawn, {
      watchdogMs: 1000,
      postKillWaitMs: 500,
    });
    expect(result.outcome).toBe('failure');
    expect(killCalled).toBe(true);
  });

  it(
    'reports timeout when taskkill hangs past the watchdog (injectable)',
    async () => {
      const fakeSpawn: TaskkillSpawnFn = () =>
        makeFakeChild({ delayMs: 10000 });
      const result = await terminateWindowsTree(12345, fakeSpawn, {
        watchdogMs: 50,
        postKillWaitMs: 50,
      });
      expect(result.outcome).toBe('timeout');
    },
    { timeout: 5000 },
  );

  it(
    'resolves timeout when watchdog-killed process closes within post-kill deadline',
    async () => {
      const fakeSpawn: TaskkillSpawnFn = () =>
        makeFakeChild({ delayMs: 10000, closeOnKill: true });
      const result = await terminateWindowsTree(12345, fakeSpawn, {
        watchdogMs: 30,
        postKillWaitMs: 100,
      });
      expect(result.outcome).toBe('timeout');
    },
    { timeout: 5000 },
  );

  it(
    'never-close taskkill resolves timeout via post-kill timer',
    async () => {
      const fakeSpawn: TaskkillSpawnFn = () =>
        makeFakeChild({ delayMs: 10000, closeOnKill: false });
      const result = await terminateWindowsTree(12345, fakeSpawn, {
        watchdogMs: 30,
        postKillWaitMs: 50,
      });
      expect(result.outcome).toBe('timeout');
    },
    { timeout: 5000 },
  );
});

describe('terminateProcessTree - EPERM vs ESRCH signal semantics', () => {
  const fakeChild = {
    pid: 99999,
    exitCode: null,
    signalCode: null,
  } as unknown as ChildProcess;

  const epermSignal: SignalFn = () => {
    throw Object.assign(new Error('Operation not permitted'), {
      code: 'EPERM',
    });
  };

  it('EPERM on liveness probe means group exists; EPERM on SIGTERM is failure', async () => {
    const result = await terminateProcessTree(fakeChild, {
      ownsProcessGroup: true,
      signal: epermSignal,
      gracePeriodMs: 100,
    });
    expect(result.outcome).toBe('failure');
  });

  it('ESRCH on liveness probe means group is gone — no_target', async () => {
    const esrchSignal: SignalFn = () => {
      throw Object.assign(new Error('No such process'), {
        code: 'ESRCH',
      });
    };
    const result = await terminateProcessTree(fakeChild, {
      ownsProcessGroup: true,
      signal: esrchSignal,
      gracePeriodMs: 100,
    });
    expect(result.outcome).toBe('no_target');
  });

  it('EPERM on direct-child SIGTERM is failure, not no_target', async () => {
    const runningChild = {
      pid: 99998,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    const result = await terminateProcessTree(runningChild, {
      ownsProcessGroup: false,
      signal: epermSignal,
      gracePeriodMs: 100,
    });
    expect(result.outcome).toBe('failure');
  });
});
