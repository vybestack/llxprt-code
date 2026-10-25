/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { encodeContentRow } from './journalRowCodec.js';
import { JournalSession } from './journalSession.js';

function marker(seq: number) {
  return { seq, userTurn: 1, step: seq, recordedAt: 1 };
}

function human(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: marker(seq) },
  };
}

function calls(seq: number, ...ids: string[]): IContent {
  return {
    speaker: 'ai',
    blocks: ids.map((id) => ({
      type: 'tool_call' as const,
      id,
      name: `tool_${id}`,
      parameters: {},
    })),
    metadata: { chronology: marker(seq) },
  };
}

function answer(seq: number, callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: `tool_${callId}`,
        result: 'done',
      },
    ],
    metadata: { chronology: marker(seq) },
  };
}

function shapeOf(contents: readonly IContent[]): string[] {
  return contents.map((content) =>
    content.blocks
      .map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'tool_call') return `call:${block.id}`;
        if (block.type === 'tool_response') return `resp:${block.callId}`;
        return block.type;
      })
      .join(','),
  );
}

describe('journal history store repair and media owner', () => {
  const directory = useTempDir('journal-history-repair-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function seeded(
    name: string,
    rows: readonly IContent[],
    ownerOf: (index: number) => number = () => 0,
  ): Promise<{ store: JournalHistoryStore; session: JournalSession }> {
    const session = await JournalSession.create(path.join(directory(), name));
    await session.store.commit([
      {
        kind: 'append',
        rows: rows.map((content, index) =>
          encodeContentRow(content, { owner: ownerOf(index) }),
        ),
      },
    ]);
    const store = new JournalHistoryStore(session);
    open.push(store);
    return { store, session };
  }

  async function ownersOf(session: JournalSession): Promise<number[]> {
    const entries: RowEntry[] = [];
    for await (const entry of session.store.rows()) entries.push(entry);
    return entries.map((entry) => entry.owner);
  }

  /** A stamper that gives a fresh row the number after the highest it has seen. */
  function stamper() {
    const seen: number[] = [];
    return {
      seen,
      stamp: (row: IContent): IContent => {
        const existing = row.metadata?.chronology?.seq;
        if (existing !== undefined) {
          seen.push(existing);
          return row;
        }
        const next = Math.max(0, ...seen) + 1;
        seen.push(next);
        row.metadata = { ...row.metadata, chronology: marker(next) };
        return row;
      },
    };
  }

  describe('validateAndFix', () => {
    it('inserts a synthetic response after the row whose call has none, under that row owner', async () => {
      const { store, session } = await seeded(
        'repair.llxj',
        [human('go', 1), calls(2, 'a', 'b'), answer(3, 'a'), human('next', 4)],
        (index) => (index === 1 ? 2 : 0),
      );
      const { stamp, seen } = stamper();

      const repair = await store.validateAndFix({ stamp });

      expect(repair.inserted).toHaveLength(1);
      expect(repair.inserted[0].speaker).toBe('tool');
      expect(repair.inserted[0].metadata?.synthetic).toBe(true);
      expect(repair.inserted[0].metadata?.chronology?.seq).toBe(5);
      expect(seen.slice(0, 4)).toStrictEqual([1, 2, 3, 4]);
      expect(store.getLength()).toBe(5);
      expect(shapeOf(await store.materialize())).toStrictEqual([
        'go',
        'call:a,call:b',
        'resp:b',
        'resp:a',
        'next',
      ]);
      expect(await ownersOf(session)).toStrictEqual([0, 2, 2, 0, 0]);
      await repair.close();
    });

    it('treats a response anywhere in the history as an answer', async () => {
      const { store } = await seeded('repair-late.llxj', [
        human('go', 1),
        calls(2, 'a'),
        human('later', 3),
        answer(4, 'a'),
      ]);

      const repair = await store.validateAndFix({ stamp: stamper().stamp });

      expect(repair.inserted).toHaveLength(0);
      expect(store.getLength()).toBe(4);
      expect(store.lastAck).toBeUndefined();
    });

    it('answers one call id once when two rows call it', async () => {
      const { store } = await seeded('repair-twice.llxj', [
        calls(1, 'a'),
        calls(2, 'a'),
      ]);

      const repair = await store.validateAndFix({ stamp: stamper().stamp });

      expect(repair.inserted).toHaveLength(1);
      expect(shapeOf(await store.materialize())).toStrictEqual([
        'call:a',
        'resp:a',
        'call:a',
      ]);
    });

    it('rollback puts the history back as it was and refuses once anything else was written', async () => {
      const { store } = await seeded('repair-rollback.llxj', [
        human('go', 1),
        calls(2, 'a'),
      ]);
      const before = shapeOf(await store.materialize());
      const repair = await store.validateAndFix({ stamp: stamper().stamp });
      expect(store.getLength()).toBe(3);

      await repair.rollback();

      expect(store.getLength()).toBe(2);
      expect(shapeOf(await store.materialize())).toStrictEqual(before);

      const second = await store.validateAndFix({ stamp: stamper().stamp });
      store.apply({ kind: 'content', content: human('more', 9) });
      await store.waitForDurable();
      await expect(second.rollback()).rejects.toThrow(
        'written since the repair',
      );
    });
  });

  describe('adoptMediaOwner', () => {
    it('hands the owner every row, one at a time', async () => {
      const { store } = await seeded('adopt.llxj', [
        human('a', 1),
        human('b', 2),
        human('c', 3),
      ]);
      const batches: string[][] = [];
      const owner = {
        adopt: (contents: Iterable<IContent>) => {
          batches.push(shapeOf([...contents]));
        },
      };

      await store.adoptMediaOwner(owner);

      expect(batches).toStrictEqual([['a'], ['b'], ['c']]);
    });
  });
});
