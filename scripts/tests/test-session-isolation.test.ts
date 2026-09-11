/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSessionEnv,
  createTestSessionRoot,
  SESSION_ENV_KEYS,
  type TestSession,
} from '../lib/test-session-isolation.js';

describe('createTestSessionRoot', () => {
  function cleanup(session: TestSession): void {
    rmSync(session.root, { recursive: true, force: true });
  }

  it('creates the session root with the full fake-home layout under <tmpdir>/llxprt-tests', () => {
    const session = createTestSessionRoot();
    try {
      expect(session.root.startsWith(join(tmpdir(), 'llxprt-tests'))).toBe(
        true,
      );
      expect(statSync(join(session.root, 'home', 'user')).isDirectory()).toBe(
        true,
      );
      expect(statSync(session.tmpDir).isDirectory()).toBe(true);
      if (process.platform !== 'win32')
        expect(statSync(session.root).mode & 0o777).toBe(0o700);
      expect(statSync(join(session.homeDir, '.config')).isDirectory()).toBe(
        true,
      );
      expect(statSync(join(session.homeDir, '.cache')).isDirectory()).toBe(
        true,
      );
      expect(
        statSync(join(session.homeDir, '.local', 'share')).isDirectory(),
      ).toBe(true);
    } finally {
      cleanup(session);
    }
  });

  it('gives sibling sessions distinct roots so concurrent checkouts never collide', () => {
    const first = createTestSessionRoot();
    const second = createTestSessionRoot();
    try {
      expect(first.root).not.toBe(second.root);
    } finally {
      cleanup(first);
      cleanup(second);
    }
  });

  it('honors an explicit base tmp dir instead of the platform tmpdir', () => {
    const base = mkdtempSync(join(tmpdir(), 'session-root-base-'));
    let session: TestSession | undefined;
    try {
      session = createTestSessionRoot(base);
      expect(session.root.startsWith(base)).toBe(true);
      expect(existsSync(join(session.root, 'home', 'user'))).toBe(true);
    } finally {
      if (session !== undefined) {
        cleanup(session);
      }
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('buildSessionEnv', () => {
  it('overrides exactly the session keys and points them inside the session root', () => {
    const session = createTestSessionRoot();
    try {
      const env = buildSessionEnv(
        {
          HOME: '/real/home',
          TMPDIR: '/real/tmp',
          XDG_CONFIG_HOME: '/real/.config',
          XDG_CACHE_HOME: '/real/.cache',
          XDG_DATA_HOME: '/real/.local/share',
          LLXPRT_TEST_DISABLE_OS_KEYRING: '0',
          LLXPRT_TEST_STORAGE_ISOLATED: 'keyring=0',
          UNRELATED: 'untouched',
        },
        session,
      );

      expect(env.HOME).toBe(session.homeDir);
      expect(env.USERPROFILE).toBe(session.homeDir);
      expect(env.TEMP).toBe(session.tmpDir);
      expect(env.TMP).toBe(session.tmpDir);
      expect(env.APPDATA).toBe(join(session.homeDir, 'AppData', 'Roaming'));
      expect(env.LOCALAPPDATA).toBe(join(session.homeDir, 'AppData', 'Local'));
      expect(env.TMPDIR).toBe(session.tmpDir);
      expect(env.XDG_CONFIG_HOME).toBe(join(session.homeDir, '.config'));
      expect(env.XDG_CACHE_HOME).toBe(join(session.homeDir, '.cache'));
      expect(env.XDG_DATA_HOME).toBe(join(session.homeDir, '.local', 'share'));
      expect(env.LLXPRT_TEST_SESSION_ROOT).toBe(session.root);
      expect(env.LLXPRT_TEST_DISABLE_OS_KEYRING).toBe('1');
      expect(env).not.toHaveProperty('LLXPRT_TEST_STORAGE_ISOLATED');
      expect(env.UNRELATED).toBe('untouched');
      expect(
        SESSION_ENV_KEYS.every(
          (key) =>
            key === 'LLXPRT_TEST_STORAGE_ISOLATED' || env[key] !== undefined,
        ),
      ).toBe(true);
    } finally {
      rmSync(session.root, { recursive: true, force: true });
    }
  });

  it.each(['1', 'keyring=0', 'keyring=', '', 'other'])(
    'removes inherited storage marker %j while disabling the OS keyring',
    (marker) => {
      const session = createTestSessionRoot();
      const input: NodeJS.ProcessEnv = {
        LLXPRT_TEST_STORAGE_ISOLATED: marker,
        LLXPRT_TEST_DISABLE_OS_KEYRING: '0',
      };
      try {
        const env = buildSessionEnv(input, session);

        expect(env).not.toHaveProperty('LLXPRT_TEST_STORAGE_ISOLATED');
        expect(env.LLXPRT_TEST_DISABLE_OS_KEYRING).toBe('1');
        expect(input.LLXPRT_TEST_STORAGE_ISOLATED).toBe(marker);
        expect(input.LLXPRT_TEST_DISABLE_OS_KEYRING).toBe('0');
      } finally {
        rmSync(session.root, { recursive: true, force: true });
      }
    },
  );

  it('overrides every key the session owns and leaves every other key untouched', () => {
    const session = createTestSessionRoot();
    try {
      const input: NodeJS.ProcessEnv = {
        LLXPRT_CONFIG_HOME: '/isolated/config',
        LLXPRT_BUN_TEST_TIMEOUT_RETRIES: '2',
        PATH: '/usr/bin',
        HOME: '/real/home',
      };
      const env = buildSessionEnv(input, session);

      const overridden = new Set<string>(SESSION_ENV_KEYS);
      for (const [key, value] of Object.entries(env)) {
        if (overridden.has(key)) {
          continue;
        }
        expect(input[key]).toBe(value);
      }
      for (const key of Object.keys(input)) {
        if (!overridden.has(key)) {
          expect(env[key]).toBe(input[key]);
        }
      }
      // The pre-existing LLXPRT_* isolation keeps precedence: the session env
      // must not rewrite any storage override.
      expect(env.LLXPRT_CONFIG_HOME).toBe('/isolated/config');
      expect(env.LLXPRT_BUN_TEST_TIMEOUT_RETRIES).toBe('2');
    } finally {
      rmSync(session.root, { recursive: true, force: true });
    }
  });

  it('returns a new object and never mutates the runner environment', () => {
    const session = createTestSessionRoot();
    try {
      const input: NodeJS.ProcessEnv = {
        HOME: '/real/home',
        LLXPRT_LOG_HOME: '/isolated/log',
      };
      const env = buildSessionEnv(input, session);

      expect(env).not.toBe(input);
      expect(input.HOME).toBe('/real/home');
      expect(input.TMPDIR).toBeUndefined();
      expect(input.LLXPRT_TEST_SESSION_ROOT).toBeUndefined();
      expect(input.LLXPRT_LOG_HOME).toBe('/isolated/log');
      expect(Object.keys(input).sort()).toEqual(['HOME', 'LLXPRT_LOG_HOME']);
    } finally {
      rmSync(session.root, { recursive: true, force: true });
    }
  });
});
