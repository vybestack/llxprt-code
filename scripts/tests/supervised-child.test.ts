/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { superviseChild } from '../utils/supervised-child.ts';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('superviseChild', () => {
  it('terminates and joins a running child before stop resolves', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    );
    const supervised = superviseChild(child);
    const { pid } = child;
    if (pid === undefined) throw new Error('Fixture child failed to spawn');
    expect(isAlive(pid)).toBe(true);

    await supervised.stop();

    expect(isAlive(pid)).toBe(false);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('resolves without terminating a child that never spawned', async () => {
    const child = spawn('llxprt-supervised-child-missing-executable', [], {
      stdio: 'ignore',
    });
    const supervised = superviseChild(child);
    let killed = false;
    child.kill = (): boolean => {
      killed = true;
      throw new Error('kill must not be called for an unspawned child');
    };

    await supervised.stop();

    expect(child.pid).toBeUndefined();
    expect(killed).toBe(false);
  });

  it('resolves for a child that already exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const supervised = superviseChild(child);
    await new Promise<void>((resolve) => child.once('close', () => resolve()));

    await supervised.stop();

    expect(child.exitCode).toBe(0);
  });

  it('can be stopped twice', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    );
    const supervised = superviseChild(child);

    await supervised.stop();
    await supervised.stop();

    expect(child.signalCode ?? child.exitCode).not.toBeNull();
  });

  it('reports a failed termination of a spawned child', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    );
    const supervised = superviseChild(child);
    const realKill = child.kill.bind(child);
    child.kill = (): boolean => {
      throw new Error('fixture kill failure');
    };

    await expect(supervised.stop()).rejects.toThrow('fixture kill failure');

    child.kill = realKill;
    await superviseChild(child).stop();
  });
});
