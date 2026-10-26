/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import {
  JournalDisplayWriter,
  displayRelationKey,
} from './display-recording.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function transcript(path: string) {
  const journal = await openJournalReadOnly(path);
  const reader = new TranscriptReader(journal, sha256KeyHash);
  return { journal, reader };
}

describe('journal display commands', () => {
  const directory = useTempDir('journal-display-');

  it('persists notice and distinct result display without changing model rows or facts', async () => {
    const path = join(directory(), 'session.llxj');
    const session = await JournalSession.create(path);
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'model prompt' }] },
      ]);
      const context = session.store.published;
      const writer = new JournalDisplayWriter(session.store);
      const notice = await writer.append(
        { type: 'info' },
        'slash command completed',
      );
      const result = await writer.append(
        {
          type: 'tool-result',
          attemptId: 'attempt:one',
          callId: 'call:two',
          format: 'json',
        },
        '{"fileDiff":"-old\\n+new","fileName":"example.ts"}',
      );
      expect(session.store.published?.rows).toBe(context?.rows);
      expect(session.store.published?.roots.rowRoot).toBe(
        context?.roots.rowRoot,
      );
      expect(session.store.published?.roots.idRoot).toBe(context?.roots.idRoot);
      const indexed = await session.store.getState(
        displayRelationKey('attempt:one', 'call:two'),
      );
      expect(new TextDecoder().decode(indexed)).toBe(
        result.transcriptId.toString(),
      );
      const { journal, reader } = await transcript(path);
      try {
        const entries = await reader.page({ direction: 'forward', limit: 10 });
        expect(entries.map((entry) => entry.audience)).toStrictEqual([0, 2, 2]);
        expect(
          (
            await reader.membership([notice.transcriptId, result.transcriptId])
          ).map((member) => member.count),
        ).toStrictEqual([0, 0]);
        const content = decodeStoredRow(await reader.readRow(entries[1]));
        expect(content.blocks).toStrictEqual([
          { type: 'text', text: 'slash command completed' },
        ]);
      } finally {
        await journal.close();
      }
    } finally {
      await session.close();
    }
  });

  it('streams a display body and retains a retracted id across reopen', async () => {
    const path = join(directory(), 'stream.llxj');
    const session = await JournalSession.create(path);
    const writer = new JournalDisplayWriter(session.store);
    const source = (async function* () {
      for (let index = 0; index < 40; index++) yield '\ud800🌙'.repeat(2048);
    })();
    const notice = await writer.append({ type: 'warning' }, source);
    await writer.retract(notice);
    await session.close();
    const { journal, reader } = await transcript(path);
    try {
      const [entry] = await reader.page({ direction: 'backward', limit: 1 });
      expect(entry.transcriptId).toBe(notice.transcriptId);
      expect(entry.status).toBe(6);
      expect(decodeStoredRow(await reader.readRow(entry)).blocks).toStrictEqual(
        [{ type: 'text', text: '\ud800🌙'.repeat(2048 * 40) }],
      );
      expect(journal.trailer?.rootAggregate.rows).toBe(0);
    } finally {
      await journal.close();
    }
  });

  it('retains display descriptors, bodies and retractions after compaction and reopen', async () => {
    const path = join(directory(), 'compacted.llxj');
    const session = await JournalSession.create(path);
    const writer = new JournalDisplayWriter(session.store);
    const retained = await writer.append(
      { type: 'shell' },
      'shell stdout survives',
    );
    const removed = await writer.append({ type: 'info' }, 'retracted notice');
    await writer.retract(removed);
    await session.store.compact();
    await session.close();
    const { journal, reader } = await transcript(path);
    try {
      const entries = await reader.page({ direction: 'forward', limit: 10 });
      expect(
        entries.map((entry) => [
          entry.transcriptId,
          entry.audience,
          entry.status,
        ]),
      ).toStrictEqual([
        [retained.transcriptId, 2, 1],
        [removed.transcriptId, 2, 6],
      ]);
      expect(
        decodeStoredRow(await reader.readRow(entries[0])).blocks,
      ).toStrictEqual([{ type: 'text', text: 'shell stdout survives' }]);
      expect(entries[0].presentationRef).toBeGreaterThan(0);
    } finally {
      await journal.close();
    }
  });

  it('preserves an acknowledged prefix when an external display producer fails', async () => {
    const path = join(directory(), 'failed-source.llxj');
    const session = await JournalSession.create(path);
    const writer = new JournalDisplayWriter(session.store);
    const source = (async function* () {
      yield 'accepted prefix';
      throw new Error('external source failed');
    })();
    try {
      await expect(writer.append({ type: 'shell' }, source)).rejects.toThrow(
        'external source failed',
      );
      const { journal, reader } = await transcript(path);
      try {
        const [entry] = await reader.page({ direction: 'backward', limit: 1 });
        expect(entry.audience).toBe(2);
        expect(entry.status).toBe(3);
        expect(
          decodeStoredRow(await reader.readRow(entry)).blocks,
        ).toStrictEqual([{ type: 'text', text: 'accepted prefix' }]);
        expect(session.store.published?.rows).toBe(0);
      } finally {
        await journal.close();
      }
    } finally {
      await session.close();
    }
  });

  it('refuses to retract a model row', async () => {
    const session = await JournalSession.create(
      join(directory(), 'refusal.llxj'),
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'keep this' }] },
      ]);
      await expect(
        new JournalDisplayWriter(session.store).retract({ transcriptId: 1n }),
      ).rejects.toThrow('display-only');
      expect(session.store.published?.rows).toBe(1);
    } finally {
      await session.close();
    }
  });
});
