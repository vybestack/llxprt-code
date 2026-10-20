/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call } from './__tests__/support/normalization-cases.js';

describe('native Kimi sparse correction resources', () => {
  const directory = useTempDir('kimi-correction-resources-');
  it('reads a selected last mapping and no clean-history occurrences for corrections at 4000 rows', async () => {
    const counter = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/bounded.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
    });
    function* rows(): Generator<ReturnType<typeof encodeContentRow>> {
      for (let index = 0; index < 4000; index++)
        yield encodeContentRow(
          { speaker: 'ai', blocks: [call(`raw-${index}`)] },
          { owner: 0 },
        );
    }
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.store.commit([{ kind: 'replace', rows: rows() }]);
      const snapshot = await session.store.snapshot();
      try {
        counter.reads = 0;
        expect(await snapshot.kimiMappedId('raw-3999')).toBe(
          'functions.inspect:3999',
        );
        expect(counter.reads).toBeLessThan(50);
        counter.reads = 0;
        expect(await snapshot.kimiDigitCorrection()).toBe(0);
        expect(await snapshot.kimiUnmappedCount()).toBe(0);
        expect(counter.reads).toBeLessThan(10);
      } finally {
        await snapshot.close();
      }
      counter.reads = 0;
      await session.append([
        { speaker: 'ai', blocks: [call('raw-0', 'new-name')] },
      ]);
      expect(counter.reads).toBeLessThan(150);
      const duplicate = await session.store.snapshot();
      try {
        expect(await duplicate.kimiMappedId('raw-0')).toBe(
          'functions.new-name:4000',
        );
        let holders = 0;
        for await (const holder of duplicate.kimiHolders('raw-0')) {
          expect(holder.position.label).toBeGreaterThan(0n);
          holders++;
        }
        expect(holders).toBe(3);
      } finally {
        await duplicate.close();
      }
    } finally {
      await session.close();
    }
  });

  it('streams dense exceptions without visiting clean IDs and preserves exact raw-name code units', async () => {
    const counter = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/dense.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
    });
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (let index = 0; index < 100; index++)
        await session.append([
          {
            speaker: 'ai',
            blocks: [call(`id-${index}`), call(`id-${index}`, 'last')],
          },
        ]);
      const snapshot = await session.store.snapshot();
      try {
        counter.reads = 0;
        expect(await snapshot.kimiDigitCorrection()).toBe(-245);
        expect(counter.reads).toBeLessThan(2500);
      } finally {
        await snapshot.close();
      }
      await session.append([
        { speaker: 'ai', blocks: [call('unicode', '\ud800é\\"')] },
      ]);
      const unicode = await session.store.snapshot();
      try {
        expect(await unicode.kimiMappedId('unicode')).toBe(
          'functions.\ud800é\\":200',
        );
      } finally {
        await unicode.close();
      }
    } finally {
      await session.close();
    }
  });
});
