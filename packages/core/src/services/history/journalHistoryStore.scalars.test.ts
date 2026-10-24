/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { StoredRow } from '../../journal/rowReads.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(
  speaker: IContent['speaker'],
  text: string,
  seq?: number,
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    ...(seq === undefined
      ? {}
      : {
          metadata: {
            chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 },
          },
        }),
  };
}

function textOf(content: IContent | undefined): string | undefined {
  const block = content?.blocks[0];
  return block?.type === 'text' ? block.text : undefined;
}

describe('journal store scalars and last rows', () => {
  const directory = useTempDir('journal-store-scalars-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function created(): Promise<JournalHistoryStore> {
    const session = await JournalSession.create(
      path.join(directory(), 'scalars.llxj'),
      { journal: testJournalSeams({}).dependencies },
    );
    const store = new JournalHistoryStore(session);
    open.push(store);
    return store;
  }
  it('answers scalars without row reads and each last-speaker lookup with one row read at 8192 rows', async () => {
    const store = await created();
    const speakers = ['human', 'ai', 'tool'] as const;
    store.replaceAll(
      Array.from({ length: 8192 }, (_, index) =>
        row(speakers[index % 3], String(index), index + 1),
      ),
    );
    await store.waitForDurable();
    let decoded = 0;
    const read = VersionSnapshot.prototype.readRow;
    const rows = spyOn(VersionSnapshot.prototype, 'readRow').mockImplementation(
      function (this: VersionSnapshot, entry: RowEntry): Promise<StoredRow> {
        decoded++;
        return read.call(this, entry);
      },
    );
    const scan = spyOn(VersionSnapshot.prototype, 'entries').mockImplementation(
      () => {
        throw new Error('scalar whole-history scan');
      },
    );
    try {
      expect(store.statistics()).toStrictEqual({
        totalMessages: 8192,
        userMessages: 2731,
        aiMessages: 2731,
        toolCalls: 0,
        toolResponses: 0,
      });
      expect(store.contextBoundary()).toStrictEqual({
        firstSeq: 1,
        lastSeq: 8192,
        totalEntries: 8192,
        approximate: false,
      });
      expect(decoded).toBe(0);
      expect(textOf(await store.lastContent())).toBe('8191');
      expect(textOf(await store.lastContent('human'))).toBe('8190');
      expect(textOf(await store.lastContent('ai'))).toBe('8191');
      expect(textOf(await store.lastContent('tool'))).toBe('8189');
      expect(decoded).toBe(4);
    } finally {
      scan.mockRestore();
      rows.mockRestore();
    }
  });

  it('finds the newest marked position through an unmarked tail and rewind', async () => {
    const store = await created();
    expect(await store.currentTurnMarker()).toBeNull();
    store.apply({ kind: 'content', content: row('human', 'older', 900) });
    store.apply({ kind: 'content', content: row('ai', 'newest', 7) });
    store.apply({ kind: 'content', content: row('tool', 'unmarked') });
    expect(await store.currentTurnMarker()).toStrictEqual({
      turnId: null,
      userTurn: 1,
      step: 7,
      seq: 7,
    });
    store.apply({ kind: 'rewind', itemsRemoved: 2 });
    expect(await store.currentTurnMarker()).toStrictEqual({
      turnId: null,
      userTurn: 1,
      step: 900,
      seq: 900,
    });
  });

  it('reads a turn marker without loading message blocks', async () => {
    const store = await created();
    const marked = row('human', 'payload '.repeat(8192), 37);
    marked.metadata = { ...marked.metadata, turnId: 'current-turn' };
    store.apply({ kind: 'content', content: marked });
    await store.waitForDurable();
    const rows = spyOn(VersionSnapshot.prototype, 'readRow').mockImplementation(
      () => {
        throw new Error('Turn marker loaded message blocks');
      },
    );
    try {
      expect(await store.currentTurnMarker()).toStrictEqual({
        turnId: 'current-turn',
        userTurn: 1,
        step: 37,
        seq: 37,
      });
    } finally {
      rows.mockRestore();
    }
  });

  it('reports an unknown marker when all stored rows are unmarked', async () => {
    const store = await created();
    store.apply({ kind: 'content', content: row('human', 'unmarked') });
    expect(await store.currentTurnMarker()).toBeNull();
  });

  it('answers zeros and no last row for an empty history', async () => {
    const store = await created();
    expect(store.statistics()).toStrictEqual({
      totalMessages: 0,
      userMessages: 0,
      aiMessages: 0,
      toolCalls: 0,
      toolResponses: 0,
    });
    expect(store.contextBoundary()).toStrictEqual({
      firstSeq: 0,
      lastSeq: 0,
      totalEntries: 0,
      approximate: false,
    });
    expect(await store.lastContent()).toBeUndefined();
    expect(await store.lastContent('human')).toBeUndefined();
  });

  it('marks the boundary approximate when a row has no chronology and maps its seq to 0', async () => {
    const store = await created();
    store.apply({ kind: 'content', content: row('human', 'bare') });
    store.apply({ kind: 'content', content: row('ai', 'stamped', 7) });
    await store.waitForDurable();
    expect(store.contextBoundary()).toStrictEqual({
      firstSeq: 0,
      lastSeq: 7,
      totalEntries: 2,
      approximate: true,
    });
  });

  it('does not count rows that are queued and not yet acked (WIRING G2)', async () => {
    const store = await created();
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    expect(store.getLength()).toBe(1);
    expect(store.statistics().totalMessages).toBe(0);
    await store.waitForDurable();
    expect(store.statistics().totalMessages).toBe(1);
  });

  it('follows the newest row of a speaker back to an earlier one when the newest is rewound away', async () => {
    const store = await created();
    store.apply({ kind: 'content', content: row('human', 'first', 1) });
    store.apply({ kind: 'content', content: row('ai', 'reply', 2) });
    store.apply({ kind: 'content', content: row('human', 'second', 3) });
    expect(textOf(await store.lastContent('human'))).toBe('second');
    store.apply({ kind: 'rewind', itemsRemoved: 1 });
    expect(textOf(await store.lastContent('human'))).toBe('first');
    expect(textOf(await store.lastContent('ai'))).toBe('reply');
    expect(textOf(await store.lastContent())).toBe('reply');
    expect(await store.lastContent('tool')).toBeUndefined();
  });
});
