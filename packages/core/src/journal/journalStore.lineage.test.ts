/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { Triple } from './bytes.js';
import { JournalStore } from './journalStore.js';
import { LineageChain } from './lineageChain.js';
import { MUTATION, type MutationCode } from './recordKinds.js';
import { mutationKeepsLineage, type Version } from './version.js';
import {
  ArrayModel,
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

/** Design 2.5: ancestors 8, 64 and 512 parent hops back. */
const DESIGN_HOPS = [8, 64, 512] as const;

/** The skip pointer at `depth` for the ancestor `hops` back; trailer offsets are 1000 + depth. */
function expectedSkip(depth: number, hops: number): number {
  return depth >= hops ? 1000 + depth - hops : 0;
}

function expectedSkips(depth: number): Triple<number> {
  return [
    expectedSkip(depth, DESIGN_HOPS[0]),
    expectedSkip(depth, DESIGN_HOPS[1]),
    expectedSkip(depth, DESIGN_HOPS[2]),
  ];
}

function published(store: JournalStore): Version {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

async function ancestorHops(
  store: JournalStore,
  from: Version,
  hops: number,
): Promise<number> {
  let at = from;
  for (let step = 0; step < hops; step++)
    at = await store.readVersion(at.parent);
  return at.selfOffset;
}

describe('lineage rule (design 4.3 and 4.10)', () => {
  it('keeps the lineage for append, pop, fill and state, and starts a new one for every other group', () => {
    const keeps: MutationCode[] = [
      MUTATION.append,
      MUTATION.pop,
      MUTATION.fill,
      MUTATION.state,
    ];
    for (const code of Object.values(MUTATION)) {
      expect({ code, keeps: mutationKeepsLineage(code) }).toStrictEqual({
        code,
        keeps: keeps.includes(code),
      });
    }
  });

  it('chain: names ancestors 8, 64 and 512 hops back and holds a bounded window', () => {
    let chain = LineageChain.NONE;
    for (let depth = 0; depth < 2000; depth++) {
      expect(chain.skipsForChild()).toStrictEqual(expectedSkips(depth));
      chain = chain.push(1000 + depth);
    }
    expect(chain.topDepth).toBe(1999);
    expect(chain.offsetAtDepth(1999 - 511)).toBe(1000 + 1999 - 511);
    expect(chain.offsetAtDepth(1999 - 600)).toBeUndefined();
  });

  describe('on a store', () => {
    const directory = useTempDir('journal-lineage-');
    const file = (name: string) => path.join(directory(), name);

    it('fills skip pointers with the ancestors 8, 64 and 512 parent hops back', async () => {
      const store = await JournalStore.create(file('skips.llxj'), storeDeps());
      for (let at = 0; at < 600; at++) {
        await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      }
      const top = published(store);
      expect(top.lineageDepth).toBe(599);
      for (const [index, hops] of DESIGN_HOPS.entries()) {
        expect(top.skip[index]).toBe(await ancestorHops(store, top, hops));
      }
      const early = await store.readVersion(
        await ancestorHops(store, top, 150),
      );
      expect(early.lineageDepth).toBe(449);
      expect(early.skip[2]).toBe(0);
      expect(early.skip[1]).toBe(
        await ancestorHops(store, early, DESIGN_HOPS[1]),
      );
      await store.close();
    });

    it('a pop far back lands in a few reads by the skip pointers and keeps the lineage', async () => {
      const reads = { reads: 0 };
      const seams = testJournalSeams({ readCounter: reads });
      const store = await JournalStore.create(
        file('deep.llxj'),
        storeDeps({ seams }),
      );
      const model = new ArrayModel();
      for (let at = 0; at < 600; at++) {
        await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      }
      model.append(600);
      const lineage = published(store).lineage;
      const cut = model.liveLabels[10];
      const removed = model.popFrom(cut);

      const before = reads.reads;
      await store.commit([
        { kind: 'pop', cutLabel: cut, expectedRemoved: removed },
      ]);
      const spent = reads.reads - before;

      const now = published(store);
      expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
      expect(now.lineage).toBe(lineage);
      expect(now.rows).toBe(10);
      expect(now.lineageDepth).toBe(9);
      // A walk by parent alone would read 590 trailers.
      expect(spent).toBeLessThan(80);
      await store.close();
    });

    it('state-only groups keep the lineage, while clear and restore start one', async () => {
      const store = await JournalStore.create(file('rule.llxj'), storeDeps());
      await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      const first = published(store);
      await store.commit([
        { kind: 'setState', key: 'title', value: new Uint8Array([1]) },
      ]);
      const state = published(store);
      expect(state.mutation).toBe(MUTATION.state);
      expect(state.lineage).toBe(first.lineage);
      expect(state.parent).toBe(first.selfOffset);
      expect(state.lineageDepth).toBe(first.lineageDepth + 1);

      await store.commit([{ kind: 'clear' }]);
      const cleared = published(store);
      expect(cleared.lineage).not.toBe(state.lineage);
      expect(cleared.parent).toBe(0);

      await store.commit([{ kind: 'restore', saved: first }]);
      const restored = published(store);
      expect(restored.lineage).not.toBe(cleared.lineage);
      expect(restored.parent).toBe(0);
      await store.close();
    });

    it('matches an array model over random appends, pops, clears and restores', async () => {
      for (const seed of [1, 2, 3]) {
        const store = await JournalStore.create(
          file(`random-${seed}.llxj`),
          storeDeps(),
        );
        const random = new SeededRandom(seed);
        const model = new ArrayModel();
        const saved: Array<{ version: Version; labels: bigint[] }> = [];
        for (let step = 0; step < 90; step++) {
          const roll = random.int(10);
          if (roll < 5 || model.liveLabels.length === 0) {
            const count = 1 + random.int(4);
            model.append(count);
            await store.commit([
              {
                kind: 'append',
                rows: Array.from({ length: count }, () => draftRow()),
              },
            ]);
          } else if (roll < 8) {
            const at = random.int(model.liveLabels.length);
            const cut = model.liveLabels[at];
            const removed = model.popFrom(cut);
            await store.commit([
              { kind: 'pop', cutLabel: cut, expectedRemoved: removed },
            ]);
          } else if (roll === 8 && saved.length > 0) {
            const pick = saved[random.int(saved.length)];
            model.replaceWith(pick.labels);
            await store.commit([{ kind: 'restore', saved: pick.version }]);
          } else {
            model.clear();
            await store.commit([{ kind: 'clear' }]);
          }
          expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
          expect(published(store).rows).toBe(model.liveLabels.length);
          expect(published(store).nextLabel).toBe(model.nextLabel);
          saved.push({
            version: published(store),
            labels: [...model.liveLabels],
          });
        }
        await store.close();
        const reopened = await JournalStore.open(
          file(`random-${seed}.llxj`),
          storeDeps(),
        );
        expect(await labelsOf(reopened)).toStrictEqual([...model.liveLabels]);
        await reopened.close();
      }
    });
  });
});
