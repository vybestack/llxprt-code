/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderNormalizationDisk } from './provider-normalization-disk.js';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';

async function withDisk(
  action: (disk: ProviderNormalizationDisk, root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'provider-normalization-io-'));
  const disk = new ProviderNormalizationDisk(root);
  try {
    await action(disk, root);
  } finally {
    disk.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('provider normalization bounded filesystem work', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends and reads back whole rows with far fewer system calls than rows', async () => {
    await withDisk(async (disk) => {
      const reads = vi.spyOn(fs, 'readSync');
      const writes = vi.spyOn(fs, 'writeSync');
      const rows = 2000;
      for (let index = 0; index < rows; index++)
        expect(disk.append('normalized', batchRow(index, 256))).toBe(index);
      expect(writes.mock.calls.length).toBeLessThan(rows / 4);
      reads.mockClear();
      for (let index = 0; index < rows; index++)
        expect(disk.row('normalized', index)).toStrictEqual(
          batchRow(index, 256),
        );
      expect(reads.mock.calls.length).toBeLessThan(rows / 4);
    });
  });

  it('validates stored counters without building a schema per lookup', async () => {
    await withDisk(async (disk) => {
      for (let index = 0; index < 100; index++)
        disk.setNumber(`call:${index}`, index);
      const builds = vi.spyOn(z, 'number');
      for (let index = 0; index < 100; index++)
        expect(disk.number(`call:${index}`)).toBe(index);
      expect(builds).not.toHaveBeenCalled();
    });
  });

  it('reads rows of any stage in any order, including rows larger than a read window', async () => {
    await withDisk(async (disk) => {
      const sizes = [10, 100_000, 300, 70_000, 5];
      for (const [index, bytes] of sizes.entries()) {
        expect(disk.append('completed', batchRow(index, bytes))).toBe(index);
        expect(disk.append('ordered', batchRow(index + 10, bytes))).toBe(index);
      }
      for (const index of [3, 0, 1, 2, 4, 4, 0]) {
        expect(disk.row('completed', index)).toStrictEqual(
          batchRow(index, sizes[index]),
        );
        expect(disk.row('ordered', index)).toStrictEqual(
          batchRow(index + 10, sizes[index]),
        );
      }
      expect(() => disk.row('completed', 5)).toThrow(
        'Missing or invalid provider normalization row',
      );
      expect(() => disk.row('absent', 0)).toThrow(
        'Missing or invalid provider normalization row',
      );
    });
  });

  it('keeps complete rows and keyed updates on a bounded number of files', async () => {
    await withDisk(async (disk, root) => {
      for (let index = 0; index < 512; index++) {
        expect(disk.append('normalized', batchRow(index))).toBe(index);
        disk.setNumber(`call:arbitrary-${index}`, index);
        disk.setPointer(`response:${index}:0`, { row: index, block: 0 });
        disk.setNumber(`call:arbitrary-${index}`, index + 1);
      }
      for (let index = 0; index < 512; index++) {
        expect(disk.row('normalized', index)).toStrictEqual(batchRow(index));
        expect(disk.number(`call:arbitrary-${index}`)).toBe(index + 1);
        expect(disk.pointer(`response:${index}:0`)).toStrictEqual({
          row: index,
          block: 0,
        });
      }
      expect(disk.number('missing')).toBeUndefined();
      const directories = readdirSync(root);
      expect(directories).toHaveLength(1);
      expect(
        readdirSync(join(root, directories[0])).length,
      ).toBeLessThanOrEqual(8);
    });
  });
});
