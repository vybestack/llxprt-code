/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';

describe('native Kimi ordinal commit contracts', () => {
  const directory = useTempDir('kimi-ordinal-contracts-');

  it('keeps metadata unpublished after a failed activation write and poisons further commits', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const path = `${directory()}/failure.llxj`;
    const session = await JournalSession.create(path, {
      journal: seams.dependencies,
    });
    try {
      const before = await session.append([
        { speaker: 'ai', blocks: [call('x')] },
      ]);
      failures.failWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      await expect(session.store.commit([{ kind: 'kimi' }])).rejects.toThrow(
        'injected write failure',
      );
      expect(session.store.published?.commitSeq).toBe(before.commitSeq);
      expect(session.store.published?.durableEnd).toBe(before.durableEnd);
      await expect(
        session.append([{ speaker: 'ai', blocks: [call('y')] }]),
      ).rejects.toThrow('accepts no more writes');
      const snapshot = await session.store.snapshot();
      try {
        await expect(snapshot.kimiEligibleCount()).rejects.toThrow(
          'need a fill',
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await reopened.store.commit([{ kind: 'kimi' }]);
      const snapshot = await reopened.store.snapshot();
      try {
        expect(await snapshot.kimiEligibleCount()).toBe(1);
      } finally {
        await snapshot.close();
      }
    } finally {
      await reopened.close();
    }
  });

  it('rejects mixed activation before consuming a stream and makes clear require a fresh fill', async () => {
    const session = await JournalSession.create(`${directory()}/fill.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    let consumed = false;
    function* rows(): Generator<ReturnType<typeof encodeContentRow>> {
      consumed = true;
      yield encodeContentRow(
        { speaker: 'ai', blocks: [call('x')] },
        { owner: 0 },
      );
    }
    try {
      await expect(
        session.store.commit([
          { kind: 'replace', rows: rows() },
          { kind: 'kimi' },
        ]),
      ).rejects.toThrow('separate fill group');
      expect(consumed).toBe(false);
      await session.store.commit([{ kind: 'kimi' }]);
      await session.store.commit([{ kind: 'clear' }]);
      const cleared = await session.store.snapshot();
      try {
        await expect(cleared.kimiEligibleCount()).rejects.toThrow(
          'need a fill',
        );
      } finally {
        await cleared.close();
      }
      await session.store.commit([{ kind: 'kimi' }]);
      const empty = await session.store.snapshot();
      try {
        expect(await empty.kimiEligibleCount()).toBe(0);
        await expect(empty.kimiOrdinal(1n, 0)).rejects.toThrow(RangeError);
      } finally {
        await empty.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps unique-id append, response arrival and an uncached ordinal lookup within positional-read budgets at 4000 rows', async () => {
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
      counter.reads = 0;
      await session.append([{ speaker: 'ai', blocks: [call('next-unique')] }]);
      expect(counter.reads).toBeLessThan(150);
      counter.reads = 0;
      await session.append([{ speaker: 'tool', blocks: [response('raw-0')] }]);
      expect(counter.reads).toBeLessThan(150);
      const snapshot = await session.store.snapshot();
      try {
        counter.reads = 0;
        expect(await snapshot.kimiOrdinal(4194304000n, 0)).toBe(3999);
        expect(counter.reads).toBeLessThan(30);
        await expect(snapshot.kimiOrdinal(1048576n, -1)).rejects.toThrow(
          RangeError,
        );
        await expect(snapshot.kimiOrdinal(1048576n, 0.5)).rejects.toThrow(
          RangeError,
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
