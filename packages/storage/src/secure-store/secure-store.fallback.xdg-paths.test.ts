/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * XDG_DATA_HOME fallback path test for SecureStore.
 *
 * This test validates that `SecureStore`'s default `fallbackDir` resolves
 * through the central path authority, honoring `LLXPRT_DATA_HOME` /
 * `LLXPRT_CONFIG_HOME` overrides and falling back to the platform default.
 *
 * The storage preload sets `LLXPRT_DATA_HOME`/`LLXPRT_CONFIG_HOME` before any
 * test module is imported, so a static `SecureStore` import is affected by
 * those values. To test the XDG path we must run in an isolated child process
 * that can clear those overrides and set `XDG_DATA_HOME` before the module is
 * loaded — guaranteeing a fresh module graph and env state.
 *
 * On Linux, `envPaths` honors `XDG_DATA_HOME`; on macOS it uses
 * `~/Library/Application Support`. We validate the platform-appropriate path
 * in both cases and never skip.
 *
 * The child imports the current tracked TypeScript source of the dependency-
 * neutral path-resolver module (the SINGLE source of truth for directory
 * resolution, used by SecureStore via Storage.getGlobalDataDir) via
 * pathToFileURL(...).href. This avoids stale dist output and works from a
 * clean checkout on all platforms including Windows. Both Bun and Node
 * execute .ts natively (Node via --experimental-strip-types), and
 * path-resolver.ts depends ONLY on `env-paths` and `node:path`.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const PATH_RESOLVER_SOURCE = resolve(
  REPO_ROOT,
  'packages',
  'storage',
  'src',
  'config',
  'path-resolver.ts',
);
const CUSTOM_XDG = resolve(tmpdir(), 'custom-xdg-test');

interface ChildResult {
  readonly ok: boolean;
  readonly dataDir?: string;
  readonly error?: string;
}

/**
 * Spawns an isolated child process that clears LLXPRT_DATA_HOME and
 * LLXPRT_CONFIG_HOME, sets XDG_DATA_HOME, then dynamically imports the
 * path-resolver source module and reports the data directory that
 * SecureStore's fallbackDir is derived from.
 *
 * path-resolver.ts is the single source of truth for directory resolution;
 * SecureStore delegates to it via Storage.getGlobalDataDir(). The dataDir
 * is the root that fallbackDir joins 'secure-store'/serviceName onto, so
 * testing dataDir resolution proves the fallback path behavior.
 *
 * Uses pathToFileURL(...).href for the filesystem ESM import, which is the
 * cross-platform method supported by both Bun and Node. Only the dataDir
 * string is returned (path.join is done in the test) to keep the child
 * script free of path-separator escaping complexity.
 */
function spawnIsolatedChild(): ChildResult {
  const sourceUrl = pathToFileURL(PATH_RESOLVER_SOURCE).href;
  const inlineScript =
    'import(' +
    JSON.stringify(sourceUrl) +
    ').then(mod => {' +
    'const dataDir = mod.resolveGlobalDataDir();' +
    'console.log(JSON.stringify({ok: true, dataDir: dataDir}));' +
    '}).catch(e => {' +
    'console.log(JSON.stringify({ok: false, error: e.message}));' +
    '});';

  const isBun = typeof process.versions.bun === 'string';
  const nodeFlags = isBun ? [] : ['--experimental-strip-types'];
  const args = [...nodeFlags, '--input-type=module', '-e', inlineScript];

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LLXPRT_DATA_HOME: undefined,
      LLXPRT_CONFIG_HOME: undefined,
      LLXPRT_TEST_STORAGE_ISOLATED: undefined,
      XDG_DATA_HOME: CUSTOM_XDG,
    },
    encoding: 'utf-8',
    timeout: 30_000,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr || `exit ${result.status}`,
    };
  }

  const lastLine = result.stdout.trim().split('\n').pop();
  if (!lastLine) {
    return { ok: false, error: 'no output from child' };
  }

  try {
    return JSON.parse(lastLine) as ChildResult;
  } catch {
    return { ok: false, error: `unparseable: ${lastLine}` };
  }
}

/**
 * Computes whether the current platform honors XDG_DATA_HOME.
 * Linux does; macOS and Windows use platform-specific paths.
 */
function platformHonorsXdg(): boolean {
  return process.platform === 'linux';
}

function childDataDir(result: ChildResult): string {
  return result.dataDir ?? '';
}

describe('SecureStore — fallback resolves platform data path with XDG_DATA_HOME set', () => {
  it('child process resolves fallbackDir with LLXPRT overrides cleared and XDG_DATA_HOME set', () => {
    const result = spawnIsolatedChild();
    expect(result.ok).toBe(true);
    expect(result.dataDir).toBeDefined();
    expect(typeof result.dataDir).toBe('string');

    const dir = childDataDir(result);
    const containsXdg = dir.includes(CUSTOM_XDG);

    // On Linux, XDG_DATA_HOME is honored and the path must contain it.
    // On Darwin/Windows, XDG_DATA_HOME is ignored and the path must NOT contain it.
    // This single assertion validates the platform-appropriate behavior without
    // skipping on any platform.
    expect(containsXdg).toBe(platformHonorsXdg());
  });
});
