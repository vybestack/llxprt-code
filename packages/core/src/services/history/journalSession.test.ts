/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ROW_FLAG } from '../../journal/rowRecord.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';
import {
  CHRONOLOGY,
  ROW_SHAPES,
} from './__tests__/support/journalRowShapes.js';

async function contentsOf(session: JournalSession): Promise<IContent[]> {
  const contents: IContent[] = [];
  for await (const row of session.rows()) contents.push(row.content);
  return contents;
}

describe('journal session', () => {
  const directory = useTempDir('journal-session-');
  const open: JournalSession[] = [];
  afterEach(async () => {
    for (const session of open.splice(0)) await session.close();
  });

  async function created(name: string): Promise<JournalSession> {
    const session = await JournalSession.create(path.join(directory(), name), {
      journal: testJournalSeams().dependencies,
    });
    open.push(session);
    return session;
  }

  it('reads back every shape of entry in order, from the same session and after a reopen', async () => {
    const file = path.join(directory(), 'shapes.llxj');
    const contents = ROW_SHAPES.map(([, content]) => content);
    const session = await JournalSession.create(file, {
      journal: testJournalSeams().dependencies,
    });
    await session.append(contents);

    expect(await contentsOf(session)).toStrictEqual(contents);
    await session.close();

    const reopened = await JournalSession.open(file, {
      journal: testJournalSeams().dependencies,
    });
    open.push(reopened);
    expect(await contentsOf(reopened)).toStrictEqual(contents);
    expect(reopened.store.published?.rows).toBe(contents.length);
  });

  it('writes rows with the owner, the chronology and the id facts the codec derived', async () => {
    const session = await created('facts.llxj');
    const [call, response] = [
      ROW_SHAPES[2][1],
      { ...ROW_SHAPES[4][1], metadata: { chronology: CHRONOLOGY } },
    ];
    await session.append([call], { owner: 5 });
    await session.append([response]);

    const rows = [];
    for await (const row of session.rows()) rows.push(row);
    expect(rows.map((row) => row.entry.owner)).toStrictEqual([5, 0]);
    expect(rows[0].entry.flags & ROW_FLAG.hasToolCall).toBe(
      ROW_FLAG.hasToolCall,
    );
    expect(rows[1].entry.chronologySeq).toBe(7n);
    const fact = await (await session.store.idFacts()).fact('call-1');
    expect(fact?.callCount).toBe(1);
    expect(fact?.respCount).toBe(1);
  });

  it('keeps the Responses stateful chain invalid for rows appended with the flag', async () => {
    const session = await created('invalidate.llxj');
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'a' }],
      metadata: { responsesStored: true, id: 'r1' },
    };
    await session.append([content], { invalidateResponses: true });
    await session.append([content]);

    const stored = (await contentsOf(session)).map(
      (entry) => entry.metadata?.responsesStored,
    );
    expect(stored).toStrictEqual([undefined, true]);
  });
});

describe('bare store', () => {
  const directory = useTempDir('journal-bare-');

  it('keeps its rows in a file with no name, leaves nothing in the directory, and is gone on close', async () => {
    const session = await JournalSession.createUnlinked({
      unlinkedDirectory: directory(),
    });
    const contents = ROW_SHAPES.map(([, content]) => content);

    await session.append(contents);

    expect(await fsp.readdir(directory())).toStrictEqual([]);
    expect(await contentsOf(session)).toStrictEqual(contents);
    await session.close();
    expect(await fsp.readdir(directory())).toStrictEqual([]);
  });
});
