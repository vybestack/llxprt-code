/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import type { IContent } from './IContent.js';

const row: IContent = {
  speaker: 'human',
  metadata: { id: 'row' },
  blocks: [{ type: 'text', text: 'hello journal' }],
};

async function assertStoredRow(
  selected: IndexedJournalRequestSnapshot,
): Promise<void> {
  let units = 0;
  for await (const fact of selected.openTokenUsageReader()) {
    expect(fact.measurement.tokens).toBe(13);
    expect(fact.measurement.bucket).toBe('history');
    expect(fact.sequence).toBeGreaterThan(0n);
    units++;
  }
  expect(units).toBe(1);
}

describe('neutral token usage row facts', () => {
  it('measures a carried row once and streams its stored measurement across sends', async () => {
    let calls = 0;
    const session = await JournalSession.createUnlinked({
      tokenUsageCountTokens: (text) => {
        calls++;
        return text.length;
      },
    });
    try {
      await session.append([row]);
      expect(calls).toBe(1);
      for (let send = 0; send < 2; send++) {
        const snapshot = await session.store.snapshot();
        const selected = await IndexedJournalRequestSnapshot.create(snapshot);
        try {
          await assertStoredRow(selected);
        } finally {
          await selected.close();
          await snapshot.close();
        }
      }
      expect(calls).toBe(1);
      await session.store.compact();
      const compacted = await session.store.snapshot();
      const afterCopy = await IndexedJournalRequestSnapshot.create(compacted);
      try {
        await assertStoredRow(afterCopy);
      } finally {
        await afterCopy.close();
        await compacted.close();
      }
      expect(calls).toBe(1);
      await session.append([{ ...row, metadata: { id: 'next' } }]);
      expect(calls).toBe(2);
    } finally {
      await session.close();
    }
  });
});
