/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

describe('detached history API publishes through the store port', () => {
  it('appends without losing prior rows and replaces the committed history', async () => {
    const history = new HistoryService();
    try {
      await history.detachedValues.append([row('human', 'one')]);
      expect(
        (await collectRawHistory(history)).map((entry) => entry.blocks),
      ).toStrictEqual([row('human', 'one').blocks]);
      await history.detachedValues.append([row('ai', 'reply')]);
      expect(
        (await collectRawHistory(history)).map((entry) => entry.blocks),
      ).toStrictEqual([row('human', 'one').blocks, row('ai', 'reply').blocks]);
      await history.detachedValues.replace([row('human', 'two')]);
      expect(
        (await collectRawHistory(history)).map((entry) => entry.blocks),
      ).toStrictEqual([row('human', 'two').blocks]);
    } finally {
      await history.dispose();
    }
  });
});
