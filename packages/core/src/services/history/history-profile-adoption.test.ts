/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalResolver } from '../../recording/journalResolver.js';

async function rawHistory(history: HistoryService) {
  return Array.fromAsync(history.streamRawHistory());
}

/**
 * These cases assert the old store's contract: nothing changes in the live
 * history before commit. A journal group is visible at its ack, so the journal
 * store has its own contract in history-profile-adoption.journal.test.ts.
 */
function oldHistory(): HistoryService {
  return new HistoryService({ backend: 'old' });
}

describe('profile history adoption', () => {
  it('uses the candidate tokenizer and target for subsequent accounting without changing live preparation state', async () => {
    const live = oldHistory();
    const candidate = oldHistory();
    candidate.setTokenizerFactory({
      getTokenizer(provider, model) {
        if (provider !== 'destination' || model !== 'destination-model')
          throw new Error('Wrong tokenization target');
        return {
          countTokens: (content: unknown) => String(content).length * 3,
        };
      },
    });
    candidate.setActiveTokenizationTarget('destination-model', 'destination');
    await candidate.addBatch(
      [{ speaker: 'human', blocks: [{ type: 'text', text: 'accounted' }] }],
      'destination-model',
    );
    candidate.setBaseTokenOffset(17);
    const total = candidate.getTotalTokens();
    const commit = await live.prepareProfileAdoption(candidate);
    expect(await rawHistory(live)).toStrictEqual([]);
    expect(live.getBaseTokenOffset()).toBe(0);
    commit();
    expect(live.getTotalTokens()).toBe(total);
    expect(live.getBaseTokenOffset()).toBe(17);
    const extra = [
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'next tokens' }],
      },
    ];
    const increment = await live.estimateTokensForContents(
      extra,
      'destination-model',
    );
    await live.addBatch(extra, 'destination-model');
    expect(live.getTotalTokens()).toBe(total + increment);
    expect(await live.estimateTokensForText('abc')).toBe(9);
    expect(candidate.getTotalTokens()).toBe(0);
  });

  it('rejects a busy candidate without publishing its staged contents', async () => {
    const live = new HistoryService();
    await live.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'untouched' }] },
    ]);
    const before = await rawHistory(live);
    const candidate = new HistoryService();
    candidate.startCompression();
    await expect(live.prepareProfileAdoption(candidate)).rejects.toThrow(
      'idle histories',
    );
    expect(await rawHistory(live)).toStrictEqual(before);
  });

  it('adopts prepared contents and token accounting only at commit, retaining live subscribers', async () => {
    const live = oldHistory();
    await live.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'before' }] },
    ]);
    const candidate = oldHistory();
    await candidate.addBatch(structuredClone(await rawHistory(live)));
    await candidate.addBatch([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'staged' }] },
    ]);
    candidate.syncTotalTokens(1234);
    await candidate.waitForTokenUpdates();
    const before = await rawHistory(live);
    const beforeTokens = live.getTotalTokens();
    const staged = await rawHistory(candidate);
    const observed: number[] = [];
    live.on('tokensUpdated', ({ totalTokens }) => observed.push(totalTokens));
    const commit = await live.prepareProfileAdoption(candidate);
    expect(await rawHistory(live)).toStrictEqual(before);
    expect(live.getTotalTokens()).toBe(beforeTokens);
    expect(observed).toStrictEqual([]);
    commit();
    expect(await rawHistory(live)).toStrictEqual(staged);
    expect(live.getTotalTokens()).toBe(1234);
    await candidate.clear();
    await candidate.waitForTokenUpdates();
    expect(await rawHistory(live)).toStrictEqual(staged);
    live.syncTotalTokens(2345);
    await live.waitForTokenUpdates();
    expect(observed).toContain(2345);
    expect(await rawHistory(candidate)).toStrictEqual([]);
  });

  describe('journal replacement', () => {
    const text = (speaker: 'human' | 'ai', value: string): IContent => ({
      speaker,
      blocks: [{ type: 'text', text: value }],
    });
    const signed = (signature?: string): IContent => ({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'reasoning',
          sourceField: 'thinking',
          ...(signature === undefined ? {} : { signature }),
        },
      ],
    });

    async function pair(
      liveRows: IContent[],
      candidateRows: IContent[],
    ): Promise<{ live: HistoryService; candidate: HistoryService }> {
      const live = oldHistory();
      const candidate = oldHistory();
      if (liveRows.length > 0) await live.addBatch(liveRows);
      if (candidateRows.length > 0) await candidate.addBatch(candidateRows);
      return { live, candidate };
    }

    async function recordedRows(live: HistoryService): Promise<IContent[]> {
      await live.waitForCommit();
      const path = live.journalPath();
      if (path === null) throw new Error('Missing journal');
      const resolver = await JournalResolver.open(path, {});
      try {
        const rows: IContent[] = [];
        for await (const entry of resolver.resolve()) rows.push(entry.content);
        return rows;
      } finally {
        await resolver.close();
      }
    }

    it('adopts a candidate with a different length, longer or shorter', async () => {
      const longer = await pair(
        [text('human', 'one')],
        [text('human', 'one'), text('ai', 'two'), text('human', 'three')],
      );
      const longerCommit = await longer.live.prepareProfileAdoption(
        longer.candidate,
      );
      longerCommit();
      expect(await rawHistory(longer.live)).toStrictEqual(
        await rawHistory(longer.candidate),
      );
      expect(await rawHistory(longer.live)).toHaveLength(3);
      expect(await recordedRows(longer.live)).toStrictEqual(
        await rawHistory(longer.live),
      );

      const shorter = await pair(
        [text('human', 'one'), text('ai', 'two'), text('human', 'three')],
        [],
      );
      await shorter.candidate.addBatch(
        (await rawHistory(shorter.live)).slice(0, 1),
      );
      const shorterCommit = await shorter.live.prepareProfileAdoption(
        shorter.candidate,
      );
      shorterCommit();
      expect(await rawHistory(shorter.live)).toStrictEqual(
        await rawHistory(shorter.candidate),
      );
      expect(await recordedRows(shorter.live)).toStrictEqual(
        await rawHistory(shorter.live),
      );
    });

    it('adopts modified content such as stripped thought signatures', async () => {
      const { live, candidate } = await pair(
        [text('human', 'question'), signed('sig-1')],
        [text('human', 'question'), signed()],
      );
      const before = await rawHistory(live);
      const commit = await live.prepareProfileAdoption(candidate);
      expect(await rawHistory(live)).toStrictEqual(before);
      commit();
      const adopted = await rawHistory(live);
      expect(adopted).toStrictEqual(await rawHistory(candidate));
      expect(JSON.stringify(adopted)).not.toContain('sig-1');
      expect(await recordedRows(live)).toStrictEqual(adopted);
    });

    it('leaves the live history unchanged when staging fails', async () => {
      const { live, candidate } = await pair(
        [text('human', 'live')],
        [text('human', 'live'), text('ai', 'a'), text('human', 'b')],
      );
      const before = await rawHistory(live);
      const staged = candidate as unknown as {
        journal: { streamRows(): AsyncIterable<IContent> };
      };
      const original = staged.journal.streamRows.bind(staged.journal);
      staged.journal.streamRows = async function* () {
        let yielded = 0;
        for await (const row of original()) {
          if (yielded++ === 2) throw new Error('candidate read failed');
          yield row;
        }
      };
      await expect(live.prepareProfileAdoption(candidate)).rejects.toThrow(
        'candidate read failed',
      );
      expect(await rawHistory(live)).toStrictEqual(before);
      await live.addBatch([text('ai', 'after')]);
      const after = await rawHistory(live);
      expect(after.slice(0, before.length)).toStrictEqual(before);
      expect(after).toHaveLength(before.length + 1);
      expect(await recordedRows(live)).toStrictEqual(await rawHistory(live));
    });

    it('rolls back a prepared adoption without changing the live history', async () => {
      const { live, candidate } = await pair(
        [text('human', 'live')],
        [text('human', 'live'), text('ai', 'staged')],
      );
      const before = await rawHistory(live);
      const commit = await live.prepareProfileAdoption(candidate);
      await commit.rollback();
      expect(await rawHistory(live)).toStrictEqual(before);
      expect(() => commit()).toThrow('already settled');
      expect(await recordedRows(live)).toStrictEqual(before);
    });

    it('aborts the adoption when the live history changed after prepare', async () => {
      const { live, candidate } = await pair(
        [text('human', 'live')],
        [text('human', 'live'), text('ai', 'staged')],
      );
      const commit = await live.prepareProfileAdoption(candidate);
      live.add(text('human', 'concurrent'));
      await live.waitForCommit();
      const before = await rawHistory(live);
      expect(() => commit()).toThrow('live history changed');
      expect(await rawHistory(live)).toStrictEqual(before);
      expect(JSON.stringify(before)).toContain('concurrent');
      expect(JSON.stringify(before)).not.toContain('staged');
      expect(await recordedRows(live)).toStrictEqual(before);
    });
  });
});
