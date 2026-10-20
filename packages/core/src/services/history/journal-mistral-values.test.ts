/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { encodeFrameStart } from '../../journal/frame.js';
import { ID_NS, sha256KeyHash, fact0Key } from '../../journal/idKeys.js';
import { JournalSession } from './journalSession.js';
import { call } from './__tests__/support/normalization-cases.js';
import { recordingAcceptsEdits } from './recording-primary-edits.js';

describe('native Mistral value identity', () => {
  const directory = useTempDir('native-mistral-values-');

  it('rejects a mapped reference to a CRC-valid VALUE of another raw id', async () => {
    const path = `${directory()}/wrong-raw.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append([
        {
          speaker: 'ai',
          blocks: [call('alpha long id'), call('beta long id')],
        },
      ]);
      const snapshot = await session.store.snapshot();
      const read = await session.store.openRead();
      try {
        const fact = await snapshot.facts.fact('alpha long id');
        if (fact === undefined || fact.mappedRef === 0)
          throw new Error('Missing native mapping value');
        const head = await read.access.readRecordHead(fact.mappedRef);
        const original = encodeFrameStart(
          head.kind,
          head.kindHeader,
          head.bodyLen,
        );
        const other = encodeFrameStart(
          head.kind,
          sha256KeyHash(ID_NS.fact, fact0Key('beta long id')),
          head.bodyLen,
        );
        const handle = await open(path, 'r+');
        try {
          await handle.write(other, 0, other.length, fact.mappedRef);
          await expect(
            snapshot.mistralMapping('alpha long id', 0),
          ).rejects.toThrow('another raw id');
        } finally {
          await handle.write(original, 0, original.length, fact.mappedRef);
          await handle.close();
        }
        expect(
          (await snapshot.mistralMapping('alpha long id', 0))?.id,
        ).toHaveLength(9);
      } finally {
        await read.close();
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('admits a bookkeeping-only mapping fill through the single-owner recording boundary', () => {
    expect(
      recordingAcceptsEdits([{ kind: 'mistral', slot: 0 }], 7, 'owner', false),
    ).toBe(true);
  });

  it('refuses mapping slots outside the fixed three slots', async () => {
    const session = await JournalSession.create(`${directory()}/slots.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      for (const slot of [-1, 3, 0.5])
        await expect(
          session.store.commit([{ kind: 'mistral', slot }]),
        ).rejects.toThrow('slot');
    } finally {
      await session.close();
    }
  });
});
