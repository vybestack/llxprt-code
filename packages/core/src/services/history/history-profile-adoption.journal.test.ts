/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HISTORY_BACKEND_ENV } from './historyBackendSelect.js';
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
  const saved = process.env[HISTORY_BACKEND_ENV];
  const created: HistoryService[] = [];
  beforeEach(() => {
    process.env[HISTORY_BACKEND_ENV] = 'journal';
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
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
});
