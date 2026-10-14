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

function countSyscalls(): SyscallCounts {
  const roles = new Map<number, 'index' | 'values'>();
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalWrite = fs.writeSync;
  const counts = { index: 0, values: 0 };
  vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
    const fd = originalOpen(path, flags, mode);
    const name = String(path);
    if (name.endsWith('/values')) roles.set(fd, 'values');
    else if (name.endsWith('/index') || name.endsWith('/index-next'))
      roles.set(fd, 'index');
    return fd;
  });
  const tally = (fd: number): void => {
    const role = roles.get(fd);
    if (role !== undefined) counts[role]++;
  };
  vi.spyOn(fs, 'readSync').mockImplementation(((
    fd: number,
    ...rest: never[]
  ) => {
    tally(fd);
    return originalRead(fd, ...rest);
  }) as typeof fs.readSync);
  vi.spyOn(fs, 'writeSync').mockImplementation(((
    fd: number,
    ...rest: never[]
  ) => {
    tally(fd);
    return originalWrite(fd, ...rest);
  }) as typeof fs.writeSync);
  return {
    index: () => counts.index,
    values: () => counts.values,
    reset: () => {
      counts.index = 0;
      counts.values = 0;
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
