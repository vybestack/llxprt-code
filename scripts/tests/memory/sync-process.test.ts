/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSyncWithFileCapture } from './sync-process.ts';

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(20);
    } catch {
      return;
    }
  }
  throw new Error(`Timed out waiting for child process ${pid} to exit`);
}

describe('spawnSyncWithFileCapture', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('creates a missing capture root before allocating files', () => {
    root = mkdtempSync(join(tmpdir(), 'sync-process-root-'));
    const captureRoot = join(root, 'missing', 'nested');

    const result = spawnSyncWithFileCapture(
      captureRoot,
      'node',
      ['-e', 'process.stdout.write("captured")'],
      { cwd: root },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('captured');
  });

  it('applies the timeout to the nested process so it cannot be orphaned', async () => {
    root = mkdtempSync(join(tmpdir(), 'sync-process-timeout-'));
    const pidPath = join(root, 'child.pid');
    const script = [
      'const { writeFileSync } = require("node:fs");',
      'writeFileSync(process.argv[1], String(process.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n');

    const result = spawnSyncWithFileCapture(
      root,
      'node',
      ['-e', script, pidPath],
      { cwd: root, timeout: 500 },
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(pidPath)).toBe(true);
    const pid = Number(readFileSync(pidPath, 'utf8'));
    await waitForProcessExit(pid);
  });
});
