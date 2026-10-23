/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  suppressBackupRestorePrivileges,
  system32Tool,
} from './windows-filesystem-denial.js';

const IS_WINDOWS = process.platform === 'win32';

/** Backup/restore privileges that `whoami /priv` lists as Enabled. */
function enabledBypassPrivileges(): string[] {
  const listing = execFileSync(system32Tool('whoami.exe'), ['/priv'], {
    encoding: 'utf8',
  });
  return listing
    .split('\n')
    .filter((line) => /^Se(Backup|Restore)Privilege\s/.test(line))
    .filter((line) => /\sEnabled\s*$/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

describe('suppressBackupRestorePrivileges', () => {
  it.skipIf(IS_WINDOWS)('refuses to run off Windows', () => {
    expect(() => suppressBackupRestorePrivileges()).toThrow(/win32/);
  });

  it.skipIf(!IS_WINDOWS)(
    'turns the bypass privileges off, then restores the previous state',
    () => {
      const before = enabledBypassPrivileges();

      const suppression = suppressBackupRestorePrivileges();
      let during: string[];
      try {
        during = enabledBypassPrivileges();
      } finally {
        suppression.restore();
      }

      expect([...suppression.previouslyEnabled].sort()).toStrictEqual(
        [...before].sort(),
      );
      expect(during).toStrictEqual([]);
      expect([...enabledBypassPrivileges()].sort()).toStrictEqual(
        [...before].sort(),
      );
    },
  );
});
