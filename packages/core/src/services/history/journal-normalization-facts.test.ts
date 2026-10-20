/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { ROW_ID_KIND } from '../../journal/rowRecord.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';

const split = {
  speaker: 'tool',
  blocks: [{ type: 'text', text: 'before' }, response('a'), call('a')],
} satisfies import('./IContent.js').IContent;

describe('native source normalization facts', () => {
  const directory = useTempDir('native-source-facts-');

  it('stores empty ids in the real ROW id piece instead of silently omitting them', () => {
    const draft = encodeContentRow(
      { speaker: 'ai', blocks: [call(''), response('')] },
      { owner: 0 },
    );
    expect(
      draft.ids.map(({ rawId, kind, block }) => ({ rawId, kind, block })),
    ).toStrictEqual([
      { rawId: '', kind: ROW_ID_KIND.call, block: 0 },
      { rawId: '', kind: ROW_ID_KIND.response, block: 1 },
    ]);
  });

  it('indexes split part positions through append, fill and header-only rebuild, preserving ownership and content', async () => {
    const session = await JournalSession.create(`${directory()}/facts.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([split], { owner: 7 });
      const before = await session.store.idFacts();
      const fact = await before.fact('a');
      await before.close();
      expect(fact).toMatchObject({
        firstCall: { label: 1048576n, part: 0, block: 0 },
        firstAiCall: { label: 1048576n, part: 0, block: 0 },
        firstResponse: { label: 1048576n, part: 1, block: 1 },
        firstToolResponse: { label: 1048576n, part: 1, block: 1 },
        best: { label: 1048576n, part: 1, block: 1 },
      });
      await session.store.commit([
        {
          kind: 'fill',
          fills: [
            {
              label: 1048576n,
              tokens: [
                [3, 0, 0, 0],
                [0, 0, 0, 0],
                [0, 0, 0, 0],
              ],
            },
          ],
        },
      ]);
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'discarded' }] },
      ]);
      await session.store.commit([
        { kind: 'density', replacements: [], removed: [2097152n] },
      ]);
      const after = await session.store.idFacts();
      expect(await after.fact('a')).toStrictEqual(fact);
      await after.close();
      const rows = [];
      for await (const row of session.rows()) rows.push(row);
      expect(
        rows.map(({ content, entry }) => ({ content, owner: entry.owner })),
      ).toStrictEqual([{ content: split, owner: 7 }]);
      expect(await readdir(directory())).toStrictEqual(['facts.llxj']);
    } finally {
      await session.close();
    }
  });

  it('keeps C separate from Ca, accepts human-row results, chooses better duplicates and skips uncurated facts', async () => {
    const session = await JournalSession.create(`${directory()}/cross.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('a')] },
        { speaker: 'ai', blocks: [call('a')] },
        { speaker: 'human', blocks: [response('a', false)] },
        { speaker: 'tool', blocks: [response('a')] },
      ]);
      const excluded = encodeContentRow(
        { speaker: 'ai', blocks: [call('excluded')] },
        { owner: 0 },
      );
      await session.store.commit([
        { kind: 'append', rows: [{ ...excluded, flags: 0 }] },
      ]);
      const facts = await session.store.idFacts();
      expect((await facts.fact('a'))?.firstCall?.label).toBe(1048576n);
      expect((await facts.fact('a'))?.firstAiCall?.label).toBe(2097152n);
      expect((await facts.fact('a'))?.firstResponse?.label).toBe(3145728n);
      expect((await facts.fact('a'))?.best?.label).toBe(4194304n);
      expect(await facts.fact('excluded')).toBeUndefined();
      await expect(facts.normalizedCount(1, 0, 'call_a')).rejects.toThrow(
        'Normalized unit occurrences are not available',
      );
      await facts.close();
    } finally {
      await session.close();
    }
  });
});
