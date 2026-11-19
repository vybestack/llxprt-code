/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { testJournalOptions } from '../../journal/__tests__/support/namedWriterOwner.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';
import { ROW_SHAPES } from './__tests__/support/journalRowShapes.js';

const DROPPED: readonly IContent[] = ROW_SHAPES.filter(([, content]) =>
  content.blocks.some((block) => block.type === 'media_dropped'),
).map(([, content]) => content);

async function contentsOf(session: JournalSession): Promise<IContent[]> {
  const contents: IContent[] = [];
  for await (const row of session.rows()) contents.push(row.content);
  return contents;
}

describe('dropped media in a journal', () => {
  const directory = useTempDir('media-dropped-journal-');
  const open: JournalSession[] = [];
  afterEach(async () => {
    for (const session of open.splice(0)) await session.close();
  });

  async function opened(
    file: string,
    create: boolean,
  ): Promise<JournalSession> {
    const options = testJournalOptions({
      journal: testJournalSeams().dependencies,
    });
    const session = create
      ? await JournalSession.create(file, options)
      : await JournalSession.open(file, options);
    open.push(session);
    return session;
  }

  it('has both dropped shapes to carry', () => {
    expect(DROPPED).toHaveLength(2);
  });

  it('keeps the references through a checkpoint restore', async () => {
    const session = await opened(path.join(directory(), 'restore.llxj'), true);
    await session.append(DROPPED);
    const saved = session.store.published;
    if (saved === undefined) throw new Error('No published version');
    await session.append([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'later' }] },
    ]);

    await session.store.commit([{ kind: 'restore', saved }]);

    expect(await contentsOf(session)).toStrictEqual([...DROPPED]);
  });

  it('keeps the references in an unlinked clone', async () => {
    const session = await opened(path.join(directory(), 'clone.llxj'), true);
    await session.append(DROPPED);

    const clone = await session.cloneUnlinked({
      unlinkedDirectory: directory(),
    });
    open.push(clone);

    expect(await contentsOf(clone)).toStrictEqual([...DROPPED]);
  });

  it('keeps the references through compaction and a reopen', async () => {
    const file = path.join(directory(), 'compact.llxj');
    const session = await opened(file, true);
    await session.append(DROPPED);
    await session.append([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'after' }] },
    ]);

    await session.store.compact();
    expect(await contentsOf(session)).toStrictEqual([
      ...DROPPED,
      { speaker: 'ai', blocks: [{ type: 'text', text: 'after' }] },
    ]);
    await session.close();
    open.splice(open.indexOf(session), 1);

    const reopened = await opened(file, false);
    expect(await contentsOf(reopened)).toStrictEqual([
      ...DROPPED,
      { speaker: 'ai', blocks: [{ type: 'text', text: 'after' }] },
    ]);
  });
});
