/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';

import {
  isolateStorageRoots,
  STORAGE_ENV_KEYS,
  STORAGE_ENV_SUBDIRECTORIES,
} from './isolateStorageRoots.js';
import { Storage } from '../config/storage.js';

describe('isolateStorageRoots', () => {
  it('redirects all four Storage.getGlobal*Dir() paths beneath the temp root', () => {
    const tempRoot = isolateStorageRoots();

    expect(Storage.getGlobalConfigDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalDataDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalCacheDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalLogDir().startsWith(tempRoot)).toBe(true);
  });

  it('assigns each storage category to its dedicated isolated subdirectory', () => {
    const tempRoot = isolateStorageRoots();

    expect(Storage.getGlobalConfigDir()).toBe(path.join(tempRoot, 'config'));
    expect(Storage.getGlobalDataDir()).toBe(path.join(tempRoot, 'data'));
    expect(Storage.getGlobalCacheDir()).toBe(path.join(tempRoot, 'cache'));
    expect(Storage.getGlobalLogDir()).toBe(path.join(tempRoot, 'log'));
  });

  it('provides one shared subdirectory mapping for every storage variable', () => {
    expect(
      STORAGE_ENV_KEYS.map((key) => [key, STORAGE_ENV_SUBDIRECTORIES[key]]),
    ).toStrictEqual([
      ['LLXPRT_CONFIG_HOME', 'config'],
      ['LLXPRT_DATA_HOME', 'data'],
      ['LLXPRT_CACHE_HOME', 'cache'],
      ['LLXPRT_LOG_HOME', 'log'],
    ]);
  });

  it('is idempotent: calling twice returns the same root', () => {
    const first = isolateStorageRoots();
    const second = isolateStorageRoots();

    expect(second).toBe(first);
  });

  it('sets the LLXPRT_TEST_STORAGE_ISOLATED marker to "1"', () => {
    // Clear the marker so we can verify the function actually sets it.
    delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
    isolateStorageRoots();

    expect(process.env.LLXPRT_TEST_STORAGE_ISOLATED).toBe('1');
  });
});
