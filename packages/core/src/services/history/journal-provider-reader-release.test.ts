/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  collectedWithin,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { HistoryService } from './HistoryService.js';
import type { ContentBlock, IContent } from './IContent.js';
import { HistoryReaderScope } from './historyReaderScope.js';

function scopedReader(scope: HistoryReaderScope): {
  reader: AsyncGenerator<IContent, void, unknown>;
  source: WeakRef<object>;
} {
  const source = (async function* (): AsyncGenerator<IContent, void, unknown> {
    yield { speaker: 'human', blocks: [{ type: 'text', text: 'delivered' }] };
  })();
  return { reader: scope.open(source), source: new WeakRef(source) };
}

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
  it.each(['exhaust', 'return'])(
    'releases its source after %s while the public reader is still held',
    async (mode) => {
      const scope = new HistoryReaderScope('closed');
      const { reader, source } = scopedReader(scope);
      try {
        const references = await readReferences(reader);
        const completed =
          mode === 'exhaust' ? await reader.next() : await reader.return();
        expect(completed.done).toBe(true);
        expect(await collectedWithin(source)).toBe(true);
        expect(await collectedWithin(references.row)).toBe(true);
        expect(await reader.next()).toStrictEqual({
          done: true,
          value: undefined,
        });
      } finally {
        await scope.close();
      }
    },
  );
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
