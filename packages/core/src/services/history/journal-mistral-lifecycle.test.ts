/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { SeededRandom } from '../../journal/__tests__/support/seededRandom.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';

async function assertCalls(
  session: JournalSession,
  rows: readonly IContent[],
  slot: number,
): Promise<void> {
  const mapper = getToolIdStrategy('mistral').createMapper([...rows]);
  const snapshot = await session.store.snapshot();
  try {
    for (const block of rows.flatMap((row) => row.blocks)) {
      if (block.type !== 'tool_call' || block.id === '') continue;
      expect((await snapshot.mistralMapping(block.id, slot))?.id).toBe(
        mapper.resolveToolCallId(block),
      );
    }
  } finally {
    await snapshot.close();
  }
}

describe('native Mistral mapping lifecycle', () => {
  const directory = useTempDir('native-mistral-lifecycle-');
  const options = { journal: testJournalSeams().dependencies };

  it('fills existing calls for another slot, reopens without caller configuration and continues mapping', async () => {
    const path = `${directory()}/reopen.llxj`;
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX'), call('toolu_alpha-1')] },
    ];
    const session = await JournalSession.create(path, options);
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'mistral', slot: 2 }]);
      await assertCalls(session, rows, 2);
      const snapshot = await session.store.snapshot();
      try {
        expect(
          await snapshot.facts.mistralUsedBy(0, '4SftZvDMX'),
        ).toBeUndefined();
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      const next: IContent = { speaker: 'ai', blocks: [call('third long id')] };
      await reopened.append([next]);
      await reopened.store.commit([{ kind: 'mistral', slot: 0 }]);
      await assertCalls(reopened, [...rows, next], 0);
      await assertCalls(reopened, [...rows, next], 2);
    } finally {
      await reopened.close();
    }
  });

  it('keeps mapping activation when pop crosses the fill boundary or rebuilds a partial group', async () => {
    const session = await JournalSession.create(
      `${directory()}/pop-fill.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    const first: IContent = { speaker: 'ai', blocks: [call('first long id')] };
    const second: IContent = {
      speaker: 'ai',
      blocks: [call('second long id')],
    };
    try {
      await session.append([first]);
      await session.append([second]);
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.store.commit([
        { kind: 'pop', cutLabel: 2097152n, expectedRemoved: 1 },
      ]);
      await assertCalls(session, [first], 0);
      expect(session.store.published?.rows).toBe(1);
      await session.store.commit([
        { kind: 'pop', cutLabel: 1048576n, expectedRemoved: 1 },
      ]);
      await session.append([second]);
      await assertCalls(session, [second], 0);
    } finally {
      await session.close();
    }
  });

  it('matches independent converter mappings before and after removal over collision-heavy histories', async () => {
    const pool = [
      'toolu_alpha-1',
      '4SftZvDMX',
      '4Uq1sY29c',
      'call_',
      'a long id',
      'abcdefghi',
      'another id',
    ];
    let cases = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const random = new SeededRandom(seed);
      const rows: readonly IContent[] = Array.from(
        { length: 3 + random.int(8) },
        () => ({
          speaker: 'ai',
          blocks: [call(pool[random.int(pool.length)])],
        }),
      );
      const session = await JournalSession.create(
        `${directory()}/seed-${seed}.llxj`,
        options,
      );
      try {
        await session.store.commit([{ kind: 'mistral', slot: 0 }]);
        for (const row of rows) await session.append([row]);
        await assertCalls(session, rows, 0);
        cases++;
        await session.store.commit([
          { kind: 'density', replacements: [], removed: [1048576n] },
        ]);
        await assertCalls(session, rows.slice(1), 0);
        cases++;
      } finally {
        await session.close();
      }
    }
    expect(cases).toBe(160);
  });

  it('keeps response append and pinned mapping reads bounded after 4000 distinct calls', async () => {
    const counter = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/bounded.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
    });
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      function* rows(): Generator<ReturnType<typeof encodeContentRow>> {
        for (let index = 0; index < 4000; index++)
          yield encodeContentRow(
            { speaker: 'ai', blocks: [call(`raw-${index}`)] },
            { owner: 0 },
          );
      }
      await session.store.commit([{ kind: 'replace', rows: rows() }]);
      counter.reads = 0;
      await session.append([{ speaker: 'tool', blocks: [response('raw-0')] }]);
      expect(counter.reads).toBeLessThan(150);
      const snapshot = await session.store.snapshot();
      try {
        counter.reads = 0;
        expect((await snapshot.mistralMapping('raw-3999', 0))?.id).toHaveLength(
          9,
        );
        expect(counter.reads).toBeLessThan(20);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
