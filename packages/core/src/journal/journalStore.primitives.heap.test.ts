/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { RowDraft } from './rowDraft.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { JournalStore } from './journalStore.js';
import { LABEL_STEP, labelBetween } from './labels.js';
import type { RowEntry } from './rowEntry.js';
import type { Version } from './version.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { MIB, startGrowthProbe } from './__tests__/support/streamedBody.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const BASE_ROWS = 10_000;
const GROUPS = 1000;
const SAMPLES = 4;
const GROWTH_BOUND = 4 * MIB;
const RUN_MS = 170_000;
/** Every tenth base row has a call id, so the id trie is not empty. */
const ID_EVERY = 10;
const OWNER_COUNT = 5;
/** The group that is a density change, which rebuilds the facts of all rows. */
const DENSITY_AT = 500;
/** The group that is a compression of the first rows, which rebuilds them too. */
const COMPRESS_AT = 200;
const COMPRESSED_ROWS = 5;
const SCHEDULE = [
  'append',
  'pop',
  'owner',
  'fill',
  'purge',
  'insert',
  'checkpoint',
  'append-two',
  'pop-two',
  'owner-three',
] as const;
type Primitive = (typeof SCHEDULE)[number] | 'density' | 'compress';

interface TrackedRow {
  label: bigint;
  owner: number;
  hasIds: boolean;
}

function published(store: JournalStore): Version {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

function* baseDrafts(): Generator<RowDraft> {
  for (let index = 0; index < BASE_ROWS; index++) {
    yield draftRow({
      owner: index % OWNER_COUNT,
      text: `base ${index}`,
      calls: index % ID_EVERY === 0 ? [`base-${index}`] : [],
    });
  }
}

/**
 * Drives a store through groups of every kind of primitive and keeps the
 * labels and owners the store must hold.
 */
class MixedGroups {
  readonly rows: TrackedRow[] = [];
  private readonly random = new SeededRandom(854);
  private appended: bigint[] = [];

  constructor(private readonly store: JournalStore) {}

  async build(): Promise<void> {
    await this.store.commit([{ kind: 'replace', rows: baseDrafts() }]);
    for await (const entry of this.store.rows()) {
      this.rows.push({
        label: entry.label,
        owner: entry.owner,
        hasIds: this.rows.length % ID_EVERY === 0,
      });
    }
  }

  primitiveOf(group: number): Primitive {
    if (group === DENSITY_AT) return 'density';
    if (group === COMPRESS_AT) return 'compress';
    return SCHEDULE[(group - 1) % SCHEDULE.length];
  }

  async run(primitive: Primitive, group: number): Promise<void> {
    switch (primitive) {
      case 'append':
        return this.append(1, group);
      case 'append-two':
        return this.append(2, group);
      case 'pop':
      case 'pop-two':
        return this.popAppended();
      case 'owner':
        return this.changeOwners(1, group);
      case 'owner-three':
        return this.changeOwners(3, group);
      case 'fill':
        return this.fill(group);
      case 'purge':
        return this.rewrite('purge', group);
      case 'density':
        return this.rewrite('density', group);
      case 'insert':
        return this.insert(group);
      case 'checkpoint':
        return this.checkpoint(group);
      case 'compress':
        return this.compress(group);
      default: {
        const unknown: never = primitive;
        throw new Error(`Unknown primitive ${String(unknown)}`);
      }
    }
  }

  private pickIndex(): number {
    return this.random.int(this.rows.length);
  }

  private pickRowWithoutIds(): TrackedRow {
    for (;;) {
      const row = this.rows[this.pickIndex()];
      if (!row.hasIds) return row;
    }
  }

  private async append(count: number, group: number): Promise<void> {
    const first = published(this.store).nextLabel;
    const owner = group % OWNER_COUNT;
    const drafts = Array.from({ length: count }, (_, at) =>
      draftRow({ owner, text: `append ${group}.${at}` }),
    );
    await this.store.commit([{ kind: 'append', rows: drafts }]);
    const added = drafts.map((_, at) => ({
      label: first + BigInt(at) * LABEL_STEP,
      owner,
      hasIds: false,
    }));
    this.rows.push(...added);
    this.appended = added.map((row) => row.label);
  }

  private async popAppended(): Promise<void> {
    const cut = this.appended[0];
    const removed = this.appended.length;
    await this.store.commit([
      { kind: 'pop', cutLabel: cut, expectedRemoved: removed },
    ]);
    this.rows.length -= removed;
    this.appended = [];
  }

  private async changeOwners(count: number, group: number): Promise<void> {
    const chosen = new Set<TrackedRow>();
    while (chosen.size < count) chosen.add(this.rows[this.pickIndex()]);
    const owner = group % (OWNER_COUNT + 2);
    await this.store.commit([
      {
        kind: 'owner',
        changes: [...chosen].map((row) => ({ label: row.label, owner })),
      },
    ]);
    for (const row of chosen) row.owner = owner;
  }

  private async fill(group: number): Promise<void> {
    const row = this.rows[this.pickIndex()];
    await this.store.commit([
      {
        kind: 'fill',
        fills: [{ label: row.label, lensRef: [group, 0, 0] }],
      },
    ]);
  }

  /** A row without ids rewritten under its own label: in place for a purge, a rebuild for a density change. */
  private async rewrite(
    kind: 'purge' | 'density',
    group: number,
  ): Promise<void> {
    const row = this.pickRowWithoutIds();
    const draft = draftRow({ owner: row.owner, text: `${kind} ${group}` });
    if (kind === 'purge') {
      await this.store.commit([
        { kind: 'purge', rows: [{ label: row.label, draft }] },
      ]);
    } else {
      await this.store.commit([
        {
          kind: 'density',
          replacements: [{ label: row.label, draft }],
          removed: [],
        },
      ]);
    }
  }

  private async insert(group: number): Promise<void> {
    for (;;) {
      const at = this.pickIndex();
      const after = this.rows[at];
      const upper = published(this.store).nextLabel;
      const next = at + 1 < this.rows.length ? this.rows[at + 1].label : upper;
      const label = labelBetween(after.label, next);
      if (label === undefined) continue;
      await this.store.commit([
        {
          kind: 'insert',
          afterLabel: after.label,
          draft: draftRow({
            owner: group % OWNER_COUNT,
            text: `insert ${group}`,
          }),
        },
      ]);
      this.rows.splice(at + 1, 0, {
        label,
        owner: group % OWNER_COUNT,
        hasIds: false,
      });
      return;
    }
  }

  private async checkpoint(group: number): Promise<void> {
    await this.store.commit([
      {
        kind: 'checkpoint',
        id: `c${group}`,
        name: `checkpoint ${group}`,
        createdAtMs: 1_900_000_000_000 + group,
      },
    ]);
  }

  private async compress(group: number): Promise<void> {
    const retain = this.rows[COMPRESSED_ROWS].label;
    await this.store.commit([
      {
        kind: 'compress',
        summary: draftRow({ owner: 1, text: `summary ${group}` }),
        retainFromLabel: retain,
        expectedReplaced: COMPRESSED_ROWS,
      },
    ]);
    this.rows.splice(0, COMPRESSED_ROWS, {
      label: retain - 1n,
      owner: 1,
      hasIds: false,
    });
  }
}

async function entriesOf(store: JournalStore): Promise<RowEntry[]> {
  const found: RowEntry[] = [];
  for await (const entry of store.rows()) found.push(entry);
  return found;
}

describe('journal store heap over mixed primitive groups', () => {
  const directory = useTempDir('journal-primitives-heap-');
  const open: JournalStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.close();
  });

  interface Result {
    readonly growth: number;
    readonly caches: readonly BoundedIdNodeCache[];
    readonly store: JournalStore;
    readonly groups: MixedGroups;
    readonly counts: ReadonlyMap<Primitive, number>;
  }

  /**
   * Builds a base of 10,000 rows in one streamed replace, then runs 1,000
   * groups that cycle through append, pop, owner change, fill, purge, insert,
   * checkpoint and the rest, with one density change and one compression in
   * between. `retain` is called with the store after each group.
   */
  async function drive(
    name: string,
    retain: (store: JournalStore) => Promise<void>,
  ): Promise<Result> {
    const caches: BoundedIdNodeCache[] = [];
    const createCache = (): IdNodeCache => {
      const cache = new BoundedIdNodeCache();
      caches.push(cache);
      return cache;
    };
    const store = await JournalStore.create(
      path.join(directory(), name),
      storeDeps({ createCache }),
    );
    open.push(store);
    const groups = new MixedGroups(store);
    await groups.build();
    const probe = await startGrowthProbe();
    const counts = new Map<Primitive, number>();
    const every = GROUPS / SAMPLES;
    for (let group = 1; group <= GROUPS; group++) {
      const primitive = groups.primitiveOf(group);
      await groups.run(primitive, group);
      counts.set(primitive, (counts.get(primitive) ?? 0) + 1);
      await retain(store);
      if (group % every === 0) await probe.sample();
    }
    return { growth: probe.peakGrowth(), caches, store, groups, counts };
  }

  it(
    'keeps the settled heap flat over 1,000 mixed groups on a 10,000-row base, with every cache under its cap and the rows equal to the model',
    async () => {
      const result = await drive('flat.llxj', () => Promise.resolve());

      expect(result.growth).toBeLessThan(GROWTH_BOUND);
      for (const cache of result.caches) {
        expect(cache.bytes).toBeLessThanOrEqual(cache.capBytes);
      }
      for (const primitive of [...SCHEDULE, 'density', 'compress'] as const) {
        expect(result.counts.get(primitive)).toBeGreaterThan(0);
      }
      const entries = await entriesOf(result.store);
      expect(
        entries.map((entry) => ({ l: entry.label, o: entry.owner })),
      ).toStrictEqual(
        result.groups.rows.map((row) => ({ l: row.label, o: row.owner })),
      );
      expect(published(result.store).rows).toBe(result.groups.rows.length);
    },
    RUN_MS,
  );

  it(
    'trap: a store that keeps the leading rows it reads after every group fails the same bound',
    async () => {
      const kept: RowEntry[][] = [];
      const result = await drive('trap.llxj', async (store) => {
        const leading: RowEntry[] = [];
        for await (const entry of store.rows()) {
          leading.push(entry);
          if (leading.length === 64) break;
        }
        kept.push(leading);
      });
      expect(kept).toHaveLength(GROUPS);
      expect(result.growth).toBeGreaterThan(GROWTH_BOUND);
    },
    RUN_MS,
  );
});
