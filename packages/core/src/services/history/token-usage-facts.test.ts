/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import type { IContent } from './IContent.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { measureRequestRow } from './token-usage-measurement.js';
import {
  decodeTokenUsageFacts,
  tokenUsageFactRegistration,
} from './token-usage-facts.js';

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
  it('measures the known source entry without looking up its label again', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append([row]);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const lookups = spyOn(snapshot, 'entryByLabel');
        const headers = spyOn(snapshot, 'readIds');
        try {
          const registration = tokenUsageFactRegistration(
            (text) => text.length,
          );
          const bytes = await registration.measure(snapshot, entry, undefined);
          expect(
            decodeTokenUsageFacts(bytes).map((unit) => unit.measurement),
          ).toStrictEqual([measureRequestRow(row, (text) => text.length)]);
          expect(lookups.mock.calls).toHaveLength(0);
          expect(headers.mock.calls).toHaveLength(1);
        } finally {
          headers.mockRestore();
          lookups.mockRestore();
        }
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('measures a carried row once and streams its stored measurement across sends', async () => {
    let calls = 0;
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
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

  it('stores and compacts measurements larger than one trie value without retokenizing', async () => {
    let calls = 0;
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: (text) => {
        calls++;
        return text.length;
      },
    });
    const id = 'large-row-identity'.repeat(256);
    try {
      await session.append([{ ...row, metadata: { id } }]);
      expect(calls).toBe(1);
      await session.store.compact();
      const snapshot = await session.store.snapshot();
      const selected = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const measurements = [];
        for await (const fact of selected.openTokenUsageReader())
          measurements.push(fact.measurement);
        expect(measurements).toHaveLength(1);
        expect(measurements[0].tokens).toBe(13);
        expect(measurements[0].fingerprintKey).toBe(`${id}:1`);
        expect(calls).toBe(1);
      } finally {
        await selected.close();
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('refreshes stored call measurements when a response is appended', async () => {
    const countTokens = (text: string): number => text.length;
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: countTokens,
    });
    async function verifyMeasurements(): Promise<void> {
      const snapshot = await session.store.snapshot();
      const selected = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const expected = [];
        for await (const content of selected.openReader())
          expected.push(measureRequestRow(content, countTokens));
        const actual = [];
        for await (const fact of selected.openTokenUsageReader())
          actual.push(fact.measurement);
        expect(actual).toStrictEqual(expected);
      } finally {
        await selected.close();
        await snapshot.close();
      }
    }
    try {
      await session.append(
        Array.from({ length: 40 }, (_, index) => ({
          speaker: 'ai',
          blocks: [call(`id-${index}`)],
        })),
      );
      await verifyMeasurements();
      await session.append([{ speaker: 'tool', blocks: [response('id-0')] }]);
      await verifyMeasurements();
    } finally {
      await session.close();
    }
  });

  it('releases a paused token fact reader when its request selection closes', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append([row]);
      const snapshot = await session.store.snapshot();
      const selected = await IndexedJournalRequestSnapshot.create(snapshot);
      const reader = selected.openTokenUsageReader();
      try {
        expect((await reader.next()).done).toBe(false);
        await selected.close();
        await snapshot.close();
        expect(await session.store.compact()).toBe('swapped');
      } finally {
        await reader.return(undefined);
        await selected.close();
      }
    } finally {
      await session.close();
    }
  });
});
