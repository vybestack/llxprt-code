/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { measureRequestRow } from './token-usage-measurement.js';
import { storedTokenUsageFacts } from './token-usage-facts.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';

const countTokens = (text: string): number => text.length;

async function verifyMeasurements(session: JournalSession): Promise<void> {
  const snapshot = await session.store.snapshot();
  const selected = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const expected = [];
    for await (const content of selected.openReader())
      expected.push(measureRequestRow(content, countTokens));
    const actual = [];
    for await (const fact of selected.openTokenUsageReader(() => {
      throw new Error('Persisted measurements must not be retokenized');
    }))
      actual.push(fact.measurement);
    expect(actual).toStrictEqual(expected);
    const stored = [];
    for await (const entry of snapshot.entries())
      for (const unit of await storedTokenUsageFacts(snapshot, entry.label))
        stored.push(unit.measurement);
    expect(stored).toStrictEqual(expected);
  } finally {
    await selected.close();
    await snapshot.close();
  }
}

async function replaceResponse(
  session: JournalSession,
  content: IContent,
): Promise<void> {
  const snapshot = await session.store.snapshot();
  try {
    const entry = await snapshot.entryAt(snapshot.rows - 1);
    await session.store.commit([
      {
        kind: 'purge',
        rows: [
          {
            label: entry.label,
            draft: encodeContentRow(content, { owner: entry.owner }),
          },
        ],
      },
    ]);
  } finally {
    await snapshot.close();
  }
}

describe('token usage after response replacement', () => {
  const directory = useTempDir('neutral-reuse-reads-');
  it('does not read previous chronology for fresh appended rows', async () => {
    const counter = { reads: 0 };
    let measured = 0;
    const session = await JournalSession.create(`${directory()}/append.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
      tokenUsageCountTokens: (value) => {
        measured++;
        return value.length;
      },
    });
    const rows = (from: number, count: number): IContent[] =>
      Array.from({ length: count }, (_, index) => ({
        speaker: 'human',
        metadata: {
          chronology: {
            seq: from + index,
            userTurn: 1,
            step: 0,
            recordedAt: 1,
          },
        },
        blocks: [{ type: 'text', text: `${from + index}:`.padEnd(800, 'x') }],
      }));
    try {
      await session.append(rows(1, 40));
      await session.append(rows(41, 400));
      session.store.enableNeutralRowFacts();
      counter.reads = 0;
      await session.append([]);
      expect(measured).toBe(440);
      expect(counter.reads).toBeLessThan(800);
      await verifyMeasurements(session);
    } finally {
      await session.close();
    }
  });

  it('reuses unchanged row counts when purge replacements allocate new labels', async () => {
    let calls = 0;
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: (text) => {
        calls++;
        return text.length;
      },
    });
    const rows: IContent[] = Array.from({ length: 40 }, (_, index) => ({
      speaker: 'human',
      metadata: {
        chronology: { seq: index + 1, userTurn: 1, step: 0, recordedAt: 1 },
      },
      blocks: [
        { type: 'text', text: `${index}:`.padEnd(65536, 'x') },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'YQ==',
        },
      ],
    }));
    try {
      await session.append(rows);
      expect(calls).toBe(40);
      for (let index = 0; index < rows.length; index++) {
        const changed = rows.map((row, at) => ({
          ...row,
          blocks: at <= index ? row.blocks.slice(0, 1) : row.blocks,
        }));
        await session.store.commit([
          {
            kind: 'replace',
            rows: changed.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        await verifyMeasurements(session);
        expect(calls).toBe(41 + index);
      }
    } finally {
      await session.close();
    }
  });

  for (const result of ['a longer replacement result', 'x']) {
    it(`refreshes a distant call after a purge changes its response to ${JSON.stringify(result)}`, async () => {
      const session = await JournalSession.createUnlinked({
        eagerTokenUsageFacts: true,
        tokenUsageCountTokens: countTokens,
      });
      try {
        await session.append(
          Array.from(
            { length: 40 },
            (_, index): IContent => ({
              speaker: 'ai',
              blocks: [call(`id-${index}`)],
            }),
          ),
        );
        await expect(verifyMeasurements(session)).resolves.toBeUndefined();
        await session.append([{ speaker: 'tool', blocks: [response('id-0')] }]);
        await expect(verifyMeasurements(session)).resolves.toBeUndefined();
        await replaceResponse(session, {
          speaker: 'tool',
          blocks: [{ ...response('id-0'), result }],
        });
        await expect(verifyMeasurements(session)).resolves.toBeUndefined();
      } finally {
        await session.close();
      }
    });
  }

  it('refreshes the reconstructed call when compression replaces the response', async () => {
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: countTokens,
    });
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('id-0')] },
        { speaker: 'tool', blocks: [response('id-0')] },
      ]);
      await expect(verifyMeasurements(session)).resolves.toBeUndefined();
      const snapshot = await session.store.snapshot();
      const retainFromLabel = snapshot.version?.nextLabel;
      await snapshot.close();
      if (retainFromLabel === undefined) throw new Error('Missing version');
      await session.store.commit([
        {
          kind: 'compress',
          retainFromLabel,
          expectedReplaced: 2,
          summary: encodeContentRow(
            {
              speaker: 'tool',
              blocks: [
                { ...response('id-0'), result: 'a compressed replacement' },
              ],
            },
            { owner: 0 },
          ),
        },
      ]);
      await expect(verifyMeasurements(session)).resolves.toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it('refreshes both the stripped self and the call using a replaced human response', async () => {
    const session = await JournalSession.createUnlinked({
      eagerTokenUsageFacts: true,
      tokenUsageCountTokens: countTokens,
    });
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('id-0')] },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'before' }, response('id-0')],
        },
      ]);
      await expect(verifyMeasurements(session)).resolves.toBeUndefined();
      await replaceResponse(session, {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'the changed stripped self' },
          { ...response('id-0'), result: 'the changed response' },
        ],
      });
      await expect(verifyMeasurements(session)).resolves.toBeUndefined();
    } finally {
      await session.close();
    }
  });
});
