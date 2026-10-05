/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderNormalizationDisk } from './provider-normalization-disk.js';
import { batchRow } from './addbatch-stream-test-helpers.js';

async function withDisk(
  action: (disk: ProviderNormalizationDisk, root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(
    join(process.cwd(), 'tmp/provider-normalization-io-'),
  );
  const disk = new ProviderNormalizationDisk(root);
  try {
    await action(disk, root);
  } finally {
    disk.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('provider normalization bounded filesystem work', () => {
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
