/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

describe('detached history API publishes through the store port', () => {
  it('hands an append and a replacement to the store, which publishes them', async () => {
    const publish = spyOn(HistoryJournalStore.prototype, 'publishDetached');
    try {
      const history = new HistoryService({});

      await history.detachedValues.append([row('human', 'one')]);
      await history.detachedValues.replace([row('human', 'two')]);

      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls[0][0].append).toBe(true);
      expect(publish.mock.calls[1][0].append).toBe(false);
      const texts: string[] = [];
      for await (const content of history.streamRawHistory()) {
        texts.push(
          content.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
        );
      }
      expect(texts).toStrictEqual(['two']);
    } finally {
      publish.mockRestore();
    }
  });
});
