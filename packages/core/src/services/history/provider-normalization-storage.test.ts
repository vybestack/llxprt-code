/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderNormalizationStorage } from './provider-normalization-storage.js';

interface SyscallCounts {
  readonly index: () => number;
  readonly values: () => number;
  readonly reset: () => void;
}

type Role = 'index' | 'values';

function roleOfPath(path: string): Role | undefined {
  if (path.endsWith('/values')) return 'values';
  if (path.endsWith('/index') || path.endsWith('/index-next')) return 'index';
  return undefined;
}

function countSyscalls(): SyscallCounts {
  // The spies call through to the real implementations; counts are derived
  // from the recorded calls at assertion time. Descriptor numbers are reused
  // after close, so each read/write is attributed to the latest preceding
  // open that returned the same descriptor.
  const openSpy = vi.spyOn(fs, 'openSync');
  const readSpy = vi.spyOn(fs, 'readSync');
  const writeSpy = vi.spyOn(fs, 'writeSync');
  const skipped = { read: 0, write: 0 };
  const opened = (): Array<{ order: number; fd: number; role?: Role }> =>
    openSpy.mock.calls.flatMap((call, position) => {
      const result = openSpy.mock.results[position];
      if (result.type !== 'return') return [];
      return [
        {
          order: openSpy.mock.invocationCallOrder[position],
          fd: result.value,
          role: roleOfPath(String(call[0])),
        },
      ];
    });
  const tally = (
    spy: typeof readSpy | typeof writeSpy,
    skip: number,
  ): Record<Role, number> => {
    const opens = opened();
    const counts = { index: 0, values: 0 };
    spy.mock.calls.slice(skip).forEach((call, offset) => {
      const order = spy.mock.invocationCallOrder[skip + offset];
      const owner = opens
        .filter((open) => open.fd === call[0] && open.order < order)
        .reduce<
          (typeof opens)[number] | undefined
        >((_, open) => open, undefined);
      if (owner?.role !== undefined) counts[owner.role]++;
    });
    return counts;
  };
  const total = (role: Role): number =>
    tally(readSpy, skipped.read)[role] + tally(writeSpy, skipped.write)[role];
  return {
    index: () => total('index'),
    values: () => total('values'),
    reset: () => {
      skipped.read = readSpy.mock.calls.length;
      skipped.write = writeSpy.mock.calls.length;
    },
  };
}

describe('ProviderNormalizationStorage filesystem work', () => {
  let directory: string;
  let storage: ProviderNormalizationStorage | undefined;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'provider-normalization-storage-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    storage?.close();
    storage = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  it('round-trips keys across table growth', () => {
    storage = new ProviderNormalizationStorage(directory);
    for (let key = 0; key < 5000; key++) storage.set(`k:${key}`, { key });
    for (let key = 0; key < 5000; key++)
      expect(storage.get(`k:${key}`)).toStrictEqual({ key });
    expect(storage.get('k:absent')).toBeUndefined();
    storage.set('k:7', 'replaced');
    expect(storage.get('k:7')).toBe('replaced');
  });

  it('grows the table with far fewer index system calls than keys moved', () => {
    const calls = countSyscalls();
    storage = new ProviderNormalizationStorage(directory);
    for (let key = 0; key < 20_000; key++) storage.set(`k:${key}`, key);
    expect(calls.index()).toBeLessThan(2.5 * 20_000);
  });

  it('reads a stored value once per lookup', () => {
    const calls = countSyscalls();
    storage = new ProviderNormalizationStorage(directory);
    const padding = 'x'.repeat(200);
    for (let key = 0; key < 4000; key++) storage.set(`k:${key}`, padding);
    calls.reset();
    expect(storage.get('k:5')).toBe(padding);
    expect(calls.values()).toBe(1);
  });

  it('locates a key once when it is updated right after being read', () => {
    const calls = countSyscalls();
    storage = new ProviderNormalizationStorage(directory);
    for (let key = 0; key < 1000; key++) storage.set(`k:${key}`, key);
    expect(storage.get('k:absent')).toBeUndefined();
    calls.reset();
    expect(storage.get('k:absent')).toBeUndefined();
    const lookup = calls.index();
    calls.reset();
    expect(storage.get('k:absent')).toBeUndefined();
    storage.set('k:absent', 1);
    expect(calls.index()).toBe(lookup + 1);
    expect(storage.get('k:absent')).toBe(1);
  });

  it('reports an unavailable scratch directory from verify', () => {
    storage = new ProviderNormalizationStorage(directory);
    storage.set('k', 1);
    storage.verify();
    rmSync(directory, { recursive: true, force: true });
    expect(() => storage?.verify()).toThrow(
      'Provider normalization scratch directory is unavailable',
    );
  });
});
