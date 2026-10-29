/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';

describe('top-down sealed token accounting', () => {
  it('subtracts an old row using its blocks instead of hydrating the row for counting', async () => {
    const history = new HistoryService();
    const rows: IContent[] = Array.from({ length: 4 }, (_, index) => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: `row${index} `.repeat(20000) }],
    }));
    try {
      history.addAll(rows);
      await history.waitForTokenUpdates();
      const input = await history.openCompressionInput();
      try {
        const original = input.rows.readRow.bind(input.rows);
        spyOn(input.rows, 'readRow').mockImplementation((index) => {
          if (index === 0) throw new Error('count hydrated an old row');
          return original(index);
        });
        const runtime = buildRuntimeContext(history, {
          compressionStrategy: 'top-down-truncation',
        });
        const metadata = await buildCompressionMetadata(
          'prompt',
          runtime,
          undefined,
          history,
          async () => {
            throw new Error('Truncation does not use a provider');
          },
          undefined,
          undefined,
          new DebugLogger('topdown-token-stream'),
        );
        const targetTokenCount = await history.estimateTokensForContents(
          rows.slice(2),
        );
        const result = await new TopDownTruncationStrategy().compressDisk({
          ...metadata,
          history: input.rows,
          currentTokenCount: targetTokenCount * 2,
          targetTokenCount,
        });
        expect(result.kind).toBe('applied');
        if (result.kind !== 'applied') throw new Error('Expected truncation');
        expect(result.start).toBe(2);
      } finally {
        await input.close();
      }
    } finally {
      await history.dispose();
    }
  });
});
