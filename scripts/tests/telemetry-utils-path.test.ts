/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2606 finding 6: telemetry_utils.js must use
 * the SINGLE shared path-resolution authority, not a duplicate local
 * algorithm.
 *
 * The contract: `OTEL_DIR` resolves the canonical log/state directory with
 * the same override precedence as the central Storage contract:
 * LLXPRT_LOG_HOME -> LLXPRT_CONFIG_HOME -> platform default. All overrides
 * must be absolute (padded/blank/relative are ignored).
 *
 * Because OTEL_DIR is computed at module-load time from process.env, each
 * test spawns a fresh node process with a controlled environment and asserts
 * the printed OTEL_DIR. No network calls are made.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import envPaths from 'env-paths';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'telemetry_utils.js');

const PLATFORM_LOG = envPaths('llxprt-code', { suffix: '' }).log;

/**
 * Spawns a node process that imports telemetry_utils.js and prints OTEL_DIR.
 * The env is controlled so no real user directories are involved.
 */
function resolveOtelDir(
  envOverrides: Record<string, string | undefined>,
): string {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Clear all LLXPRT overrides by default; caller sets the ones it wants.
    LLXPRT_LOG_HOME: undefined,
    LLXPRT_CONFIG_HOME: undefined,
    LLXPRT_DATA_HOME: undefined,
    LLXPRT_CACHE_HOME: undefined,
    ...envOverrides,
  };
  // Remove undefined entries so they are truly unset.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete env[k];
    }
  }

  // The snippet imports the module and prints its OTEL_DIR export.
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      '--input-type=module',
      '-e',
      `import('${MODULE_PATH}').then(m => process.stdout.write(m.OTEL_DIR))`,
    ],
    { encoding: 'utf8', env, timeout: 30_000 },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve OTEL_DIR: stderr=${result.stderr}, status=${result.status}`,
    );
  }
  return result.stdout.trim();
}

describe('telemetry_utils.js path resolution (#2606 finding 6)', () => {
  it('honors LLXPRT_LOG_HOME when set to an absolute path', () => {
    const logHome = path.join(os.tmpdir(), 'llx-log-override');
    const otelDir = resolveOtelDir({ LLXPRT_LOG_HOME: logHome });
    expect(otelDir.startsWith(logHome)).toBe(true);
    expect(otelDir).toContain('tmp');
    expect(otelDir).toContain('otel');
  });

  it('falls back to LLXPRT_CONFIG_HOME when LLXPRT_LOG_HOME is unset', () => {
    const cfgHome = path.join(os.tmpdir(), 'llx-cfg-override');
    const otelDir = resolveOtelDir({ LLXPRT_CONFIG_HOME: cfgHome });
    expect(otelDir.startsWith(cfgHome)).toBe(true);
  });

  it('uses the platform default when no override is set', () => {
    const otelDir = resolveOtelDir({});
    expect(otelDir.startsWith(PLATFORM_LOG)).toBe(true);
  });

  it('ignores a blank LLXPRT_LOG_HOME and falls back to CONFIG_HOME', () => {
    const cfgHome = path.join(os.tmpdir(), 'llx-cfg-blank-log');
    const otelDir = resolveOtelDir({
      LLXPRT_LOG_HOME: '   ',
      LLXPRT_CONFIG_HOME: cfgHome,
    });
    expect(otelDir.startsWith(cfgHome)).toBe(true);
  });

  it('ignores a relative LLXPRT_LOG_HOME and falls back to CONFIG_HOME', () => {
    const cfgHome = path.join(os.tmpdir(), 'llx-cfg-rel-log');
    const otelDir = resolveOtelDir({
      LLXPRT_LOG_HOME: 'relative/log/dir',
      LLXPRT_CONFIG_HOME: cfgHome,
    });
    expect(otelDir.startsWith(cfgHome)).toBe(true);
  });

  it('LLXPRT_LOG_HOME wins over LLXPRT_CONFIG_HOME', () => {
    const logHome = path.join(os.tmpdir(), 'log-wins');
    const cfgHome = path.join(os.tmpdir(), 'cfg-loses');
    const otelDir = resolveOtelDir({
      LLXPRT_LOG_HOME: logHome,
      LLXPRT_CONFIG_HOME: cfgHome,
    });
    expect(otelDir.startsWith(logHome)).toBe(true);
    expect(otelDir.startsWith(cfgHome)).toBe(false);
  });
});
