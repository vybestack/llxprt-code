/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectJournalFileRowsForAssertions } from './collect-rows-for-assertions.js';

function text(value: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text: value }] };
}

describe('collectJournalFileRowsForAssertions', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'collect-journal-'));
  });
  afterEach(async () => {
    await fsp.rm(directory, { recursive: true, force: true });
  });

  async function written(...values: string[]): Promise<string> {
    const file = path.join(directory, 'rows.llxj');
    const session = await JournalSession.create(file);
    await session.append(values.map(text));
    await session.close();
    return file;
  }

  it('hands the rows of a journal file to the assertion in order', async () => {
    const file = await written('one', 'two', 'three');
    let seen: string[] = [];
    await collectJournalFileRowsForAssertions(file, (rows) => {
      seen = rows.map((row) =>
        row.blocks[0].type === 'text' ? row.blocks[0].text : '',
      );
    });
    expect(seen).toStrictEqual(['one', 'two', 'three']);
  });

  it('propagates a failing assertion and still closes the file', async () => {
    const file = await written('one');
    await expect(
      collectJournalFileRowsForAssertions(file, () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
    // The file can be opened for its owner again, which a leaked handle on the lock would prevent.
    const session = await JournalSession.open(file);
    await session.close();
  });
});
