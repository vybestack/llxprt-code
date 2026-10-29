/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { call } from './__tests__/support/normalization-cases.js';
import { oldTailUnits } from './__tests__/support/tail-query-oracle.js';
import { assertMistralTail } from './__tests__/support/mistral-tail-oracle.js';
import type { IContent } from './IContent.js';

async function assertVersion(
  session: JournalSession,
  rows: readonly IContent[],
  tail: readonly IContent[],
): Promise<void> {
  const pin = await session.store.snapshot();
  const baseline = await IndexedJournalRequestSnapshot.create(pin);
  const request = await IndexedJournalRequestSnapshot.create(pin, tail);
  try {
    await assertMistralTail(baseline, await oldTailUnits(rows, []), 2);
    await assertMistralTail(request, await oldTailUnits(rows, tail), 2);
  } finally {
    await baseline.close();
    await request.close();
    await pin.close();
  }
}

describe('request Mistral native lineage', () => {
  const directory = useTempDir('mistral-tail-lineage-');
  it('continues the selected activated version after append, removal, pop, clone and compaction', async () => {
    const session = await JournalSession.create(`${directory()}/lineage.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
      { speaker: 'ai', blocks: [call('native later')] },
    ];
    const tail: readonly IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          call('4Uq1sY29c'),
          call('pending raw'),
          call('toolu_alpha-1', 'renamed'),
        ],
      },
    ];
    try {
      await session.append(rows.slice(0, 2));
      await session.store.commit([{ kind: 'mistral', slot: 2 }]);
      await assertVersion(session, rows.slice(0, 2), tail);
      const old = await session.store.snapshot();
      const removed = (await old.entryAt(0)).label;
      await session.append(rows.slice(2));
      const olderRequest = await IndexedJournalRequestSnapshot.create(
        old,
        tail,
      );
      try {
        await assertMistralTail(
          olderRequest,
          await oldTailUnits(rows.slice(0, 2), tail),
          2,
        );
      } finally {
        await olderRequest.close();
        await old.close();
      }
      await assertVersion(session, rows, tail);
      await session.store.commit([
        { kind: 'density', replacements: [], removed: [removed] },
      ]);
      await assertVersion(session, rows.slice(1), tail);
      const beforePop = await session.store.snapshot();
      const cut = (await beforePop.entryAt(1)).label;
      await beforePop.close();
      await session.store.commit([
        { kind: 'pop', cutLabel: cut, expectedRemoved: 1 },
      ]);
      await assertVersion(session, rows.slice(1, 2), tail);
      const clone = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await assertVersion(clone, rows.slice(1, 2), tail);
        expect(await clone.store.compact()).toBe('swapped');
        await assertVersion(clone, rows.slice(1, 2), tail);
      } finally {
        await clone.close();
      }
    } finally {
      await session.close();
    }
  });

  it('binds mappings to the complete request instead of reusing them for a filtered converter', async () => {
    const session = await JournalSession.create(
      `${directory()}/selection.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
    ];
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const full = (await request.mistralMapping('toolu_alpha-1', 0))?.id;
        const selected = getToolIdStrategy('mistral').createMapper([
          ...(await oldTailUnits(rows.slice(1), [])),
        ]);
        expect(full).toBe('4Uq1sY29c');
        expect(selected.resolveToolCallId(call('toolu_alpha-1'))).toBe(
          '4SftZvDMX',
        );
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
