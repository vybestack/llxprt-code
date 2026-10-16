/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { MUTATION } from './recordKinds.js';
import type { Version } from './version.js';
import {
  appendEach,
  draftRow,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import {
  StoreModel,
  type ModelRow,
  type Step,
} from './__tests__/support/storeModel.js';
import { expectStoreMatchesModel } from './__tests__/support/storeModelChecks.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const PRIMITIVES = [
  'compress',
  'replace',
  'density',
  'purge',
  'insert',
  'owner',
] as const;
type Primitive = (typeof PRIMITIVES)[number];

const SEEDS = [1, 2, 3, 4, 5, 6] as const;
const GROWN_ROWS = 8;

function startingStep(primitive: Primitive, model: StoreModel): Step {
  switch (primitive) {
    case 'compress':
      return model.stepCompress(3);
    case 'replace':
      return model.stepReplace(6);
    case 'density':
      return model.stepDensity();
    case 'purge':
      return model.stepPurge();
    case 'insert': {
      const step = model.stepInsert();
      if (step === undefined) throw new Error('no label between two rows');
      return step;
    }
    case 'owner':
      return model.stepOwner();
    default: {
      const unknown: never = primitive;
      throw new Error(`Unknown primitive ${String(unknown)}`);
    }
  }
}

function published(store: JournalStore): Version {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

/** What a row shows of the content and owner a pop must keep. */
function keyOf(row: ModelRow): string {
  return `${row.label}:${row.owner}:${row.seq}`;
}

describe('a pop never crosses a lineage start (design 4.3 and 4.10)', () => {
  const directory = useTempDir('journal-lineage-pop-');

  interface Run {
    /** Whether the rows before the starting group would be wrong answers for the pop below it. */
    readonly ancestorWouldBeWrong: boolean;
  }

  async function run(primitive: Primitive, seed: number): Promise<Run> {
    const file = path.join(directory(), `${primitive}-${seed}.llxj`);
    const model = new StoreModel(new SeededRandom(seed));
    const store = await JournalStore.create(file, storeDeps());
    const commit = async (step: Step): Promise<void> => {
      await store.commit(step.edits);
      model.endGroup(step);
    };

    while (model.rows.length < GROWN_ROWS) await commit(model.stepAppend());
    const before = published(store);
    const rowsBefore = [...model.rows];

    await commit(startingStep(primitive, model));
    const start = published(store);
    expect(start.lineage).not.toBe(before.lineage);
    expect(start.lineage).toBe(BigInt(start.commitSeq));
    expect(start.parent).toBe(0);
    expect(start.lineageDepth).toBe(0);
    const keep = Math.floor(start.rows / 2);
    expect(keep).toBeGreaterThanOrEqual(1);
    expect(keep).toBeLessThan(start.rows);

    // A pop that lands on the lineage start itself stays in the lineage.
    await commit(model.stepAppend());
    await commit(model.stepAppend());
    await commit(model.stepPopAt(start.rows));
    const atStart = published(store);
    expect(atStart.mutation).toBe(MUTATION.pop);
    expect(atStart.lineage).toBe(start.lineage);
    expect(atStart.rows).toBe(start.rows);
    await expectStoreMatchesModel(store, model);

    // A pop below it cannot be answered by an ancestor, so the kept rows are rebuilt.
    await commit(model.stepAppend());
    const answer = model.rows.slice(0, keep).map(keyOf);
    await commit(model.stepPopAt(keep));
    const below = published(store);
    expect(below.mutation).toBe(MUTATION.pop);
    expect(below.rows).toBe(keep);
    expect(below.lineage).not.toBe(start.lineage);
    expect(below.lineage).toBe(BigInt(below.commitSeq));
    expect(below.parent).toBe(0);
    await expectStoreMatchesModel(store, model);

    await store.close();
    const reopened = await JournalStore.open(file, storeDeps());
    await expectStoreMatchesModel(reopened, model);
    await reopened.close();

    return {
      ancestorWouldBeWrong:
        rowsBefore.slice(0, keep).map(keyOf).join() !== answer.join(),
    };
  }

  for (const primitive of PRIMITIVES) {
    it(`rebuilds the kept rows for a pop below a lineage started by ${primitive}, and matches the array model`, async () => {
      let wrong = 0;
      for (const seed of SEEDS) {
        const result = await run(primitive, seed);
        if (result.ancestorWouldBeWrong) wrong += 1;
      }
      // The control: restoring the version before the group would have given other rows.
      expect(wrong).toBeGreaterThan(0);
    }, 120_000);
  }

  describe('directed cases', () => {
    const file = (name: string) => path.join(directory(), name);

    async function sixRows(name: string): Promise<JournalStore> {
      const store = await JournalStore.create(file(name), storeDeps());
      await appendEach(
        store,
        scenarioDrafts().map((draft) => ({ ...draft, owner: 1 })),
      );
      return store;
    }

    async function owners(store: JournalStore): Promise<number[]> {
      const found: number[] = [];
      for await (const entry of store.rows()) found.push(entry.owner);
      return found;
    }

    async function labels(store: JournalStore): Promise<bigint[]> {
      const found: bigint[] = [];
      for await (const entry of store.rows()) found.push(entry.label);
      return found;
    }

    it('keeps an owner change when a pop lands below it', async () => {
      const store = await sixRows('owner.llxj');
      const live = await labels(store);
      await store.commit([
        { kind: 'owner', changes: [{ label: live[1], owner: 9 }] },
      ]);
      await appendEach(store, [draftRow({ owner: 1 }), draftRow({ owner: 1 })]);

      await store.commit([
        { kind: 'pop', cutLabel: live[3], expectedRemoved: 5 },
      ]);

      expect(await owners(store)).toStrictEqual([1, 9, 1]);
      expect(await labels(store)).toStrictEqual(live.slice(0, 3));
      expect(published(store).lineage).toBe(BigInt(published(store).commitSeq));
      await store.close();
    });

    it('keeps a synthetic insert when a pop lands below it', async () => {
      const store = await sixRows('insert.llxj');
      const live = await labels(store);
      await store.commit([
        {
          kind: 'insert',
          afterLabel: live[1],
          draft: draftRow({ owner: 4, text: 'inserted' }),
        },
      ]);
      await appendEach(store, [draftRow({ owner: 1 })]);
      const withInsert = await labels(store);
      expect(withInsert).toHaveLength(8);

      await store.commit([
        { kind: 'pop', cutLabel: withInsert[4], expectedRemoved: 4 },
      ]);

      const kept = await labels(store);
      expect(kept).toStrictEqual(withInsert.slice(0, 4));
      expect(kept[2] > live[1] && kept[2] < live[2]).toBe(true);
      expect(await owners(store)).toStrictEqual([1, 1, 4, 1]);
      await store.close();
    });
  });
});
