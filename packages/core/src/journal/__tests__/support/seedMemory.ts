/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import type { SourceRow, VersionEdit } from '../../groupEdits.js';
import { JournalStore } from '../../journalStore.js';
import { resyncEdits } from '../../mirrorApply.js';
import type { RowDraft } from '../../rowDraft.js';
import { draftRow, storeDeps } from './storeFixtures.js';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { accessOf } from './pinnedAccess.js';

export const SEED_ROWS = 100_000;
/** Rows are owned by 0 to 4 in turn; the mirror of owner 2 takes the rows of 2 and of 0. */
export const OWNER_COUNT = 5;
export const MIRROR_OWNER = 2;
/**
 * A tool-heavy history: every twentieth row calls an id and the row ten after it
 * answers it. Both rows have the same owner, so the mirror of owner 2 copies
 * both and the seed rebuilds the id facts of 5,000 ids.
 */
const ID_PERIOD = 20;
const RESPONSE_OFFSET = 10;
const SAMPLES = 4;

function* baseDrafts(): Generator<RowDraft> {
  for (let index = 0; index < SEED_ROWS; index++) {
    const pair = Math.floor(index / ID_PERIOD);
    const slot = index % ID_PERIOD;
    yield draftRow({
      owner: index % OWNER_COUNT,
      text: `base ${index}`,
      calls: slot === 0 ? [`call_${pair}_abcdefghijklmnop`] : [],
      responses:
        slot === RESPONSE_OFFSET ? [`call_${pair}_abcdefghijklmnop`] : [],
    });
  }
}

export async function bigPrimary(directory: string): Promise<JournalStore> {
  const primary = await JournalStore.create(
    path.join(directory, 'primary.llxj'),
    storeDeps(),
  );
  await primary.commit([{ kind: 'replace', rows: baseDrafts() }]);
  return primary;
}

export function acceptedCount(): number {
  let count = 0;
  for (let index = 0; index < SEED_ROWS; index++) {
    const owner = index % OWNER_COUNT;
    if (owner === 0 || owner === MIRROR_OWNER) count += 1;
  }
  return count;
}

/**
 * What the seed does with each accepted row as it passes: the flat run only
 * samples the heap, and the trap run also keeps the row.
 */
export type SeedObserver = (row: SourceRow, seen: number) => void;

export interface SeedRun {
  readonly mirror: JournalStore;
  /** The largest settled growth over the baseline. */
  readonly growth: number;
  /** The settled growth at each sample, in order. */
  readonly series: readonly number[];
  readonly accepted: number;
}

/**
 * Seeds a new mirror from the published primary the way a late attach does,
 * with the row stream watched: the settled heap is sampled four times while
 * the rows pass, against a baseline taken after the primary was built.
 */
export async function seedWithProbe(
  primary: JournalStore,
  mirrorFile: string,
  observe: SeedObserver,
): Promise<SeedRun> {
  const version = primary.published;
  if (version === undefined) throw new Error('nothing is published');
  const mirror = await JournalStore.create(mirrorFile, storeDeps());
  // One unwatched copy first, so the caches and compiled code of the copy are
  // warm and the baseline is not taken before they fill.
  const warm = await JournalStore.create(`${mirrorFile}.warm`, storeDeps());
  await warm.commit(
    resyncEdits(
      { store: warm, owner: MIRROR_OWNER },
      { version, access: await accessOf(primary) },
    ),
  );
  await warm.close();
  const baseline = await settledHeap();
  const series: number[] = [];
  const sample = async (): Promise<void> => {
    series.push((await settledHeap()) - baseline);
  };
  const every = Math.floor(acceptedCount() / SAMPLES);
  let seen = 0;
  const [edit] = resyncEdits(
    { store: mirror, owner: MIRROR_OWNER },
    { version, access: await accessOf(primary) },
  );
  if (edit.kind !== 'adoptAll') throw new Error('a seed adopts all rows');
  const source = edit.rows;
  async function* watched(): AsyncGenerator<SourceRow> {
    for await (const row of source) {
      seen += 1;
      observe(row, seen);
      if (seen % every === 0) await sample();
      yield row;
    }
  }
  const watchedEdit: VersionEdit = { ...edit, rows: watched() };
  await mirror.commit([watchedEdit]);
  await sample();
  return { mirror, growth: Math.max(...series), series, accepted: seen };
}
