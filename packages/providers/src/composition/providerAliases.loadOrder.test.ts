/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for deterministic alias loading order (@issue #3546).
 * loadProviderAliasEntries must return entries sorted by file name within
 * each alias directory regardless of the order the filesystem reports, and
 * must keep user-directory entries ahead of builtin ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Storage } from '@vybestack/llxprt-code-settings';

import { loadProviderAliasEntries } from './providerAliases.js';

// Creation order deliberately differs from sorted order (alpha, mike, zulu)
// so the real directory contents do not invite a sorted-order coincidence.
const USER_ALIAS_FILENAMES_IN_CREATION_ORDER = [
  'mike.config',
  'zulu.config',
  'alpha.config',
] as const;

describe('providerAliases load order (@issue:3546)', () => {
  let tmpDir: string;
  let userAliasDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-loadorder-'));
    const fakeLlxprtDir = path.join(tmpDir, '.llxprt');
    userAliasDir = path.join(fakeLlxprtDir, 'providers');
    fs.mkdirSync(userAliasDir, { recursive: true });

    for (const filename of USER_ALIAS_FILENAMES_IN_CREATION_ORDER) {
      fs.writeFileSync(
        path.join(userAliasDir, filename),
        JSON.stringify({
          baseProvider: 'openai',
          'base-url': 'https://alias-loadorder.test/v1',
        }),
      );
    }

    vi.spyOn(Storage, 'getGlobalDataDir').mockReturnValue(fakeLlxprtDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns user-directory entries sorted regardless of filesystem read order', () => {
    // Hand the loader a maximally wrong (descending) listing rebuilt from
    // the real directory entries, so a passthrough can never look sorted.
    const realReaddirSync = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((
      dirPath: fs.PathLike,
      options?: unknown,
    ) => {
      const result = realReaddirSync(dirPath, options as never);
      if (
        typeof dirPath === 'string' &&
        path.resolve(dirPath) === userAliasDir &&
        Array.isArray(result) &&
        result.length > 1
      ) {
        return [...result].sort().reverse();
      }
      return result;
    }) as typeof fs.readdirSync);

    const entries = loadProviderAliasEntries();

    const userAliases = entries
      .filter((entry) => entry.source === 'user')
      .map((entry) => entry.alias);
    expect(userAliases).toStrictEqual(['alpha', 'mike', 'zulu']);
  });

  it('keeps user-directory entries ahead of builtin entries', () => {
    const entries = loadProviderAliasEntries();

    const firstBuiltinIndex = entries.findIndex(
      (entry) => entry.source === 'builtin',
    );
    const lastUserIndex = entries
      .map((entry) => entry.source)
      .lastIndexOf('user');

    expect(firstBuiltinIndex).toBeGreaterThan(-1);
    expect(lastUserIndex).toBeGreaterThan(-1);
    expect(lastUserIndex).toBeLessThan(firstBuiltinIndex);
  });

  it('returns builtin-directory entries sorted', () => {
    // Same adversarial readdir treatment as the user-directory test, applied
    // to every directory the loader reads — including the builtin directory —
    // so this assertion is filesystem-independent and a passthrough (missing
    // sort) can never look sorted by coincidence.
    const realReaddirSync = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((
      dirPath: fs.PathLike,
      options?: unknown,
    ) => {
      const result = realReaddirSync(dirPath, options as never);
      if (Array.isArray(result) && result.length > 1) {
        return [...result].sort().reverse();
      }
      return result;
    }) as typeof fs.readdirSync);

    const entries = loadProviderAliasEntries();

    // Builtin configs may carry display names, so deterministic order is
    // defined by file name; assert on the basenames the loader sorted by.
    const builtinFileNames = entries
      .filter((entry) => entry.source === 'builtin')
      .map((entry) => path.basename(entry.filePath));
    expect(builtinFileNames).toStrictEqual([...builtinFileNames].sort());
  });
});
