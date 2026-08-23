/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the test-process storage guard (issue #3278).
 *
 * The defect these tests pin down: a test process that was never storage
 * isolated resolved `Storage.getGlobalConfigDir()` to the developer's live
 * configuration directory and wrote profiles into it. The guard turns that
 * silent success into an immediate failure.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Storage } from './storage.js';
import {
  LLXPRT_PLATFORM_PATHS,
  resolveGlobalConfigDir,
} from './path-resolver.js';
import { REAL_STORAGE_OPT_IN_ENV } from './assertTestStorageIsolation.js';

const MANAGED_ENV_KEYS = [
  'LLXPRT_RUNNING_TESTS',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
  REAL_STORAGE_OPT_IN_ENV,
] as const;

const originalEnv = new Map<string, string | undefined>(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
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

afterEach(() => {
  for (const [key, value] of originalEnv) {
    setEnv(key, value);
  }
});

describe('Storage global roots inside a test process', () => {
  it('throws instead of returning the real config directory', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();

    expect(() => Storage.getGlobalConfigDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });

  it('names the redirect that would fix the failure', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();

    expect(() => Storage.getGlobalConfigDir()).toThrow('LLXPRT_CONFIG_HOME');
  });

  it('leaves the data, cache, and log roots resolvable', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();

    // Out of scope on purpose: a test that spawns the real CLI as a product
    // smoke check would die at import time when the debug logger opens its
    // log file, over a directory whose contents nobody minds losing.
    expect(Storage.getGlobalDataDir()).toBe(LLXPRT_PLATFORM_PATHS.data);
    expect(Storage.getGlobalCacheDir()).toBe(LLXPRT_PLATFORM_PATHS.cache);
    expect(Storage.getGlobalLogDir()).toBe(LLXPRT_PLATFORM_PATHS.log);
  });

  it('blocks every path built on the config root', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();

    expect(() => Storage.getGlobalSettingsPath()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
    expect(() => Storage.getUserCommandsDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });

  it('returns an isolated directory unchanged', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    const isolated = path.join(path.sep, 'tmp', 'llxprt-isolated', 'config');
    setEnv('LLXPRT_CONFIG_HOME', isolated);

    expect(Storage.getGlobalConfigDir()).toBe(isolated);
  });

  it('returns the real directory when a test explicitly opts in', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();
    setEnv(REAL_STORAGE_OPT_IN_ENV, 'true');

    expect(Storage.getGlobalConfigDir()).toBe(resolveGlobalConfigDir());
  });

  it('ignores an opt-in value other than the exact string true', () => {
    setEnv('LLXPRT_RUNNING_TESTS', 'true');
    unIsolate();
    setEnv(REAL_STORAGE_OPT_IN_ENV, '1');

    expect(() => Storage.getGlobalConfigDir()).toThrow(
      LLXPRT_PLATFORM_PATHS.config,
    );
  });
});

describe('Storage global roots outside a test process', () => {
  it('returns the real config directory to a normal session', () => {
    setEnv('LLXPRT_RUNNING_TESTS', undefined);
    unIsolate();

    expect(Storage.getGlobalConfigDir()).toBe(LLXPRT_PLATFORM_PATHS.config);
  });
});

describe('Storage global roots in a HOME-sandboxed child', () => {
  /**
   * Rewriting $HOME is how several suites sandbox a spawned process, and
   * `runCli` in the CLI integration tests forwards LLXPRT_CONFIG_HOME only when
   * the parent has one. env-paths honours $HOME, so such a child's platform
   * default is already a temp path rather than the developer's directory, and
   * the guard must let it through.
   */
  it('resolves a temp-home platform default without throwing', () => {
    const sandboxHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-home-sandbox-'),
    );
    const environment: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('LLXPRT_')) {
        environment[key] = value;
      }
    }
    environment.HOME = sandboxHome;
    // env-paths reads APPDATA/LOCALAPPDATA on Windows and $HOME elsewhere, so
    // sandboxing the child means moving whichever ones its platform consults.
    environment.APPDATA = sandboxHome;
    environment.LOCALAPPDATA = sandboxHome;
    environment.USERPROFILE = sandboxHome;
    environment.LLXPRT_RUNNING_TESTS = 'true';

    try {
      const probe = spawnSync(
        process.execPath,
        [
          '-e',
          `import { Storage } from ${JSON.stringify(storageModuleUrl)};
process.stdout.write(Storage.getGlobalConfigDir());`,
        ],
        {
          encoding: 'utf8',
          env: environment,
          timeout: 60_000,
        },
      );

      expect(
        probe.error?.message,
        'the probe process could not be spawned',
      ).toBeUndefined();
      expect(
        probe.status,
        `stdout: ${probe.stdout}
stderr: ${probe.stderr}`,
      ).toBe(0);
      expect(probe.stdout).toContain(path.basename(sandboxHome));
    } finally {
      fs.rmSync(sandboxHome, { recursive: true, force: true });
    }
  });
});
