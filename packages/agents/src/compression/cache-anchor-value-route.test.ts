/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { applyCompressionWithAnchor } from './cacheAnchor.js';
import { detachedRow } from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  rowsOf,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';

class ValueAnchorHistory extends HistoryService {
  override replaceAll(): Promise<void> {
    throw new Error('Compression must publish disk-backed values directly');
  }
}

describe('cache anchor value publication', () => {
  it('publishes ordered values, anchor, span and stateful invalidation without the legacy array replacement route', async () => {
    const history = new ValueAnchorHistory();
    history.setTokenizerFactory(exactTokenizer());
    try {
      await history.detachedValues.replace([
        detachedRow(0),
        detachedRow(1),
        detachedRow(2),
      ]);
      const summary = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'retained facts' }],
        metadata: { isSummary: true, responsesStored: true },
      } satisfies Parameters<typeof applyCompressionWithAnchor>[1][number];
      await applyCompressionWithAnchor(
        history,
        [detachedRow(0), summary],
        1,
        'test',
      );
      const stored = await rowsOf(history);
      expect(stored.map((row) => row.blocks)).toStrictEqual([
        detachedRow(0).blocks,
        summary.blocks,
      ]);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(
        stored.map((row) => row.metadata?.cacheAnchor === true),
      ).toStrictEqual([true, false]);
      expect(stored[1].metadata?.chronologyReplaced).toStrictEqual({
        fromSeq: 2,
        toSeq: 3,
        itemCount: 2,
      });
      expect(stored[1].metadata?.responsesStored).toBeUndefined();
      expect(summary.metadata).toStrictEqual({
        isSummary: true,
        responsesStored: true,
      });
    } finally {
      history.dispose();
    }
  });
});
