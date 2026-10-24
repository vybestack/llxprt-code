/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { observeWholeProductRetention } from './whole-product-retention.js';

describe('whole-product retention observer', () => {
  it('observes native decoded rows without replacing the request capability', async () => {
    const history = new HistoryService();
    const observer = observeWholeProductRetention(true, true);
    observer.start();
    try {
      const snapshot = await history.prepareCuratedForProviderSnapshot([
        { speaker: 'human', blocks: [{ type: 'text', text: 'native row' }] },
      ]);
      try {
        if (snapshot.native === undefined)
          throw new Error('Retention observer dropped the native capability');
        for await (const row of snapshot.native.indexed.openReader())
          expect(row.blocks).toStrictEqual([
            { type: 'text', text: 'native row' },
          ]);
        expect(observer.retained()).toBe(1);
      } finally {
        await snapshot.close();
      }
      expect(observer.lifetime()).toStrictEqual({
        prepared: 1,
        closed: 1,
        outstanding: 0,
      });
    } finally {
      observer.restore();
      await history.dispose();
    }
  });
});
