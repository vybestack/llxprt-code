/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { MUTATION } from './recordKinds.js';
import type { JournalStore } from './journalStore.js';
import { OFFSET_FIELDS } from './offsetFields.js';
import { cloneVersion } from './versionTransfer.js';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import {
  SESSION_STATE,
  copyDeps,
  growAfterCheckpoint,
  mapContents,
  openStore,
  populatedSource,
  removeFile,
  withoutOffsets,
} from './__tests__/support/copyFixtures.js';
import { OffsetAudit } from './__tests__/support/offsetAudit.js';
import {
  appendEach,
  draftRow,
  labelsOf,
} from './__tests__/support/storeFixtures.js';
import { snapshotStore } from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { trackPinnedAccess } from './__tests__/support/pinnedAccess.js';

const accessOf = trackPinnedAccess();

const IDS = ['a', 'b', 'c', 'd', 'e', 'c1-0', 'c1-1', 'c1-2', 'c1-3'];

function current(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

describe('clone of one version (design 4.8)', () => {
  const directory = useTempDir('journal-clone-');
  const file = (name: string) => path.join(directory(), name);

  /** A session with owners, a state map, a checkpoint, an owner change and rows after the checkpoint. */
  async function richSource(): Promise<JournalStore> {
    const store = await populatedSource(file('source.llxj'));
    await growAfterCheckpoint(store, 'c1', 4);
    const labels = await labelsOf(store);
    await store.commit([
      { kind: 'owner', changes: [{ label: labels[1], owner: 3 }] },
    ]);
    return store;
  }

  it('writes a file whose version equals the source: rows, owners, aggregate, the facts of every id, meta and state', async () => {
    const source = await richSource();
    const snapshot = await snapshotStore(source, IDS);
    const sourceMeta = await mapContents(source, 'meta');
    const sourceState = await mapContents(source, 'state');
    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    await source.close();
    await removeFile(file('source.llxj'));

    const clone = await openStore(result.path);
    const cloned = await snapshotStore(clone, IDS);
    expect(withoutOffsets(cloned)).toStrictEqual(withoutOffsets(snapshot));
    expect(await mapContents(clone, 'meta')).toStrictEqual(sourceMeta);
    const expectedState = new Map(
      [...sourceState].filter(([key]) => !key.startsWith('ckpt:')),
    );
    expect(await mapContents(clone, 'state')).toStrictEqual(expectedState);
    for (const [key, value] of SESSION_STATE) {
      expect(expectedState.get(key)).toBe(value);
    }
    expect(result.versions).toHaveLength(1);
    await clone.close();
  });

  it('starts a lineage of its own with a new trailer and no ancestor, and keeps the labels and counters of the source', async () => {
    const source = await richSource();
    const before = current(source);
    const result = await cloneVersion(
      await accessOf(source),
      before,
      file('clone.llxj'),
      copyDeps(),
    );
    const clone = await openStore(result.path);
    const version = current(clone);
    expect(version).toMatchObject({
      commitSeq: 1,
      mutation: MUTATION.clone,
      parent: 0,
      skip: [0, 0, 0],
      lineageDepth: 0,
      lineage: 1n,
      rows: before.rows,
      nextLabel: before.nextLabel,
      firstLabel: before.firstLabel,
      lastOwner: before.lastOwner,
      ckptBytes: 0,
    });
    expect(version.aggregate).toStrictEqual(before.aggregate);
    expect(version.selfOffset).toBe(result.versions[0].offset);
    let lastRecordOffset = 0;
    for await (const entry of clone.rows())
      lastRecordOffset = entry.recordOffset;
    expect(version.lastRowOffset).toBe(lastRecordOffset);
    await source.close();
    await clone.close();
  });

  it('points every offset field at a record of the right kind written earlier in the new file, with the source gone', async () => {
    const source = await richSource();
    const arrival = new JournalArrivalRecorder(source);
    try {
      const row = await arrival.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'chunked-clone', submissionId: 'chunked-clone' },
      );
      const block = await arrival.beginBlock(row, 0);
      await arrival.appendField(block, new TextEncoder().encode('chunked row'));
      await arrival.endBlock(block);
      await arrival.sealRow(row);
    } finally {
      await arrival.close();
    }
    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    await source.close();
    await removeFile(file('source.llxj'));
    const clone = await openStore(result.path);
    const audit = new OffsetAudit(await accessOf(clone));
    await audit.walkVersion(current(clone));
    // The fixture has no LENS or mapped-id records; the Mistral test covers those fields.
    const unmet = audit
      .unmet()
      .map((entry) => `${entry.record}.${entry.field}`);
    expect(unmet.sort()).toStrictEqual(
      [
        'TranscriptHead.openRoot',
        'TranscriptChild.ref',
        'TranscriptEntry.presentationRef',
        'CheckpointDescriptor.trailerOffset',
        'IdFact.mappedRef',
        'RelocationValue.newOffset',
        'RowEntry.lensRef',
        'TrailerHeader.parent',
        'TrailerHeader.skip',
        'TrailerHeader.durableEnd',
      ].sort(),
    );
    expect(OFFSET_FIELDS.length - unmet.length).toBeGreaterThan(8);
    await clone.close();
  });

  it('leaves a new file that takes further commits: an append after the clone reads back with the cloned rows', async () => {
    const source = await richSource();
    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    const sourceLabels = await labelsOf(source);
    await source.close();
    const clone = await openStore(result.path);
    await appendEach(clone, [draftRow({ owner: 2, text: 'after the clone' })]);
    const labels = await labelsOf(clone);
    expect(labels.slice(0, -1)).toStrictEqual(sourceLabels);
    expect(labels).toHaveLength(sourceLabels.length + 1);
    expect(current(clone).commitSeq).toBe(2);
    await clone.close();
  });

  it('clones a version with no rows and no maps', async () => {
    const source = await populatedSource(file('source.llxj'));
    const labels = await labelsOf(source);
    await source.commit([
      { kind: 'pop', cutLabel: labels[0], expectedRemoved: labels.length },
    ]);
    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('empty.llxj'),
      copyDeps(),
    );
    const clone = await openStore(result.path);
    expect(current(clone).rows).toBe(0);
    expect(current(clone).roots.rowRoot).toBe(0);
    expect(await labelsOf(clone)).toStrictEqual([]);
    expect((await mapContents(clone, 'state')).get('title')).toBe(
      'Session title',
    );
    await source.close();
    await clone.close();
  });

  it('refuses a source version whose record is not what its field says', async () => {
    const source = await richSource();
    const wrong = { ...current(source), roots: { ...current(source).roots } };
    // The id trie root named as the row tree root.
    const swapped = {
      ...wrong,
      roots: { ...wrong.roots, rowRoot: wrong.roots.idRoot },
    };
    await expect(
      cloneVersion(
        await accessOf(source),
        swapped,
        file('bad.llxj'),
        copyDeps(),
      ),
    ).rejects.toThrow('not a row tree node');
    await source.close();
  });
});
