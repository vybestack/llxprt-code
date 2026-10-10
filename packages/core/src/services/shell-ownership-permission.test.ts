/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { SIGKILL_TIMEOUT_MS } from './shellProcessKill.js';
import {
  deadline,
  processGone,
  withTerminalFixture,
} from './shell-terminal-test-helper.js';

it.skipIf(process.platform === 'win32')(
  'retains uncertain logs on EPERM while disposing an independently owned live group',
  async () => {
    await withTerminalFixture(async (manager, launch, _exit, request) => {
      const uncertain = await launch();
      const pgid = manager.get(uncertain.id)?.pid;
      if (pgid === undefined || pgid <= 1)
        throw new Error('Missing supervisor group identity');
      await request('cap');
      const output = readFileSync(uncertain.logPath, 'utf8');
      expect(output.length).toBeGreaterThan(0);
      manager.setMaxBackgroundJobs(2);
      const safe = await launch();
      const safePgid = manager.get(safe.id)?.pid;
      if (safePgid === undefined || safePgid <= 1)
        throw new Error('Missing independent supervisor identity');

      const originalKill = process.kill;
      const permissionError = Object.assign(new Error('probe denied'), {
        code: 'EPERM',
      });
      let denyProbe = true;
      let deniedProbes = 0;
      let groupProbes = 0;
      const forbiddenSignals: Array<string | number | undefined> = [];
      process.kill = (pid, signal): true => {
        if (pid === -pgid || pid === -safePgid) {
          if (signal !== 0) {
            forbiddenSignals.push(signal);
            throw new Error('Refusing a parent-issued numeric group signal');
          }
          groupProbes++;
          if (pid === -pgid && denyProbe) {
            deniedProbes++;
            throw permissionError;
          }
        }
        return originalKill.call(process, pid, signal);
      };
      try {
        const drainFailure = await deadline(
          manager.cancel(uncertain.id).then(
            () => undefined,
            (error: unknown) => error,
          ),
        );
        expect(deniedProbes).toBeGreaterThan(1);
        expect(drainFailure).toBeInstanceOf(Error);
        if (!(drainFailure instanceof Error))
          throw new Error('Expected unconfirmed drain failure');
        expect(drainFailure.message).toContain(
          `Cannot confirm shell process group ${pgid} drained`,
        );
        expect(() =>
          manager.launch({ command: 'true', cwd: uncertain.cwd }),
        ).toThrow('shell supervisor ownership was lost');
        expect(processGone(uncertain.pid)).toBe(true);
        expect(processGone(safe.pid)).toBe(false);
        expect(await request('beat')).toBe('0');
        expect(existsSync(safe.logPath)).toBe(true);

        const disposal = manager.dispose();
        expect(manager.dispose()).toBe(disposal);
        const failure = await deadline(
          disposal.then(
            () => undefined,
            (error: unknown) => error,
          ),
        );
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError))
          throw new Error('Expected disposal to report uncertain ownership');
        expect(failure.errors).toHaveLength(1);
        expect(failure.errors[0]).toBe(drainFailure);
        expect(manager.get(uncertain.id)).toBeDefined();
        expect(readFileSync(uncertain.logPath, 'utf8')).toStartWith(output);
        expect(manager.get(safe.id)).toBeUndefined();
        expect(existsSync(safe.logPath)).toBe(false);
        expect(processGone(safe.pid)).toBe(true);
        expect(processGone(-safePgid)).toBe(true);

        denyProbe = false;
        expect(processGone(-pgid)).toBe(true);
        const probesBeforeRepeat = groupProbes;
        expect(manager.dispose()).toBe(disposal);
        await expect(manager.dispose()).rejects.toBe(failure);
        await new Promise<void>((resolve) =>
          setTimeout(resolve, SIGKILL_TIMEOUT_MS + 50),
        );
        expect(groupProbes).toBe(probesBeforeRepeat);
        expect(forbiddenSignals).toStrictEqual([]);
        expect(existsSync(uncertain.logPath)).toBe(true);
        return failure;
      } finally {
        process.kill = originalKill;
      }
    });
  },
  30000,
);
