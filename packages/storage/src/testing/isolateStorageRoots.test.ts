/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';

import { isolateStorageRoots } from './isolateStorageRoots.js';
import { Storage } from '../config/storage.js';

describe('isolateStorageRoots', () => {
  it('redirects all four Storage.getGlobal*Dir() paths beneath the temp root', () => {
    const tempRoot = isolateStorageRoots();

    expect(Storage.getGlobalConfigDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalDataDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalCacheDir().startsWith(tempRoot)).toBe(true);
    expect(Storage.getGlobalLogDir().startsWith(tempRoot)).toBe(true);
  });

  it('creates a temp root that is NOT beneath the real home directory', () => {
    const tempRoot = isolateStorageRoots();
    const home = os.homedir();

    expect(tempRoot.startsWith(home)).toBe(false);
  });

  it('is idempotent: calling twice returns the same root', () => {
    const first = isolateStorageRoots();
    const second = isolateStorageRoots();

    expect(second).toBe(first);
  });

  it('sets the LLXPRT_TEST_STORAGE_ISOLATED marker to "1"', () => {
    isolateStorageRoots();

    expect(process.env.LLXPRT_TEST_STORAGE_ISOLATED).toBe('1');
  });
});
