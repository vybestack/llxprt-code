/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { selectScaleCases } from '@vybestack/llxprt-code-test-utils/core/scale-test-lane.js';
import type { SourceRow } from './groupEdits.js';
import type { JournalStore } from './journalStore.js';
import {
  acceptedCount,
  bigPrimary,
  seedWithProbe,
  SEED_ROWS,
} from './__tests__/support/seedMemory.js';
import { FLATNESS_BOUND_BYTES } from './__tests__/support/compactionMemory.js';
import { rowRecordDigest } from './__tests__/support/mirrorFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const RUN_MS = 180_000;
const DIGEST_EVERY = 97;

describe('late attach memory (design 5.3 and 13.4)', () => {
  const directory = useTempDir('journal-seed-memory-');
  const open: JournalStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.close();
  });

  async function measure(size: number, retaining: boolean): Promise<number> {
    const primary = await bigPrimary(directory(), size);
    open.push(primary);
    const kept = new Map<bigint, SourceRow>();
    const run = await seedWithProbe(
      primary,
      path.join(directory(), `mirror-${size}.llxj`),
      (row) => {
        if (retaining)
          kept.set(row.entry.label, {
            source: row.source,
            entry: { ...row.entry },
          });
      },
    );
    open.push(run.mirror);
    expect(primary.published?.rows).toBe(size);
    expect(run.accepted).toBe(acceptedCount(size));
    expect(run.mirror.published?.rows).toBe(acceptedCount(size));
    expect(kept.size).toBe(retaining ? acceptedCount(size) : 0);
    process.stdout.write(
      `MIRROR_SEED_MEMORY ${JSON.stringify({ size, retaining, growth: run.growth, series: run.series, held: kept.size })}\n`,
    );
    await verifyRows(primary, run.mirror);
    return run.growth;
  }

  async function verifyRows(
    primary: JournalStore,
    mirror: JournalStore,
  ): Promise<void> {
    const primaryRows = new Map<bigint, string>();
    let index = 0;
    for await (const entry of primary.rows()) {
      if (index++ % DIGEST_EVERY === 0)
        primaryRows.set(entry.label, await rowRecordDigest(primary, entry));
    }
    let checked = 0;
    for await (const entry of mirror.rows()) {
      const expected = primaryRows.get(entry.label);
      if (expected === undefined) continue;
      expect(await rowRecordDigest(mirror, entry)).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  }

  it(
    'keeps in-flight growth flat as the source grows',
    async () => {
      const sizes = selectScaleCases([10_000, SEED_ROWS], [100_000]);
      const measurements: number[] = [];
      for (const size of sizes) measurements.push(await measure(size, false));
      expect(
        Math.max(...measurements) - Math.min(...measurements),
      ).toBeLessThan(FLATNESS_BOUND_BYTES);
    },
    RUN_MS,
  );

  it(
    'rejects a seed retaining every accepted row under the same growth bound',
    async () => {
      const small = await measure(10_000, true);
      const large = await measure(SEED_ROWS, true);
      expect(large - small).toBeGreaterThan(FLATNESS_BOUND_BYTES);
    },
    RUN_MS,
  );
});
