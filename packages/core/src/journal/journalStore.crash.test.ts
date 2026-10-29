/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { RowDraft } from './rowDraft.js';
import { JournalStore } from './journalStore.js';
import { LABEL_STEP } from './labels.js';
import { ROW_FLAG, ROW_SPEAKER } from './rowRecord.js';
import {
  testJournalSeams,
  type JournalEvent,
} from './__tests__/support/journalFixtures.js';
import {
  appendEach,
  draftRow,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import {
  snapshotStore,
  type StoreSnapshot,
} from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

/** The ids the history and the replacement use; the replacement reuses `a` and drops `b` to `d`. */
const IDS = ['a', 'b', 'c', 'd', 'x'] as const;
const REPLACEMENT_OWNERS = [7, 8, 9] as const;

function replacementDrafts(): RowDraft[] {
  return [
    draftRow({ owner: 7, text: 'new zero' }),
    draftRow({
      owner: 8,
      speaker: ROW_SPEAKER.ai,
      calls: ['a', 'x'],
      flags: ROW_FLAG.responseParent,
      parentEndpoint: 7n,
    }),
    draftRow({ owner: 9, speaker: ROW_SPEAKER.tool, responses: ['a'] }),
  ];
}

async function* streamOf(
  drafts: readonly RowDraft[],
): AsyncGenerator<RowDraft> {
  for (const draft of drafts) yield draft;
}

interface ReplaceGroup {
  /** The file as it was before the replace group and after it. */
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  readonly previous: StoreSnapshot;
  readonly next: StoreSnapshot;
  /** The writes the replace group made, in the order the writer made them. */
  readonly writes: ReadonlyArray<{ position: number; length: number }>;
}

type WriteEvent = Extract<JournalEvent, { type: 'write' }>;

/**
 * A store with history that has appends, an owner change and a fill, then a
 * replace group that streams new rows and reuses an id of the old history.
 */
async function buildReplaceGroup(directory: string): Promise<ReplaceGroup> {
  const file = path.join(directory, 'source.llxj');
  const seams = testJournalSeams();
  const store = await JournalStore.create(file, storeDeps({ seams }));
  await appendEach(
    store,
    scenarioDrafts().map((draft, index) => ({ ...draft, owner: index % 3 })),
  );
  const labels: bigint[] = [];
  for await (const entry of store.rows()) labels.push(entry.label);
  await store.commit([
    { kind: 'owner', changes: [{ label: labels[2], owner: 5 }] },
  ]);
  await store.commit([
    {
      kind: 'fill',
      fills: [{ label: labels[1], lensRef: [11, 0, 0] }],
    },
  ]);
  const previous = await snapshotStore(store, IDS);
  const before = new Uint8Array(await fsp.readFile(file));
  const mark = seams.events.length;

  await store.commit([
    { kind: 'replace', rows: streamOf(replacementDrafts()) },
  ]);

  const next = await snapshotStore(store, IDS);
  await store.close();
  const writes = seams.events
    .slice(mark)
    .filter((event): event is WriteEvent => event.type === 'write');
  return {
    before,
    after: new Uint8Array(await fsp.readFile(file)),
    previous,
    next,
    writes,
  };
}

/** Opens `bytes` as the owner of a journal file and returns what it shows and how big the file is afterwards. */
async function openAsOwner(
  directory: string,
  bytes: Uint8Array,
): Promise<{ snapshot: StoreSnapshot; sizeAfter: number }> {
  const file = path.join(directory, 'copy.llxj');
  await fsp.writeFile(file, bytes);
  const store = await JournalStore.open(file, storeDeps());
  const snapshot = await snapshotStore(store, IDS);
  await store.close();
  return { snapshot, sizeAfter: (await fsp.stat(file)).size };
}

describe('a replace group on a store with history (design 13.6)', () => {
  const directory = useTempDir('journal-crash-');

  it('writes a group that begins where the previous version ended and holds the new rows', async () => {
    const group = await buildReplaceGroup(directory());

    expect(group.after.length).toBeGreaterThan(group.before.length);
    expect(group.after.subarray(0, group.before.length)).toStrictEqual(
      group.before,
    );
    expect(group.previous.rows).toHaveLength(6);
    expect(group.previous.rows.map((row) => row.entry.owner)).toStrictEqual([
      0, 1, 5, 0, 1, 2,
    ]);
    expect(group.next.rows.map((row) => row.entry.owner)).toStrictEqual([
      ...REPLACEMENT_OWNERS,
    ]);
    expect(group.next.rows.map((row) => row.entry.label)).toStrictEqual(
      REPLACEMENT_OWNERS.map(
        (_, index) => group.previous.nextLabel + BigInt(index) * LABEL_STEP,
      ),
    );
    expect(group.next.facts).not.toStrictEqual(group.previous.facts);
    expect(group.next.lineage).not.toBe(group.previous.lineage);
    // The cut must cover rows, tree nodes, id nodes and the trailer, so many bytes lie inside the group.
    expect(group.after.length - group.before.length).toBeGreaterThan(3000);
  });

  it('shows exactly the previous version for a cut at every byte offset inside the group, and the owner open truncates exactly the torn tail', async () => {
    const group = await buildReplaceGroup(directory());
    let checked = 0;

    for (let cut = group.before.length; cut < group.after.length; cut++) {
      const { snapshot, sizeAfter } = await openAsOwner(
        directory(),
        group.after.subarray(0, cut),
      );

      expect(snapshot).toStrictEqual(group.previous);
      expect(sizeAfter).toBe(group.before.length);
      checked += 1;
    }

    expect(checked).toBe(group.after.length - group.before.length);
  }, 170_000);

  it('shows exactly the new version when the group is complete, and truncates nothing', async () => {
    const group = await buildReplaceGroup(directory());

    const { snapshot, sizeAfter } = await openAsOwner(directory(), group.after);

    expect(snapshot).toStrictEqual(group.next);
    expect(sizeAfter).toBe(group.after.length);
  });

  it('shows exactly the previous version after a crash partway through the writes, in the order the writer made them', async () => {
    const group = await buildReplaceGroup(directory());
    const total = group.writes.reduce((sum, write) => sum + write.length, 0);
    expect(total).toBe(group.after.length - group.before.length);
    const crashes = crashPoints(group.writes, total);

    for (const persisted of crashes) {
      const image = imageAfterBytes(group, persisted);
      const { snapshot } = await openAsOwner(directory(), image);

      expect(snapshot).toStrictEqual(
        persisted === total ? group.next : group.previous,
      );
    }

    expect(crashes.length).toBeGreaterThan(total / CRASH_STRIDE);
    expect(crashes).toContain(total - 1);
    expect(crashes).toContain(total);
  }, 170_000);
});

/** Every `CRASH_STRIDE`th byte, and each byte on either side of the end of a write. */
const CRASH_STRIDE = 4;

function crashPoints(
  writes: ReadonlyArray<{ length: number }>,
  total: number,
): number[] {
  const points = new Set<number>();
  for (let at = 0; at <= total; at += CRASH_STRIDE) points.add(at);
  let end = 0;
  for (const write of writes) {
    end += write.length;
    for (const edge of [end - 1, end, end + 1]) {
      if (edge >= 0 && edge <= total) points.add(edge);
    }
  }
  points.add(total);
  return [...points].sort((left, right) => left - right);
}

/** The file as a crash leaves it after the first `persisted` bytes of the group's writes reached the disk. */
function imageAfterBytes(group: ReplaceGroup, persisted: number): Uint8Array {
  let end = group.before.length;
  const landed: Array<{ position: number; length: number }> = [];
  let left = persisted;
  for (const write of group.writes) {
    if (left === 0) break;
    const length = Math.min(write.length, left);
    landed.push({ position: write.position, length });
    end = Math.max(end, write.position + length);
    left -= length;
  }
  const image = new Uint8Array(end);
  image.set(group.before);
  for (const { position, length } of landed) {
    image.set(group.after.subarray(position, position + length), position);
  }
  return image;
}
