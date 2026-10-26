/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import {
  draftRow,
  storeDeps,
  labelsOf,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function snapshot(path: string) {
  const journal = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(journal, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 50 });
    return {
      entries,
      members: await reader.membership(
        entries.map((entry) => entry.transcriptId),
      ),
    };
  } finally {
    await journal.close();
  }
}

describe('transcript occurrence membership', () => {
  const dir = useTempDir('transcript-members-');
  it('shares a self-adopted body and removes only the replaced occurrence', async () => {
    const path = join(dir(), 'self.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'original' })] },
      ]);
      const pin = await store.openRead();
      try {
        const iterator = store.rows()[Symbol.asyncIterator]();
        const first = await iterator.next();
        await iterator.return(undefined);
        if (first.done === true || pin.version === undefined)
          throw new Error('missing row');
        const duplicate = { ...first.value, label: first.value.label + 1n };
        await store.commit([
          {
            kind: 'adopt',
            rows: [{ source: pin.access, entry: duplicate }],
            placement: 'end',
            nextLabel: pin.version.nextLabel,
          },
        ]);
        expect((await snapshot(path)).entries).toHaveLength(1);
        expect((await snapshot(path)).members[0].count).toBe(2);
        await store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: first.value.label,
                draft: draftRow({ text: 'replacement' }),
              },
            ],
          },
        ]);
        const state = await snapshot(path);
        expect(state.entries).toHaveLength(2);
        expect(state.members.map((member) => member.count)).toStrictEqual([
          1, 1,
        ]);
        expect(state.members[0].label).toBe(duplicate.label);
        expect(state.entries[1].supersedesId).toBe(1n);
      } finally {
        await pin.close();
      }
    } finally {
      await store.close();
    }
  });

  it('retains removal-only density edits as display-only operation markers', async () => {
    const path = join(dir(), 'remove.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        {
          kind: 'append',
          rows: [draftRow({ text: 'removed' }), draftRow({ text: 'kept' })],
        },
      ]);
      const [label] = await labelsOf(store);
      await store.commit([
        { kind: 'density', replacements: [], removed: [label] },
      ]);
      const state = await snapshot(path);
      expect(state.entries.map((entry) => entry.transcriptId)).toStrictEqual([
        1n,
        2n,
        3n,
      ]);
      expect(state.members.map((member) => member.count)).toStrictEqual([
        0, 1, 0,
      ]);
      expect(state.entries[2]).toMatchObject({ rowRef: 0, audience: 2 });
      expect(state.entries[2].presentationRef).toBeGreaterThan(0);
      expect(store.published?.rows).toBe(1);
    } finally {
      await store.close();
    }
  });
});
