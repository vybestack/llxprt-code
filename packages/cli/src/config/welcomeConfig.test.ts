/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  WELCOME_CONFIG_FILENAME,
  getWelcomeConfigPath,
  isWelcomeCompleted,
  loadWelcomeConfig,
  markWelcomeCompleted,
  resetWelcomeConfigForTesting,
  saveWelcomeConfig,
} from './welcomeConfig.js';
import { USER_SETTINGS_DIR } from './paths.js';

const WELCOME_CONFIG_ENV = 'LLXPRT_CODE_WELCOME_CONFIG_PATH';

interface PersistedWelcomeConfig {
  welcomeCompleted: boolean;
  completedAt?: string;
  skipped?: boolean;
}

function isPersistedWelcomeConfig(
  value: unknown,
): value is PersistedWelcomeConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.welcomeCompleted !== 'boolean') return false;
  if ('completedAt' in candidate && typeof candidate.completedAt !== 'string') {
    return false;
  }
  if ('skipped' in candidate && typeof candidate.skipped !== 'boolean') {
    return false;
  }
  return true;
}

function readWelcomeConfig(configPath: string): PersistedWelcomeConfig {
  const onDisk: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!isPersistedWelcomeConfig(onDisk)) {
    throw new Error(`Malformed welcome config at ${configPath}`);
  }
  return onDisk;
}

/**
 * Shared temp-config lifecycle. Registers beforeEach/afterEach that point the
 * welcome config at a throwaway path under the OS temp dir, so no test ever
 * touches the real user settings dir, and restores the environment afterwards.
 * Returns a lazy accessor for the config path configured for the current test.
 */
function useTempWelcomeConfig(): () => string {
  let configDir: string | undefined;
  let originalEnv: string | undefined;
  let configPath = '';

  beforeEach(() => {
    originalEnv = process.env[WELCOME_CONFIG_ENV];
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-config-'));
    configPath = path.join(configDir, WELCOME_CONFIG_FILENAME);
    process.env[WELCOME_CONFIG_ENV] = configPath;
    resetWelcomeConfigForTesting();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[WELCOME_CONFIG_ENV];
    } else {
      process.env[WELCOME_CONFIG_ENV] = originalEnv;
    }
    resetWelcomeConfigForTesting();
    if (configDir) {
      fs.rmSync(configDir, { recursive: true, force: true });
      configDir = undefined;
    }
  });

  return () => configPath;
}

describe('getWelcomeConfigPath', () => {
  const getConfigPath = useTempWelcomeConfig();

  it('returns the environment override verbatim when the override is set', () => {
    expect(getWelcomeConfigPath()).toBe(getConfigPath());
  });

  it('falls back to the user settings dir when the override is unset', () => {
    delete process.env[WELCOME_CONFIG_ENV];
    resetWelcomeConfigForTesting();
    expect(getWelcomeConfigPath()).toBe(
      path.join(USER_SETTINGS_DIR, WELCOME_CONFIG_FILENAME),
    );
  });
});

describe('loadWelcomeConfig', () => {
  const getConfigPath = useTempWelcomeConfig();

  it('returns welcomeCompleted false when no file exists on disk', () => {
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: false });
    expect(isWelcomeCompleted()).toBe(false);
  });

  it('reports onboarding complete when the file says welcomeCompleted true', () => {
    fs.writeFileSync(getConfigPath(), '{"welcomeCompleted": true}', 'utf-8');
    resetWelcomeConfigForTesting();
    expect(isWelcomeCompleted()).toBe(true);
  });

  it('falls back to welcomeCompleted false instead of throwing on malformed JSON', () => {
    fs.writeFileSync(getConfigPath(), '{ not json', 'utf-8');
    resetWelcomeConfigForTesting();
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: false });
    expect(isWelcomeCompleted()).toBe(false);
    // Repeated reads without a cache reset must keep returning the default
    // rather than re-parsing (or caching) the corrupt file into something else.
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: false });
    expect(isWelcomeCompleted()).toBe(false);
  });

  it('recovers once the malformed file is replaced and the cache is reset', () => {
    fs.writeFileSync(getConfigPath(), '{ not json', 'utf-8');
    resetWelcomeConfigForTesting();
    expect(isWelcomeCompleted()).toBe(false);
    fs.writeFileSync(getConfigPath(), '{"welcomeCompleted": true}', 'utf-8');
    resetWelcomeConfigForTesting();
    expect(isWelcomeCompleted()).toBe(true);
  });
});

describe('saveWelcomeConfig', () => {
  const getConfigPath = useTempWelcomeConfig();

  it('creates a missing parent directory and writes the file', () => {
    const configPath = path.join(
      getConfigPath(),
      'nested',
      'dir',
      'welcomeConfig.json',
    );
    process.env[WELCOME_CONFIG_ENV] = configPath;
    resetWelcomeConfigForTesting();
    saveWelcomeConfig({ welcomeCompleted: true });
    expect(fs.existsSync(configPath)).toBe(true);
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: true });
  });

  it.skipIf(process.platform === 'win32')(
    'writes the file with owner-only permissions',
    () => {
      saveWelcomeConfig({ welcomeCompleted: true });
      const mode = fs.statSync(getConfigPath()).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it('round-trips the exact JSON that was saved', () => {
    saveWelcomeConfig({
      welcomeCompleted: true,
      skipped: true,
      completedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))).toEqual({
      welcomeCompleted: true,
      skipped: true,
      completedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('does not throw when the config path is unwritable', () => {
    const configPath = getConfigPath();
    fs.mkdirSync(configPath);
    expect(() => saveWelcomeConfig({ welcomeCompleted: true })).not.toThrow();
  });
});

describe('markWelcomeCompleted', () => {
  const getConfigPath = useTempWelcomeConfig();

  it('persists welcomeCompleted and skipped true with a strict ISO completion time', () => {
    markWelcomeCompleted(true);
    const onDisk = readWelcomeConfig(getConfigPath());
    expect(onDisk.welcomeCompleted).toBe(true);
    expect(onDisk.skipped).toBe(true);
    expect(onDisk.completedAt).toBeDefined();
    if (onDisk.completedAt === undefined) {
      throw new Error('completedAt must be present for a skipped completion');
    }
    expect(new Date(onDisk.completedAt).toISOString()).toBe(onDisk.completedAt);
  });

  it('persists skipped false with a strict ISO completion time', () => {
    markWelcomeCompleted(false);
    const onDisk = readWelcomeConfig(getConfigPath());
    expect(onDisk.welcomeCompleted).toBe(true);
    expect(onDisk.skipped).toBe(false);
    expect(onDisk.completedAt).toBeDefined();
    if (onDisk.completedAt === undefined) {
      throw new Error(
        'completedAt must be present for a non-skipped completion',
      );
    }
    expect(new Date(onDisk.completedAt).toISOString()).toBe(onDisk.completedAt);
  });
});

describe('welcome config caching', () => {
  const getConfigPath = useTempWelcomeConfig();

  it('returns the cached value until the cache is reset', () => {
    // The first and second reads assert the same value on purpose: the second
    // one comes AFTER an out-of-band rewrite, so an unchanged result is the
    // evidence that the process-lifetime cache is being served.
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: false });
    fs.writeFileSync(getConfigPath(), '{"welcomeCompleted": true}', 'utf-8');
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: false });
    resetWelcomeConfigForTesting();
    expect(loadWelcomeConfig()).toEqual({ welcomeCompleted: true });
  });
});
