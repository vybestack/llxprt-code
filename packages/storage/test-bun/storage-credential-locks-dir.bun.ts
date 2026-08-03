/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coverage for `Storage.getCredentialLocksDir()`, the lock-root helper added
 * for the per-item credential write lock.
 *
 * These live here rather than in `src/config/storage.test.ts` because that
 * suite mocks `fs` through Vitest's module mocking, which has no direct
 * bun:test equivalent. The assertions below are pure path resolution and need
 * no module mocking, so they run natively under Bun.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '../src/config/storage.js';

const ENV_KEYS = [
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

const CONFIG_OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-locks-config-home');
const LOG_OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-locks-log-home');

/**
 * Returns the expected path segment for the current platform, avoiding
 * nested ternary expressions that trigger sonarjs/no-nested-conditional.
 */
function platformSegment(darwin: string, win32: string, linux: string): string {
  const platform = os.platform();
  if (platform === 'darwin') return darwin;
  if (platform === 'win32') return win32;
  return linux;
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

describe('Storage.getCredentialLocksDir — explicit overrides', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = CONFIG_OVERRIDE_DIR;
    process.env['LLXPRT_LOG_HOME'] = LOG_OVERRIDE_DIR;
  });

  afterEach(restoreEnv);

  it('returns <logDir>/secure-store/locks', () => {
    expect(Storage.getCredentialLocksDir()).toBe(
      path.join(LOG_OVERRIDE_DIR, 'secure-store', 'locks'),
    );
  });

  it('falls back to LLXPRT_CONFIG_HOME for compat', () => {
    delete process.env['LLXPRT_LOG_HOME'];
    expect(Storage.getCredentialLocksDir()).toBe(
      path.join(CONFIG_OVERRIDE_DIR, 'secure-store', 'locks'),
    );
  });
});

describe('Storage.getCredentialLocksDir — default platform path', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(restoreEnv);

  it('resolves under the platform log dir by default', () => {
    const result = Storage.getCredentialLocksDir();
    expect(result).toContain('secure-store');
    expect(result).toContain('locks');
    expect(result).toContain(platformSegment('Logs', 'Log', 'state'));
  });
});
