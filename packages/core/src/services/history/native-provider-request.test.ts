/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { streamCuratedProviderHistory } from './historyCuration.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalProviderRequestSnapshot } from './journal-provider-request.js';
import { prepareProviderContentSnapshot } from './provider-curated-stream.js';
import type { ProviderRequestRows } from './provider-request-snapshot.js';

async function collect(rows: ProviderRequestRows): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows.openReader()) result.push(row);
  return result;
}

describe('native backend provider normalization', () => {
  it('uses the indexed request and overlays pending results without publishing them', async () => {
    const history = new HistoryService({});
    history.setTokenizerFactory(exactTokenizer());
    const tail: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'duplicate',
            toolName: 'read',
            result: 'pending winner',
            isComplete: true,
          },
        ],
      },
    ];
    try {
      await history.replaceAll([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'q' },
            { type: 'tool_call', id: 'cross', name: 'read', parameters: {} },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'cross', name: 'read', parameters: {} },
            {
              type: 'tool_call',
              id: 'duplicate',
              name: 'read',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'duplicate',
              toolName: 'read',
              result: null,
            },
          ],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
      ]);
      const logger = new DebugLogger('native-provider-test');
      const old = await prepareProviderContentSnapshot(
        streamCuratedProviderHistory(logger, history.streamRawHistory(), false),
        tail,
        logger,
      );
      const native = await history.prepareCuratedForProviderSnapshot(tail);
      try {
        expect(native instanceof JournalProviderRequestSnapshot).toBe(true);
        expect(await collect(native)).toStrictEqual(await collect(old));
        expect(native.count).toBe(old.count);
        expect(native.pending).toStrictEqual(old.pending);
        for (let index = 0; index < native.count; index++) {
          expect(await native.readAt(index)).toStrictEqual(
            await old.readAt(index),
          );
          expect(native.isPending(index)).toBe(old.isPending(index));
        }
        await history.addBatch([
          { speaker: 'human', blocks: [{ type: 'text', text: 'later' }] },
        ]);
        expect(await collect(native)).toStrictEqual(await collect(old));
        const persisted: IContent[] = [];
        for await (const row of history.streamRawHistory()) persisted.push(row);
        expect(
          persisted.some((row) =>
            row.blocks.some(
              (block) =>
                block.type === 'tool_response' &&
                block.result === 'pending winner',
            ),
          ),
        ).toBe(false);
      } finally {
        await native.close();
        await old.close();
      }
    } finally {
      await history.dispose();
    }
  });
});
