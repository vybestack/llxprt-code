/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  isolateStorageRoots,
  STORAGE_ENV_KEYS,
  STORAGE_ENV_SUBDIRECTORIES,
} from './isolateStorageRoots.js';
import { Storage } from '../config/storage.js';

const ISOLATION_ENV_KEYS = [
  ...STORAGE_ENV_KEYS,
  'LLXPRT_TEST_STORAGE_ISOLATED',
  'LLXPRT_TEST_DISABLE_OS_KEYRING',
  'LLXPRT_TEST_LEGACY_HOME',
] as const;

function captureStorageEnvironment(
  keys: readonly string[],
): ReadonlyMap<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreStorageEnvironment(
  values: ReadonlyMap<string, string | undefined>,
): void {
  for (const [key, value] of values) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('isolateStorageRoots', () => {
  it('redirects all four Storage.getGlobal*Dir() paths beneath the temp root', () => {
    const tempRoot = isolateStorageRoots();

    expect(Storage.getGlobalConfigDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalDataDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalCacheDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalLogDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getUserAgentSkillsDir().startsWith(tempRoot)).toBe(true);
  });

  it('assigns each storage category to its dedicated isolated subdirectory', () => {
    const tempRoot = isolateStorageRoots();

    expect(Storage.getGlobalConfigDir()).toBe(path.join(tempRoot, 'config'));
    expect(Storage.getGlobalDataDir()).toBe(path.join(tempRoot, 'data'));
    expect(Storage.getGlobalCacheDir()).toBe(path.join(tempRoot, 'cache'));
    expect(Storage.getGlobalLogDir()).toBe(path.join(tempRoot, 'log'));
    expect(Storage.getUserAgentSkillsDir()).toBe(
      path.join(tempRoot, 'agents', 'skills'),
    );
  });

  it('provides one shared subdirectory mapping for every storage variable', () => {
    expect(
      STORAGE_ENV_KEYS.map((key) => [key, STORAGE_ENV_SUBDIRECTORIES[key]]),
    ).toStrictEqual([
      ['LLXPRT_CONFIG_HOME', 'config'],
      ['LLXPRT_DATA_HOME', 'data'],
      ['LLXPRT_CACHE_HOME', 'cache'],
      ['LLXPRT_LOG_HOME', 'log'],
      ['LLXPRT_AGENTS_HOME', 'agents'],
    ]);
  });

  it('is idempotent: calling twice returns the same root', () => {
    const first = isolateStorageRoots();
    const second = isolateStorageRoots();

    expect(second).toBe(first);
  });

  it('sets the LLXPRT_TEST_STORAGE_ISOLATED marker to "1"', () => {
    const originalEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
    try {
      delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
      delete process.env.LLXPRT_TEST_DISABLE_OS_KEYRING;
      isolateStorageRoots();

      expect(String(process.env.LLXPRT_TEST_STORAGE_ISOLATED)).toBe('1');
    } finally {
      restoreStorageEnvironment(originalEnv);
    }
    const recheckEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
    try {
      expect(() => isolateStorageRoots()).not.toThrow();
    } finally {
      restoreStorageEnvironment(recheckEnv);
    }
  });

  it('rejects an inconsistent marked isolation state', () => {
    const originalEnv = captureStorageEnvironment([
      'LLXPRT_TEST_STORAGE_ISOLATED',
      'LLXPRT_CONFIG_HOME',
    ]);
    try {
      process.env.LLXPRT_TEST_STORAGE_ISOLATED = '1';
      delete process.env.LLXPRT_CONFIG_HOME;

      expect(() => isolateStorageRoots()).toThrow(
        'Isolated test storage marker is set without an absolute LLXPRT_CONFIG_HOME',
      );
    } finally {
      restoreStorageEnvironment(originalEnv);
    }
  });

  it('rejects a marked state whose storage roots do not share one mapping', () => {
    const originalEnv = captureStorageEnvironment([
      ...STORAGE_ENV_KEYS,
      'LLXPRT_TEST_STORAGE_ISOLATED',
    ]);
    const testStorageRoot = path.resolve('marked-test-storage');
    try {
      process.env.LLXPRT_TEST_STORAGE_ISOLATED = '1';
      for (const key of STORAGE_ENV_KEYS) {
        process.env[key] = path.join(
          testStorageRoot,
          STORAGE_ENV_SUBDIRECTORIES[key],
        );
      }
      process.env.LLXPRT_DATA_HOME = path.join(testStorageRoot, 'other-data');

      expect(() => isolateStorageRoots()).toThrow(
        'Isolated test storage marker is set with an inconsistent LLXPRT_DATA_HOME',
      );
    } finally {
      restoreStorageEnvironment(originalEnv);
    }
  });

  it('sets LLXPRT_TEST_DISABLE_OS_KEYRING to "1"', () => {
    const originalEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
    try {
      delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
      delete process.env.LLXPRT_TEST_DISABLE_OS_KEYRING;
      isolateStorageRoots();

      expect(String(process.env.LLXPRT_TEST_DISABLE_OS_KEYRING)).toBe('1');
    } finally {
      restoreStorageEnvironment(originalEnv);
    }
  });

  it('sets LLXPRT_TEST_LEGACY_HOME to an existing absolute <root>/home/user', () => {
    const originalEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
    try {
      delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
      delete process.env.LLXPRT_TEST_LEGACY_HOME;
      const tempRoot = isolateStorageRoots();

      const legacyHome: unknown = process.env.LLXPRT_TEST_LEGACY_HOME;
      if (typeof legacyHome !== 'string') {
        throw new Error('Storage isolation did not set the legacy home');
      }
      expect(legacyHome).toBe(path.join(tempRoot, 'home', 'user'));
      expect(path.isAbsolute(legacyHome)).toBe(true);
      expect(fs.statSync(legacyHome).isDirectory()).toBe(true);
    } finally {
      restoreStorageEnvironment(originalEnv);
    }
  });

  for (const optOut of process.platform === 'win32' ? ['0'] : ['', '0']) {
    it(`runs the native smoke suite with keyring opt-out ${JSON.stringify(optOut)} through the storage preload`, () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'native-keyring-gate-'),
      );
      const preload = path.join(root, 'missing-keyring.ts');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        LLXPRT_TEST_DISABLE_OS_KEYRING: optOut,
      };
      delete env.LLXPRT_TEST_STORAGE_ISOLATED;
      try {
        fs.writeFileSync(
          preload,
          `import { mock } from 'bun:test';
mock.module('@napi-rs/keyring', () => ({ AsyncEntry: class {
  constructor() { throw new Error('fake @napi-rs/keyring unavailable'); }
} }));`,
        );
        const child = spawnSync(
          process.execPath,
          [
            'test',
            '--preload',
            preload,
            'src/secure-store/secure-store.native-keyring.test.ts',
          ],
          {
            cwd: path.resolve(import.meta.dir, '../..'),
            env,
            encoding: 'utf8',
            timeout: 30_000,
          },
        );
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(1);
        expect(
          child.stderr
            .split('\n')
            .some((line) => /^[1-9]\d* fail$/.test(line.trim())),
        ).toBe(true);
        expect(child.stderr).not.toContain('skip');
        expect(child.stderr).toContain('UNAVAILABLE');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(`preserves the explicit keyring opt-out ${JSON.stringify(optOut)} across repeated calls`, () => {
      const originalEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
      let root: string | undefined;
      try {
        delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
        process.env.LLXPRT_TEST_DISABLE_OS_KEYRING = optOut;
        root = isolateStorageRoots();
        expect(process.env.LLXPRT_TEST_DISABLE_OS_KEYRING).toBe(optOut);
        expect(isolateStorageRoots()).toBe(root);
        expect(String(process.env.LLXPRT_TEST_STORAGE_ISOLATED)).toBe('1');
        expect(process.env.LLXPRT_TEST_DISABLE_OS_KEYRING === '1').toBe(false);
      } finally {
        restoreStorageEnvironment(originalEnv);
        if (root !== undefined)
          fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  describe('marked-state validation of the keyring and legacy-home overrides', () => {
    let markedRoot: string | undefined;
    let originalEnv: ReadonlyMap<string, string | undefined>;

    beforeEach(() => {
      originalEnv = captureStorageEnvironment(ISOLATION_ENV_KEYS);
      markedRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-marked-storage-'),
      );
      fs.mkdirSync(path.join(markedRoot, 'home', 'user'), {
        recursive: true,
      });
      process.env.LLXPRT_TEST_STORAGE_ISOLATED = '1';
      for (const key of STORAGE_ENV_KEYS) {
        process.env[key] = path.join(
          markedRoot,
          STORAGE_ENV_SUBDIRECTORIES[key],
        );
      }
      process.env.LLXPRT_TEST_DISABLE_OS_KEYRING = '1';
      process.env.LLXPRT_TEST_LEGACY_HOME = path.join(
        markedRoot,
        'home',
        'user',
      );
    });

    afterEach(() => {
      restoreStorageEnvironment(originalEnv);
      if (markedRoot !== undefined) {
        fs.rmSync(markedRoot, { recursive: true, force: true });
      }
    });

    it('accepts a fully consistent marked state', () => {
      if (markedRoot === undefined) {
        throw new Error('Marked storage fixture was not initialized');
      }
      expect(isolateStorageRoots()).toBe(markedRoot);
    });

    it('rejects an unrecognized isolation marker', () => {
      process.env.LLXPRT_TEST_STORAGE_ISOLATED = 'keyring=0';
      expect(() => isolateStorageRoots()).toThrow(
        "Isolated test storage marker has an unrecognized value 'keyring=0'",
      );
    });

    it('rejects an invalid keyring disable value and reports it', () => {
      process.env.LLXPRT_TEST_DISABLE_OS_KEYRING = 'invalid';
      expect(() => isolateStorageRoots()).toThrow(
        "Isolated test storage marker requires LLXPRT_TEST_DISABLE_OS_KEYRING to be '1', '', or '0' but found 'invalid'",
      );
    });

    it('rejects a marked state without the keyring disable', () => {
      delete process.env.LLXPRT_TEST_DISABLE_OS_KEYRING;
      expect(() => isolateStorageRoots()).toThrow(
        "Isolated test storage marker requires LLXPRT_TEST_DISABLE_OS_KEYRING to be '1', '', or '0' but found 'undefined'",
      );
    });

    it('rejects a marked state without a legacy home', () => {
      delete process.env.LLXPRT_TEST_LEGACY_HOME;
      expect(() => isolateStorageRoots()).toThrow(
        'Isolated test storage marker is set with an invalid LLXPRT_TEST_LEGACY_HOME',
      );
    });

    it('rejects a marked state with a relative legacy home', () => {
      process.env.LLXPRT_TEST_LEGACY_HOME = 'relative/home';
      expect(() => isolateStorageRoots()).toThrow(
        'Isolated test storage marker is set with an invalid LLXPRT_TEST_LEGACY_HOME',
      );
    });

    it('rejects a marked state whose legacy home does not match the storage root', () => {
      if (markedRoot === undefined)
        throw new Error('Marked storage fixture was not initialized');
      process.env.LLXPRT_TEST_LEGACY_HOME = path.join(markedRoot, 'home');
      expect(() => isolateStorageRoots()).toThrow(
        'Isolated test storage marker is set with an invalid LLXPRT_TEST_LEGACY_HOME',
      );
    });

    it('accepts repeated calls after the isolated root has been removed', () => {
      if (markedRoot === undefined)
        throw new Error('Marked storage fixture was not initialized');
      fs.rmSync(markedRoot, { recursive: true, force: true });
      expect(isolateStorageRoots()).toBe(markedRoot);
    });
  });
});
