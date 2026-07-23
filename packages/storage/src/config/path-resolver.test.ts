/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared path resolver.
 *
 * Verifies the resolver produces the same values as the Storage module's
 * env-override + platform-default algorithm, so scripts that run pre-build
 * use the IDENTICAL path authority without importing built dist.
 *
 * Additionally asserts that `Storage.getGlobal*Dir()` delegates to this
 * resolver (the single-implementation contract).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveGlobalConfigDir,
  resolveGlobalDataDir,
  resolveGlobalCacheDir,
  resolveGlobalLogDir,
  resolveEnvOverride,
  resolveCanonicalDir,
  LLXPRT_PLATFORM_PATHS,
} from './path-resolver.js';
import { Storage } from './storage.js';

const ENV_KEYS = [
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

describe('shared path-resolver', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('resolveEnvOverride returns undefined for absent/empty/non-absolute values', () => {
    expect(resolveEnvOverride(undefined)).toBeUndefined();
    expect(resolveEnvOverride('')).toBeUndefined();
    expect(resolveEnvOverride('   ')).toBeUndefined();
    expect(resolveEnvOverride('relative/path')).toBeUndefined();
  });

  it('resolveEnvOverride resolves an absolute path', () => {
    expect(resolveEnvOverride('/tmp/foo')).toBe('/tmp/foo');
    expect(resolveEnvOverride('  /tmp/bar  ')).toBe('/tmp/bar');
  });

  it('resolveGlobalConfigDir returns the platform default when no override is set', () => {
    expect(resolveGlobalConfigDir()).toBe(LLXPRT_PLATFORM_PATHS.config);
  });

  it('resolveGlobalConfigDir honors LLXPRT_CONFIG_HOME', () => {
    process.env.LLXPRT_CONFIG_HOME = '/tmp/custom-config';
    expect(resolveGlobalConfigDir()).toBe('/tmp/custom-config');
  });

  it('resolveGlobalDataDir falls back to LLXPRT_CONFIG_HOME when LLXPRT_DATA_HOME is absent', () => {
    process.env.LLXPRT_CONFIG_HOME = '/tmp/shared-root';
    expect(resolveGlobalDataDir()).toBe('/tmp/shared-root');
  });

  it('resolveGlobalDataDir prefers LLXPRT_DATA_HOME over LLXPRT_CONFIG_HOME', () => {
    process.env.LLXPRT_DATA_HOME = '/tmp/data-specific';
    process.env.LLXPRT_CONFIG_HOME = '/tmp/config-fallback';
    expect(resolveGlobalDataDir()).toBe('/tmp/data-specific');
  });

  it('resolveGlobalCacheDir falls back to LLXPRT_CONFIG_HOME', () => {
    process.env.LLXPRT_CONFIG_HOME = '/tmp/cache-fallback';
    expect(resolveGlobalCacheDir()).toBe('/tmp/cache-fallback');
  });

  it('resolveGlobalLogDir falls back to LLXPRT_CONFIG_HOME', () => {
    process.env.LLXPRT_CONFIG_HOME = '/tmp/log-fallback';
    expect(resolveGlobalLogDir()).toBe('/tmp/log-fallback');
  });

  it('resolveCanonicalDir throws when platformDefault is empty and no override is set', () => {
    expect(() => resolveCanonicalDir('NOPE_X', undefined, '')).toThrow(
      /platformDefault must not be empty/,
    );
  });

  it('all four resolvers return the platform defaults (no env overrides)', () => {
    expect(resolveGlobalConfigDir()).toBe(LLXPRT_PLATFORM_PATHS.config);
    expect(resolveGlobalDataDir()).toBe(LLXPRT_PLATFORM_PATHS.data);
    expect(resolveGlobalCacheDir()).toBe(LLXPRT_PLATFORM_PATHS.cache);
    expect(resolveGlobalLogDir()).toBe(LLXPRT_PLATFORM_PATHS.log);
  });
});

describe('Storage delegates to the shared path-resolver (single implementation)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('Storage.getGlobalConfigDir matches resolveGlobalConfigDir', () => {
    expect(Storage.getGlobalConfigDir()).toBe(resolveGlobalConfigDir());
  });

  it('Storage.getGlobalDataDir matches resolveGlobalDataDir', () => {
    expect(Storage.getGlobalDataDir()).toBe(resolveGlobalDataDir());
  });

  it('Storage.getGlobalCacheDir matches resolveGlobalCacheDir', () => {
    expect(Storage.getGlobalCacheDir()).toBe(resolveGlobalCacheDir());
  });

  it('Storage.getGlobalLogDir matches resolveGlobalLogDir', () => {
    expect(Storage.getGlobalLogDir()).toBe(resolveGlobalLogDir());
  });

  it('Storage honors LLXPRT_DATA_HOME override identically to the resolver', () => {
    process.env.LLXPRT_DATA_HOME = '/tmp/storage-data-override';
    expect(Storage.getGlobalDataDir()).toBe('/tmp/storage-data-override');
    expect(Storage.getGlobalDataDir()).toBe(resolveGlobalDataDir());
  });
});
