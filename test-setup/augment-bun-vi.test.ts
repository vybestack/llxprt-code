/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./import-actual-fixture.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./import-actual-fixture.js')>();
  return { ...actual, fixtureValue: 'mocked' };
});

describe('Bun vi augmentation', () => {
  it('resolves importOriginal relative to the registering test file', async () => {
    const imported = await import('./import-actual-fixture.js');

    expect(imported.fixtureValue).toBe('mocked');
  });

  it('supports factories that do not request importOriginal', async () => {
    vi.mock('./secondary-import-actual-fixture.js', () => ({
      fixtureValue: 'secondary-mocked',
    }));

    const imported = await import('./secondary-import-actual-fixture.js');
    expect(imported.fixtureValue).toBe('secondary-mocked');
  });

  it('resolves and caches importActual relative to the calling test file', async () => {
    const actual = await vi.importActual<
      typeof import('./import-actual-fixture.js')
    >('./import-actual-fixture.js');
    const repeated = await vi.importActual<
      typeof import('./import-actual-fixture.js')
    >('./import-actual-fixture.js');

    expect(actual.fixtureValue).toBe('actual');
    expect(repeated).toBe(actual);
  });

  it('loads built-in modules through importActual', async () => {
    const actual =
      await vi.importActual<typeof import('node:path')>('node:path');

    expect(actual.basename('/tmp/example.txt')).toBe('example.txt');
  });

  it('settles async timer helpers without a fixed draining delay', async () => {
    vi.useFakeTimers();
    let settled = false;
    setTimeout(() => {
      Promise.resolve().then(() => {
        settled = true;
      });
    }, 10);

    await vi.advanceTimersByTimeAsync(10);

    vi.useRealTimers();
    expect(settled).toBe(true);
  });

  it('fails fast for unsupported module isolation APIs', () => {
    expect(() => vi.resetModules()).toThrow(
      'Bun does not support resetting or unmocking modules',
    );
  });

  it('fails fast instead of returning false mock-registry results', () => {
    expect(() => Reflect.get(vi.mocks, 'fixture')).toThrow(
      'Bun does not expose its module mock registry',
    );
  });
});
