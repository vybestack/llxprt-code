/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';

import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

/**
 * The journal twin of history-profile-adoption.test.ts (WIRING G3). A journal
 * group is visible at its ack, so staging writes the candidate's rows into
 * the live history and records the mark to go back to; commit() flips the
 * service state and rollback() returns to the mark. The old-store test keeps
 * the contract that nothing changes before commit.
 */
function text(speaker: 'human' | 'ai', value: string): IContent {
  return { speaker, blocks: [{ type: 'text', text: value }] };
}

async function rawHistory(history: HistoryService): Promise<IContent[]> {
  return Array.fromAsync(history.streamRawHistory());
}

describe('profile history adoption on the journal store', () => {
  const created: HistoryService[] = [];

  afterEach(async () => {
    for (const history of created.splice(0)) await history.dispose();
  });

  async function pair(
    liveRows: IContent[],
    candidateRows: IContent[],
  ): Promise<{ live: HistoryService; candidate: HistoryService }> {
    const live = new HistoryService();
    const candidate = new HistoryService();
    created.push(live, candidate);
    await live.addBatch(liveRows);
    await candidate.addBatch(structuredClone(await rawHistory(live)));
    await candidate.clear();
    await candidate.addBatch(candidateRows);
    return { live, candidate };
  }

  it('shows the candidate rows at staging and adopts its token accounting at commit, retaining live subscribers', async () => {
    const { live, candidate } = await pair(
      [text('human', 'before')],
      [text('human', 'before'), text('ai', 'staged')],
    );
    candidate.syncTotalTokens(1234);
    await candidate.waitForTokenUpdates();
    const staged = await rawHistory(candidate);
    const observed: number[] = [];
    live.on('tokensUpdated', ({ totalTokens }) => observed.push(totalTokens));

    const commit = await live.prepareProfileAdoption(candidate);
    expect(await rawHistory(live)).toStrictEqual(staged);
    commit();
    expect(live.getTotalTokens()).toBe(1234);

    await candidate.clear();
    expect(await rawHistory(live)).toStrictEqual(staged);
    live.syncTotalTokens(2345);
    await live.waitForTokenUpdates();
    expect(observed).toContain(2345);
  });

  it('returns to the previous rows on rollback and refuses a second settlement', async () => {
    const { live, candidate } = await pair(
      [text('human', 'live')],
      [text('human', 'live'), text('ai', 'staged')],
    );
    const before = await rawHistory(live);

    const commit = await live.prepareProfileAdoption(candidate);
    await commit.rollback();

    expect(await rawHistory(live)).toStrictEqual(before);
    expect(() => commit()).toThrow('already settled');
  });

  it('refuses to commit when the live history was written after staging', async () => {
    const { live, candidate } = await pair(
      [text('human', 'live')],
      [text('human', 'live'), text('ai', 'staged')],
    );

    const commit = await live.prepareProfileAdoption(candidate);
    live.add(text('human', 'concurrent'));
    await live.waitForCommit();

    expect(() => commit()).toThrow('live history changed');
    expect(JSON.stringify(await rawHistory(live))).toContain('concurrent');
  });

  it('uses the candidate tokenizer and target for accounting after commit', async () => {
    const live = new HistoryService();
    const candidate = new HistoryService();
    created.push(live, candidate);
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
    await candidate.addBatch([text('human', 'accounted')], 'destination-model');
    candidate.setBaseTokenOffset(17);
    const total = candidate.getTotalTokens();

    const commit = await live.prepareProfileAdoption(candidate);
    expect(live.getBaseTokenOffset()).toBe(0);
    commit();

    expect(live.getTotalTokens()).toBe(total);
    expect(live.getBaseTokenOffset()).toBe(17);
    const extra = [text('ai', 'next tokens')];
    const increment = await live.estimateTokensForContents(
      extra,
      'destination-model',
    );
    await live.addBatch(extra, 'destination-model');
    expect(live.getTotalTokens()).toBe(total + increment);
    expect(await live.estimateTokensForText('abc')).toBe(9);
    expect(candidate.getTotalTokens()).toBe(0);
  });

  it('adopts a candidate with a different length, longer or shorter', async () => {
    const longer = await pair(
      [text('human', 'one')],
      [text('human', 'one'), text('ai', 'two'), text('human', 'three')],
    );
    (await longer.live.prepareProfileAdoption(longer.candidate))();
    expect(await rawHistory(longer.live)).toStrictEqual(
      await rawHistory(longer.candidate),
    );
    expect(await rawHistory(longer.live)).toHaveLength(3);

    const shorter = await pair(
      [text('human', 'one'), text('ai', 'two'), text('human', 'three')],
      [text('human', 'one')],
    );
    (await shorter.live.prepareProfileAdoption(shorter.candidate))();
    expect(await rawHistory(shorter.live)).toStrictEqual(
      await rawHistory(shorter.candidate),
    );
    expect(await rawHistory(shorter.live)).toHaveLength(1);
  });

  it('adopts modified content such as stripped thought signatures', async () => {
    const thinking = (signature?: string): IContent => ({
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
    const { live, candidate } = await pair(
      [text('human', 'question'), thinking('sig-1')],
      [text('human', 'question'), thinking()],
    );

    (await live.prepareProfileAdoption(candidate))();

    const adopted = await rawHistory(live);
    expect(adopted).toStrictEqual(await rawHistory(candidate));
    expect(JSON.stringify(adopted)).not.toContain('sig-1');
  });

  it('leaves the live history unchanged when reading the candidate fails', async () => {
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
    // The failure came after the group's first record was written, so the
    // writer is poisoned (groupWriter.runGroup) and takes no later append.
    // The old-store case appends after the failure; the rows stay readable.
    await expect(live.addBatch([text('ai', 'after')])).rejects.toThrow(
      'accepts no more writes',
    );
    expect(await rawHistory(live)).toStrictEqual(before);
  });
});
