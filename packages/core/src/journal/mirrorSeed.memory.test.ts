/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { SourceRow } from './groupEdits.js';
import type { JournalStore } from './journalStore.js';
import {
  acceptedCount,
  bigPrimary,
  seedWithProbe,
  SEED_ROWS,
} from './__tests__/support/seedMemory.js';
import { IN_FLIGHT_BOUND_BYTES } from './__tests__/support/compactionMemory.js';
import { rowRecordDigest } from './__tests__/support/mirrorFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const RUN_MS = 170_000;
const DIGEST_EVERY = 997;

describe('late attach memory over 100,000 rows (design 5.3 and 13.4)', () => {
  const directory = useTempDir('journal-seed-memory-');
  const open: JournalStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.close();
  });

  it(
    'keeps the settled heap within the in-flight bound while 40,000 accepted rows are copied, and copies the right rows',
    async () => {
      const primary = await bigPrimary(directory());
      open.push(primary);
      expect(primary.published?.rows).toBe(SEED_ROWS);

      const run = await seedWithProbe(
        primary,
        path.join(directory(), 'mirror.llxj'),
        () => undefined,
      );
      open.push(run.mirror);

      expect(run.accepted).toBe(acceptedCount());
      expect(run.mirror.published?.rows).toBe(acceptedCount());
      expect(run.growth).toBeLessThan(IN_FLIGHT_BOUND_BYTES);

      // Spot-check the copy against the primary: same label, same ROW bytes.
      const primaryRows = new Map<bigint, string>();
      let index = 0;
      for await (const entry of primary.rows()) {
        if (index++ % DIGEST_EVERY === 0) {
          primaryRows.set(entry.label, await rowRecordDigest(primary, entry));
        }
      }
      let checked = 0;
      for await (const entry of run.mirror.rows()) {
        const expected = primaryRows.get(entry.label);
        if (expected === undefined) continue;
        expect(await rowRecordDigest(run.mirror, entry)).toBe(expected);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(10);
    },
    RUN_MS,
  );
  it(
    'trap: a seed that keeps every accepted row it passes is caught by the same bound',
    async () => {
      const primary = await bigPrimary(directory());
      open.push(primary);
      const kept = new Map<bigint, SourceRow>();

      const run = await seedWithProbe(
        primary,
        path.join(directory(), 'trap-mirror.llxj'),
        (row) => {
          kept.set(row.entry.label, {
            source: row.source,
            entry: { ...row.entry },
          });
        },
      );
      open.push(run.mirror);

      expect(kept.size).toBe(acceptedCount());
      expect(run.growth).toBeGreaterThan(IN_FLIGHT_BOUND_BYTES);
    },
    RUN_MS,
  );
});
