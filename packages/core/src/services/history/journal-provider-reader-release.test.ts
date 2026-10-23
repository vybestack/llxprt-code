/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { HistoryService } from './HistoryService.js';
import type { ContentBlock, IContent } from './IContent.js';

async function readReferences(
  reader: AsyncGenerator<IContent, void, unknown>,
): Promise<{
  readonly row: WeakRef<IContent>;
  readonly block: WeakRef<ContentBlock>;
}> {
  const next = await reader.next();
  if (next.done === true) throw new Error('Missing provider row');
  return {
    row: new WeakRef(next.value),
    block: new WeakRef(next.value.blocks[0]),
  };
}

describe('journal provider reader row release', () => {
  it('does not retain a delivered row while the consumer is paused', async () => {
    const history = new HistoryService();
    await history.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ]);
    const snapshot = await history.prepareCuratedForProviderSnapshot();
    const reader = snapshot.openReader();
    try {
      const references = await readReferences(reader);
      await settledHeap();
      expect(references.row.deref()).toBeUndefined();
      expect(references.block.deref()).toBeUndefined();
      expect((await reader.next()).done).toBe(false);
    } finally {
      await reader.return();
      await snapshot.close();
      await history.dispose();
    }
  });
});
