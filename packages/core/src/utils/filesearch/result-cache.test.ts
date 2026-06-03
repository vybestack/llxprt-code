/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, test, expect } from 'vitest';
import { ResultCache } from './result-cache.js';

describe('ResultCache', () => {
  test('basic usage', async () => {
    const files = [
      'foo.txt',
      'bar.js',
      'baz.md',
      'subdir/file.txt',
      'subdir/other.js',
      'subdir/nested/file.md',
    ];
    const cache = new ResultCache(files);
    const { files: resultFiles, isExactMatch } = await cache.get('*.js');
    expect(resultFiles).toStrictEqual(files);
    expect(isExactMatch).toBe(false);
  });

  test('cache hit/miss', async () => {
    const files = ['foo.txt', 'bar.js', 'baz.md'];
    const cache = new ResultCache(files);
    // First call: miss
    const { files: result1Files, isExactMatch: isExactMatch1 } =
      await cache.get('*.js');
    expect(result1Files).toStrictEqual(files);
    expect(isExactMatch1).toBe(false);

    // Simulate FileSearch applying the filter and setting the result
    cache.set('*.js', ['bar.js']);

    // Second call: hit
    const { files: result2Files, isExactMatch: isExactMatch2 } =
      await cache.get('*.js');
    expect(result2Files).toStrictEqual(['bar.js']);
    expect(isExactMatch2).toBe(true);
  });

  test('best base query', async () => {
    const files = ['foo.txt', 'foobar.js', 'baz.md'];
    const cache = new ResultCache(files);

    // Cache a broader query
    cache.set('foo', ['foo.txt', 'foobar.js']);

    // Search for a more specific query that starts with the broader one
    const { files: resultFiles, isExactMatch } = await cache.get('foobar');
    expect(resultFiles).toStrictEqual(['foo.txt', 'foobar.js']);
    expect(isExactMatch).toBe(false);
  });
});
