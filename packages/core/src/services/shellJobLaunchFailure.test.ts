/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellJobManager } from './shellJobManager.js';
import { deadline } from './shell-terminal-test-helper.js';

it.skipIf(process.platform === 'win32')(
  'releases the reservation and log after OS supervisor launch rejection',
  async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'shell-launch-failure-'));
    const manager = new ShellJobManager({ baseDir, maxBackgroundJobs: 1 });
    try {
      expect(() =>
        manager.launch({
          command: `true #${'x'.repeat(2 * 1024 * 1024)}`,
          cwd: baseDir,
        }),
      ).toThrow(/spawn|argument|large|long/i);
      expect(readdirSync(baseDir)).toStrictEqual([]);
      const completed = new Promise<void>((resolve) =>
        manager.onJobCompleted(() => resolve()),
      );
      const job = manager.launch({ command: 'echo recovered', cwd: baseDir });
      await deadline(completed);
      expect(manager.get(job.id)?.exitCode).toBe(0);
      expect(manager.tailOutput(job.id).output).toContain('recovered');
    } finally {
      await deadline(manager.dispose());
      rmSync(baseDir, { recursive: true, force: true });
    }
  },
  30000,
);
