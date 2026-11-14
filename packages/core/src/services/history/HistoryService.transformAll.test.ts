import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createUserMessage } from './IContent.js';
import type { IContent } from './IContent.js';
import { HistoryService } from './HistoryService.js';
const historyScratchRoots = createTestScratchOwner();

function texts(content: IContent): string[] {
  return content.blocks.flatMap((block) =>
    block.type === 'text' ? [block.text] : [],
  );
}

async function historyTexts(history: HistoryService): Promise<string[]> {
  const result: string[] = [];
  for await (const row of history.streamRawHistory())
    result.push(...texts(row));
  return result;
}

describe('HistoryService detached transform serialization', () => {
  it('sees entries committed by writes queued before it', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    history.add(createUserMessage('first'));
    const queued = history.addBatch([createUserMessage('queued batch')]);
    const seen: string[] = [];

    await history.detachedValues.transform(async (source, sink) => {
      let index = 0;
      for await (const row of source.streamRows()) {
        seen.push(...texts(row));
        await sink.appendDerived(index++, row);
      }
      await sink.appendValue(createUserMessage('from transform'));
    });
    await queued;

    expect({ seen, final: await historyTexts(history) }).toStrictEqual({
      seen: ['first', 'queued batch'],
      final: ['first', 'queued batch', 'from transform'],
    });
  });

  it('commits nothing when the transform throws and keeps the queue usable', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    history.add(createUserMessage('first'));

    const failure = await history.detachedValues
      .transform(async () => {
        throw new Error('no change wanted');
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await history.addBatch([createUserMessage('after failure')]);

    expect({
      message: failure instanceof Error ? failure.message : undefined,
      final: await historyTexts(history),
    }).toStrictEqual({
      message: 'no change wanted',
      final: ['first', 'after failure'],
    });
  });
});
