/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import { TestRig } from './test-rig.js';

describe('TestRig setup and cleanup behavior', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    restoreEnv();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'test-rig-behavior-'));
    tempDirs.push(root);
    setEnv('INTEGRATION_TEST_FILE_DIR', root);
    return root;
  }

  it('preserves fake responses when setup is called again with settings only', () => {
    const root = createRoot();
    const fakeResponsesPath = join(root, 'responses.json');
    writeFileSync(fakeResponsesPath, '[]');
    const rig = new TestRig();

    rig.setup('repeated setup', { fakeResponsesPath });
    const firstCopiedPath = rig.fakeResponsesPath;

    rig.setup('repeated setup', { settings: { debug: true } });

    expect(rig.fakeResponsesPath).toBe(firstCopiedPath);
    expect(rig.originalFakeResponsesPath).toBe(fakeResponsesPath);
  });

  it('cleans test directories when KEEP_OUTPUT is unset or empty', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('cleanup empty keep output');
    const testDir = rig.testDir;
    setEnv('KEEP_OUTPUT', '');

    await rig.cleanup();

    expect(testDir).not.toBeNull();
    expect(existsSync(testDir as string)).toBe(false);
  });

  it('keeps test directories when KEEP_OUTPUT is truthy', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('cleanup truthy keep output');
    const testDir = rig.testDir;
    setEnv('KEEP_OUTPUT', '1');

    await rig.cleanup();

    expect(testDir).not.toBeNull();
    expect(existsSync(testDir as string)).toBe(true);
  });

  it('rejects overlapping run operations on one rig', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('overlapping runs');

    const firstRun = rig.runCommand(['--version']);
    const secondRun = rig.runCommand(['--version']);

    try {
      await secondRun;
      throw new Error('Expected the overlapping run to reject');
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(`Expected Error, received ${String(error)}`);
      }
      expect(error.message).toMatch(/overlapping run operations/);
    }

    await firstRun;
  });
});
