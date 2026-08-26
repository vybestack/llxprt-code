/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the test-process config guard (issue #3278).
 *
 * The defect it pins down: an isolated test process that clears
 * `LLXPRT_CONFIG_HOME` drops back to the developer's live configuration
 * directory, and `new ProfileManager()` then writes profiles into it. The guard
 * turns that silent success into an immediate failure.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Storage } from './storage.js';
import {
  LLXPRT_PLATFORM_PATHS,
  resolveGlobalConfigDir,
} from './path-resolver.js';
import { REAL_STORAGE_OPT_IN_ENV } from './assertTestStorageIsolation.js';

const ISOLATION_MARKER_ENV = 'LLXPRT_TEST_STORAGE_ISOLATED';

const MANAGED_ENV_KEYS = [
  ISOLATION_MARKER_ENV,
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
  REAL_STORAGE_OPT_IN_ENV,
] as const;

const originalEnv = new Map<string, string | undefined>(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
);

/** A redirect assigned after startup, which an inherited child must not see. */
const afterStartupConfigHome = path.join(
  path.sep,
  'tmp',
  'llxprt-isolated-after-startup',
  'config',
);

const storageModuleUrl = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'storage.ts'),
).href;

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/** Removes every storage redirect, so the resolvers fall back to the real dirs. */
function unIsolate(): void {
  setEnv('LLXPRT_CONFIG_HOME', undefined);
  setEnv('LLXPRT_DATA_HOME', undefined);
  setEnv('LLXPRT_CACHE_HOME', undefined);
  setEnv('LLXPRT_LOG_HOME', undefined);
}

function restoreManagedEnvironment(): void {
  for (const [key, value] of originalEnv) {
    setEnv(key, value);
  }
}

describe('Storage config root inside an isolated test process', () => {
  afterEach(restoreManagedEnvironment);

  it('throws instead of returning the real config directory', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();

    expect(() => Storage.getGlobalConfigDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });

  it('names the redirect that would fix the failure', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();

    expect(() => Storage.getGlobalConfigDir()).toThrow('LLXPRT_CONFIG_HOME');
  });

  it('blocks every path built on the config root', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();

    expect(() => Storage.getGlobalSettingsPath()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
    expect(() => Storage.getUserCommandsDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });

  it('leaves the data, cache, and log roots resolvable', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();

    // Out of scope on purpose: a suite that spawns the real CLI as a product
    // smoke check would die at import time when the debug logger opens its log
    // file, over a directory whose contents nobody minds losing.
    expect(Storage.getGlobalDataDir()).toBe(LLXPRT_PLATFORM_PATHS.data);
    expect(Storage.getGlobalCacheDir()).toBe(LLXPRT_PLATFORM_PATHS.cache);
    expect(Storage.getGlobalLogDir()).toBe(LLXPRT_PLATFORM_PATHS.log);
  });

  it('throws for a directory beneath the real config root', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    // A redirect that stays inside the developer's live tree is not isolation.
    setEnv(
      'LLXPRT_CONFIG_HOME',
      path.join(LLXPRT_PLATFORM_PATHS.config, 'profiles'),
    );

    expect(() => Storage.getGlobalConfigDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });

  it('returns an isolated directory unchanged', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    // `path.join(path.sep, ...)` yields `\tmp\...` on Windows, which is
    // drive-relative rather than absolute. Storage resolves what it is given,
    // so the raw join would be compared against `D:\tmp\...` and never match.
    // Resolving here makes the fixture absolute on every platform: `/tmp/...`
    // on POSIX, `<drive>:\tmp\...` on Windows.
    const isolated = path.resolve(
      path.join(path.sep, 'tmp', 'llxprt-isolated', 'config'),
    );
    setEnv('LLXPRT_CONFIG_HOME', isolated);

    expect(Storage.getGlobalConfigDir()).toBe(isolated);
  });

  it('returns the real directory when a test explicitly opts in', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();
    setEnv(REAL_STORAGE_OPT_IN_ENV, 'true');

    expect(Storage.getGlobalConfigDir()).toBe(resolveGlobalConfigDir());
  });

  it('ignores an opt-in value other than the exact string true', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    unIsolate();
    setEnv(REAL_STORAGE_OPT_IN_ENV, '1');

    expect(() => Storage.getGlobalConfigDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });
});

describe('Storage config root outside an isolated test process', () => {
  afterEach(restoreManagedEnvironment);

  it('returns the real config directory when the marker is absent', () => {
    setEnv(ISOLATION_MARKER_ENV, undefined);
    unIsolate();

    expect(Storage.getGlobalConfigDir()).toBe(LLXPRT_PLATFORM_PATHS.config);
  });

  /**
   * The product, spawned by a suite as a smoke check, must keep working.
   *
   * Bun's `spawnSync` with an inherited environment snapshots the ORIGINAL
   * environment and drops `process.env` mutations made after startup, so the
   * child sees neither the isolation marker nor the redirect this process set.
   * It must therefore resolve the real config directory rather than throw. This
   * case reproduces the shape that broke `scripts/tests/issue-2342.test.ts` and
   * `scripts/tests/publish-integrity.test.ts`.
   */
  it('lets a child spawned with an inherited environment resolve it', () => {
    setEnv(ISOLATION_MARKER_ENV, '1');
    setEnv('LLXPRT_CONFIG_HOME', afterStartupConfigHome);

    const probe = spawnSync(
      process.execPath,
      [
        '-e',
        `import { Storage } from ${JSON.stringify(storageModuleUrl)};
process.stdout.write(Storage.getGlobalConfigDir());`,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );

    expect({
      'the probe process could not be spawned': probe.error?.message,
    }).toStrictEqual({
      'the probe process could not be spawned': undefined,
    });
    expect({
      status: probe.status,
      stdout: probe.stdout,
      stderr: probe.stderr,
    }).toMatchObject({ status: 0 });
    // Not an equality check against the platform default: a developer whose
    // shell exports LLXPRT_CONFIG_HOME before Bun starts passes it to the child
    // through the original environment. The property under test is that the
    // after-startup redirect did NOT reach the child and the guard did not fire.
    expect(probe.stdout).not.toBe(afterStartupConfigHome);
  });
});
