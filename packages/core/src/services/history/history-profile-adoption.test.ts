/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

describe('profile history adoption', () => {
  it('uses the candidate tokenizer and target for subsequent accounting without changing live preparation state', async () => {
    const live = new HistoryService();
    const candidate = new HistoryService();
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
    expect(live.getAll()).toStrictEqual([]);
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
    const before = live.getAll();
    const candidate = new HistoryService();
    candidate.startCompression();
    await expect(live.prepareProfileAdoption(candidate)).rejects.toThrow(
      'idle histories',
    );
    expect(live.getAll()).toStrictEqual(before);
  });

  it('adopts prepared contents and token accounting only at commit, retaining live subscribers', async () => {
    const live = new HistoryService();
    await live.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'before' }] },
    ]);
    const candidate = new HistoryService();
    await candidate.addBatch(structuredClone(live.getAll()));
    await candidate.addBatch([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'staged' }] },
    ]);
    candidate.syncTotalTokens(1234);
    await candidate.waitForTokenUpdates();
    const before = live.getAll();
    const beforeTokens = live.getTotalTokens();
    const staged = candidate.getAll();
    const observed: number[] = [];
    live.on('tokensUpdated', ({ totalTokens }) => observed.push(totalTokens));
    const commit = await live.prepareProfileAdoption(candidate);
    expect(live.getAll()).toStrictEqual(before);
    expect(live.getTotalTokens()).toBe(beforeTokens);
    expect(observed).toStrictEqual([]);
    commit();
    expect(live.getAll()).toStrictEqual(staged);
    expect(live.getTotalTokens()).toBe(1234);
    candidate.clear();
    await candidate.waitForTokenUpdates();
    expect(live.getAll()).toStrictEqual(staged);
    live.syncTotalTokens(2345);
    await live.waitForTokenUpdates();
    expect(observed).toContain(2345);
    expect(candidate.getAll()).toStrictEqual([]);
  });
});
