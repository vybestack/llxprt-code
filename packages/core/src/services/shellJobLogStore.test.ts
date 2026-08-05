/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ShellJobLogStore } from './shellJobLogStore.js';

describe('ShellJobLogStore — openLogPaths', () => {
  let baseDir: string;
  let store: ShellJobLogStore;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstore-test-'));
    store = new ShellJobLogStore(baseDir);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('creates both log and error log files', () => {
    const { logPath, errLogPath } = store.openLogPaths('job-1');
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(errLogPath)).toBe(true);
    expect(logPath).not.toBe(errLogPath);
  });

  it.each(['job-2.log', 'job-2.err.log'])(
    'cleans up every file created before the second open throws (pre-existing: %s)',
    (preExistingName) => {
      const dir = store.ensureDir();
      const preExistingPath = path.join(dir, preExistingName);

      // Pre-create the named file so whichever openSync('wx') encounters it
      // first throws EEXIST, exercising the cleanup contract regardless of
      // which file openLogPaths creates first.
      fs.writeFileSync(preExistingPath, '', { mode: 0o600 });

      let caught: unknown;
      try {
        store.openLogPaths('job-2');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).toHaveProperty('code', 'EEXIST');

      // The contract: every file created by openLogPaths before the exception
      // is cleaned up. Only the pre-created file remains.
      const remaining = fs.readdirSync(dir);
      expect(remaining).toStrictEqual([preExistingName]);
    },
  );
});

describe('ShellJobLogStore — destroy retry narrowing', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstore-destroy-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('removes the directory on destroy', async () => {
    const store = new ShellJobLogStore(baseDir);
    store.openLogPaths('job-a');
    await store.destroy();
    expect(fs.existsSync(baseDir)).toBe(false);
  });

  it('is idempotent', async () => {
    const store = new ShellJobLogStore(baseDir);
    await store.destroy();
    await store.destroy();
    expect(fs.existsSync(baseDir)).toBe(false);
  });
});
