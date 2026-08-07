/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ShellJobManager } from './shellJobManager.js';

describe.skipIf(os.platform() === 'win32')(
  'ShellJobManager terminal ownership races',
  () => {
    it('keeps cancellation as terminal owner when output crosses the cap afterward', async () => {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-job-race-'));
      const manager = new ShellJobManager({ logMaxBytes: 64, baseDir });
      try {
        const job = manager.launch({
          command:
            "trap 'printf %0200d 0; sleep 1; exit 0' TERM; while true; do sleep 1; done",
          cwd: os.tmpdir(),
        });
        await Bun.sleep(200);

        expect(await manager.cancel(job.id)).toBe(true);
        const terminal = manager.get(job.id);
        expect(terminal?.state).toBe('cancelled');
        expect(terminal?.failureReason ?? '').not.toContain('exceeded cap');
      } finally {
        await manager.dispose();
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    });
  },
);
