/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';
import { oldTailUnits } from './__tests__/support/tail-query-oracle.js';
import { assertKimiTail } from './__tests__/support/kimi-tail-oracle.js';

async function assertMutation(
  session: JournalSession,
  rows: readonly IContent[],
  tail: readonly IContent[],
): Promise<void> {
  const pin = await session.store.snapshot();
  const baseline = await IndexedJournalRequestSnapshot.create(pin);
  const request = await IndexedJournalRequestSnapshot.create(pin, tail);
  try {
    await assertKimiTail(baseline, await oldTailUnits(rows, []));
    await assertKimiTail(request, await oldTailUnits(rows, tail));
    expect(await pin.kimiMappedId('x')).toBe(await baseline.kimiMappedId('x'));
  } finally {
    await baseline.close();
    await request.close();
    await pin.close();
  }
}

describe('request-only Kimi mappings', () => {
  const directory = useTempDir('kimi-tail-');
  it('counts split-row fallbacks only before their cumulative native unit', async () => {
    const session = await JournalSession.create(
      `${directory()}/split-fallback.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('known', 'read')] },
      {
        speaker: 'tool',
        blocks: [call('c', ''), { ...response(''), toolName: 'run' }],
      },
    ];
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'kimi' }]);
      const pin = await session.store.snapshot();
      const indexed = await IndexedJournalRequestSnapshot.create(pin);
      try {
        await assertKimiTail(indexed, await oldTailUnits(rows, []));
        expect(await indexed.kimiCounterBefore(3)).toBe(2);
      } finally {
        await indexed.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('overrides two earlier calls with a named pending duplicate without changing the pin', async () => {
    const session = await JournalSession.create(
      `${directory()}/duplicate.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('x', 'first')] },
      { speaker: 'ai', blocks: [call('x', 'second')] },
    ];
    const tail: readonly IContent[] = [
      { speaker: 'human', blocks: [call('x', 'changed\ud800')] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'keep' }, call('x', '')],
      },
    ];
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'kimi' }]);
      const pin = await session.store.snapshot();
      const indexed = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        expect(await indexed.kimiMappedId('x')).toBe(
          'functions.changed\ud800:2',
        );
        expect(await indexed.kimiName('x')).toBe('changed\ud800');
        expect(await indexed.kimiEligibleCount()).toBe(3);
        expect(await indexed.kimiOrdinal('x')).toBe(2);
        await assertKimiTail(indexed, await oldTailUnits(rows, tail));
        expect(await pin.kimiMappedId('x')).toBe('functions.second:1');
        await session.append([{ speaker: 'ai', blocks: [call('x', 'later')] }]);
        expect(await indexed.kimiMappedId('x')).toBe(
          'functions.changed\ud800:2',
        );
      } finally {
        await indexed.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('continues the pinned mapping through append, native removal rebuild and prefix pop', async () => {
    const session = await JournalSession.create(
      `${directory()}/mutations.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('x', 'first')] },
      { speaker: 'human', blocks: [call('y')] },
      { speaker: 'ai', blocks: [call('x', 'last')] },
    ];
    const tail: readonly IContent[] = [
      { speaker: 'human', blocks: [call('x', 'tail')] },
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append(rows.slice(0, 2));
      await assertMutation(session, rows.slice(0, 2), tail);
      const old = await session.store.snapshot();
      const cut = (await old.entryAt(0)).label;
      await session.append(rows.slice(2));
      const request = await IndexedJournalRequestSnapshot.create(old, tail);
      try {
        await assertKimiTail(
          request,
          await oldTailUnits(rows.slice(0, 2), tail),
        );
      } finally {
        await request.close();
        await old.close();
      }
      await assertMutation(session, rows, tail);
      await session.store.commit([
        { kind: 'density', replacements: [], removed: [cut] },
      ]);
      await assertMutation(session, rows.slice(1), tail);
      const before = await session.store.snapshot();
      const pop = (await before.entryAt(1)).label;
      await before.close();
      await session.store.commit([
        { kind: 'pop', cutLabel: pop, expectedRemoved: 1 },
      ]);
      await assertMutation(session, rows.slice(1, 2), tail);
      const final = await session.store.snapshot();
      try {
        expect(await final.kimiMappedId('x')).toBeUndefined();
      } finally {
        await final.close();
      }
    } finally {
      await session.close();
    }
  });

  it('uses emitted reconstructed units and their positions rather than raw pending order', async () => {
    const session = await JournalSession.create(
      `${directory()}/reconstruction.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    const rows: readonly IContent[] = [
      {
        speaker: 'tool',
        blocks: [response('r'), { ...response('r'), toolName: 'second' }],
      },
      { speaker: 'human', blocks: [call('h')] },
    ];
    const tail: readonly IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          { ...response('r'), result: { bigger: true }, toolName: 'best' },
        ],
      },
      {
        speaker: 'tool',
        blocks: [{ ...response('new'), toolName: '' }, response('new')],
      },
      {
        speaker: 'ai',
        blocks: [
          call('r', ''),
          call('h', 'renamed'),
          call(''),
          call('call_'),
          call('call_x'),
          call('hist_tool_x'),
          call('toolu_x'),
        ],
      },
    ];
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'kimi' }]);
      const pin = await session.store.snapshot();
      const indexed = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        await assertKimiTail(indexed, await oldTailUnits(rows, tail));
        expect(await indexed.kimiName('r')).toBe('second');
      } finally {
        await indexed.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
