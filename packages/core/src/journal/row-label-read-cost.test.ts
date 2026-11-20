/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  createTreeWriter,
  openTree,
} from './__tests__/support/rowTreeHarness.js';
import {
  syntheticEntry,
  NO_KINDS,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import {
  entriesByLabels,
  indexedEntriesByLabels,
} from './row-label-queries.js';

import { planGroup } from './groupPlan.js';
import { versionOf } from './version.js';
describe('ordered row label reads', () => {
  const directory = useTempDir('row-label-read-cost-');

  it.each([64, 512, 4096])(
    'reads the union of paths for %i labels once',
    async (count) => {
      const random = new SeededRandom(1);
      const entries = Array.from({ length: count }, (_, index) =>
        syntheticEntry(random, index, NO_KINDS),
      );
      const file = join(directory(), `${count}.llxj`);
      const writer = await createTreeWriter(file, NO_KINDS);
      await writer.appendRows(entries);
      await writer.close();
      const { reader, root } = await openTree(file);
      try {
        let reads = 0;
        const access = {
          ...reader,
          readRecordHead: (
            ...args: Parameters<typeof reader.readRecordHead>
          ) => {
            reads += 1;
            return reader.readRecordHead(...args);
          },
        };
        const labels = [
          0n,
          ...entries.flatMap((entry) => [entry.label, entry.label + 1n]),
        ];
        const found = [];
        for await (const entry of entriesByLabels(access, root, labels))
          found.push(entry);
        expect(found).toStrictEqual([
          undefined,
          ...entries.flatMap((entry) => [entry, undefined]),
        ]);
        expect(reads).toBeLessThanOrEqual(Math.ceil(count / 7));
        const sparse = [7, count - 2];
        const indexed = [];
        for await (const found of indexedEntriesByLabels(
          access,
          root,
          sparse.map((ordinal) => entries[ordinal].label),
        ))
          indexed.push(found);
        expect(indexed).toStrictEqual(
          sparse.map((ordinal) => ({ entry: entries[ordinal], ordinal })),
        );
        const empty = [];
        for await (const found of entriesByLabels(access, undefined, labels))
          empty.push(found);
        expect(empty).toStrictEqual(labels.map(() => undefined));
        await expect(
          indexedEntriesByLabels(access, root, [2n, 1n]).next(),
        ).rejects.toThrow('ascend strictly');

        const trailer = reader.trailer;
        if (trailer === undefined) throw new Error('Missing test tree');
        const version = versionOf(trailer);
        reads = 0;
        const plan = await planGroup(
          {
            access,
            published: version,
            firstNextLabel: version.nextLabel,
            readVersion: async () => version,
            readState: async () => undefined,
          },
          [
            {
              kind: 'owner',
              changes: entries.map((entry) => ({
                label: entry.label,
                owner: 17,
              })),
            },
          ],
        );
        expect(plan.segments).toStrictEqual(
          entries.map((entry) => ({
            kind: 'entry',
            entry: { ...entry, owner: 17 },
          })),
        );
        expect(reads).toBeLessThanOrEqual(Math.ceil(count / 7) + 10);
      } finally {
        await reader.close();
      }
    },
  );
});
