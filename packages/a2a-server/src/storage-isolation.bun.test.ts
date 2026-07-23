/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: the Bun preload must isolate Storage roots
 * BEFORE any test module imports Storage, so `bun test` never writes into the
 * real user config/data/cache/log directories.
 *
 * This test asserts that every canonical Storage root resolves to a path under
 * the OS temp directory (the isolation temp root), proving the preload ran
 * before this module's import of Storage. It uses the REAL Storage singleton —
 * no mocks.
 */

import { describe, it, expect } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-storage';

const TMP = os.tmpdir();

function isUnderTemp(p: string): boolean {
  const resolved = path.resolve(p);
  const resolvedTmp = path.resolve(TMP);
  return (
    resolved === resolvedTmp || resolved.startsWith(resolvedTmp + path.sep)
  );
}

describe('Bun preload Storage isolation', () => {
  it('all canonical Storage roots resolve under the OS temp directory', () => {
    const roots = {
      config: Storage.getGlobalConfigDir(),
      data: Storage.getGlobalDataDir(),
      cache: Storage.getGlobalCacheDir(),
      log: Storage.getGlobalLogDir(),
    };
    for (const [label, dir] of Object.entries(roots)) {
      expect(
        isUnderTemp(dir),
        `${label} dir ${dir} is not under temp ${TMP}`,
      ).toBe(true);
    }
  });

  it('the isolation marker env var is set', () => {
    expect(process.env['LLXPRT_TEST_STORAGE_ISOLATED']).toBe('1');
  });

  it('user extensions dir resolves under the isolated data root', () => {
    const extDir = Storage.getUserExtensionsDir();
    expect(isUnderTemp(extDir)).toBe(true);
  });

  it('OAuth locks dir resolves under the isolated log root', () => {
    const lockDir = Storage.getOAuthLocksDir();
    expect(isUnderTemp(lockDir)).toBe(true);
  });

  it('global settings path resolves under the isolated config root', () => {
    const settingsPath = Storage.getGlobalSettingsPath();
    expect(isUnderTemp(path.dirname(settingsPath))).toBe(true);
  });
});
