/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deadline,
  processGone,
  withTerminalFixture,
} from './shell-terminal-test-helper.js';

it.skipIf(process.platform === 'win32')(
  'closes admission and rejects unconfirmed group disposal after supervisor loss',
  async () => {
    await withTerminalFixture(async (manager, launch, _exit, request) => {
      const job = await launch();
      manager.setMaxBackgroundJobs(2);
      const completed = new Promise<void>((resolve) =>
        manager.onJobCompleted(() => resolve()),
      );
      const ordinary = manager.launch({
        command: 'echo ordinary',
        cwd: job.cwd,
      });
      await deadline(completed);
      const ordinaryLog = join(job.cwd, 'logs', `${ordinary.id}.log`);
      expect(existsSync(ordinaryLog)).toBe(true);
      const failed = new Promise<void>((resolve) =>
        manager.onJobFailed(() => resolve()),
      );
      await request('crash-owner');
      await deadline(failed);
      expect(manager.get(job.id)?.signal).toBe('SIGKILL');
      expect(() => manager.launch({ command: 'true', cwd: job.cwd })).toThrow(
        'Cannot launch a background job',
      );
      const disposal = manager.dispose();
      const result = await deadline(
        disposal.then(
          () => undefined,
          (error: unknown) => error,
        ),
      );
      expect(result).toBeInstanceOf(AggregateError);
      if (!(result instanceof AggregateError))
        throw new Error('Expected failed group cleanup');
      expect(String(result.errors[0])).toContain(
        'Cannot confirm shell process group',
      );
      expect(processGone(job.pid)).toBe(false);
      expect(existsSync(job.logPath)).toBe(true);
      const heartbeat = join(job.cwd, `heartbeat-${job.pid}`);
      const before = readFileSync(heartbeat, 'utf8');
      expect(await request('beat')).toBe('0');
      expect(readFileSync(heartbeat, 'utf8')).not.toBe(before);
      expect(manager.dispose()).toBe(disposal);
      expect(existsSync(ordinaryLog)).toBe(false);
      return result;
    });
  },
  30000,
);
