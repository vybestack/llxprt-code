/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  spyOn,
} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reportError } from './errorReporting.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;
const FIXED_TIME = new Date('2026-11-13T12:00:00.123Z');
const FIXED_REPORT_NAME = (type: string): string =>
  `llxprt-client-error-${type}-2026-11-13T12-00-00-123Z.json`;

describe('reportError file permissions', () => {
  let testDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-report-perms-'));
    setSystemTime(FIXED_TIME);
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    setSystemTime();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  posixOnly('creates the report readable only by its owner', async () => {
    await reportError(
      new Error('perm boom'),
      'perm base',
      { request: 'sensitive' },
      'perm-owner',
      testDir,
    );

    const report = path.join(testDir, FIXED_REPORT_NAME('perm-owner'));
    expect((await fs.stat(report)).mode & 0o077).toBe(0);
    expect(await fs.readFile(report, 'utf-8')).toContain('perm boom');
  });

  posixOnly(
    'does not write through a symlink planted at the predictable report path',
    async () => {
      const victim = path.join(testDir, 'victim.txt');
      await fs.writeFile(victim, 'precious');
      await fs.symlink(
        victim,
        path.join(testDir, FIXED_REPORT_NAME('perm-link')),
      );

      await reportError(
        new Error('link boom'),
        'link base',
        undefined,
        'perm-link',
        testDir,
      );

      expect(await fs.readFile(victim, 'utf-8')).toBe('precious');
    },
  );

  posixOnly(
    'does not truncate a file another process created at the report path',
    async () => {
      const existing = path.join(testDir, FIXED_REPORT_NAME('perm-existing'));
      await fs.writeFile(existing, 'planted');

      await reportError(
        new Error('existing boom'),
        'existing base',
        undefined,
        'perm-existing',
        testDir,
      );

      expect(await fs.readFile(existing, 'utf-8')).toBe('planted');
    },
  );
});
