/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  COMPACTION_FLOOR_BYTES,
  compactionCandidatePath,
  compactionDue,
  removeStaleCompaction,
} from './compaction.js';
import type { Version } from './version.js';
import { populatedSource } from './__tests__/support/copyFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const MIB = 1024 * 1024;

let versionFiles = 0;

/** A published version with only the numbers the trigger reads (design 4.11). */
async function versionWith(
  directory: string,
  numbers: {
    durableEnd: number;
    liveBytes: number;
    ckptBytes: number;
    rows: number;
  },
): Promise<Version> {
  const store = await populatedSource(
    path.join(directory, `trigger-${versionFiles++}.llxj`),
  );
  const base = store.published;
  if (base === undefined) throw new Error('nothing is published');
  await store.close();
  return {
    ...base,
    durableEnd: numbers.durableEnd,
    ckptBytes: numbers.ckptBytes,
    aggregate: {
      ...base.aggregate,
      rows: numbers.rows,
      liveBytes: numbers.liveBytes,
    },
  };
}

describe('compaction trigger (design 4.11)', () => {
  const directory = useTempDir('journal-compaction-trigger-');
  const rowEstimate = 1550;

  it('fires when the file is more than twice the live estimate plus 64 MiB, and not at the line', async () => {
    const live = 10 * MIB;
    const ckpt = 3 * MIB;
    const rows = 1000;
    const line =
      2 * (live + ckpt + rows * rowEstimate) + COMPACTION_FLOOR_BYTES;
    const at = (durableEnd: number) =>
      versionWith(directory(), {
        durableEnd,
        liveBytes: live,
        ckptBytes: ckpt,
        rows,
      });

    expect(compactionDue(await at(line))).toBe(false);
    expect(compactionDue(await at(line + 1))).toBe(true);
  });

  it('counts retained checkpoint bytes and the per-row estimate on the live side', async () => {
    const base = { durableEnd: 0, liveBytes: 0, ckptBytes: 0, rows: 0 };
    const floorPlus = COMPACTION_FLOOR_BYTES + 1;
    expect(
      compactionDue(
        await versionWith(directory(), { ...base, durableEnd: floorPlus }),
      ),
    ).toBe(true);
    expect(
      compactionDue(
        await versionWith(directory(), {
          ...base,
          durableEnd: floorPlus,
          ckptBytes: 1 * MIB,
        }),
      ),
    ).toBe(false);
    expect(
      compactionDue(
        await versionWith(directory(), {
          ...base,
          durableEnd: floorPlus,
          rows: Math.ceil(MIB / rowEstimate),
        }),
      ),
    ).toBe(false);
  });

  it('never fires below the floor however little is live', async () => {
    const version = await versionWith(directory(), {
      durableEnd: COMPACTION_FLOOR_BYTES,
      liveBytes: 0,
      ckptBytes: 0,
      rows: 0,
    });
    expect(compactionDue(version)).toBe(false);
  });

  it('waits for the re-arm point after a refused swap', async () => {
    const version = await versionWith(directory(), {
      durableEnd: 200 * MIB,
      liveBytes: 0,
      ckptBytes: 0,
      rows: 0,
    });
    expect(compactionDue(version)).toBe(true);
    expect(compactionDue(version, 200 * MIB + 1)).toBe(false);
    expect(compactionDue(version, 200 * MIB)).toBe(true);
  });
});

describe('stale candidate (design 4.11 step 1)', () => {
  const directory = useTempDir('journal-compaction-stale-');

  it('is removed, and its absence is not an error', async () => {
    const file = path.join(directory(), 'session.llxj');
    await removeStaleCompaction(file);
    await fsp.writeFile(compactionCandidatePath(file), 'half a copy');
    await removeStaleCompaction(file);
    await expect(fsp.stat(compactionCandidatePath(file))).rejects.toThrow(
      'ENOENT',
    );
  });
});
