/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { buildCuratedHistory } from './historyCuration.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalProviderRequestSnapshot } from './journal-provider-request.js';
import { buildProviderContent } from './historyProviderPipeline.js';
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
      const raw: IContent[] = [];
      for await (const row of history.streamRawHistory()) raw.push(row);
      const expected = buildProviderContent(
        buildCuratedHistory(logger, raw, false),
        structuredClone(tail),
        logger,
      );
      const pending = expected.map((row) =>
        row.blocks.some(
          (block) =>
            block.type === 'tool_response' && block.result === 'pending winner',
        ),
      );
      const native = await history.prepareCuratedForProviderSnapshot(tail);
      try {
        expect(native instanceof JournalProviderRequestSnapshot).toBe(true);
        expect(await collect(native)).toStrictEqual(expected);
        expect(native.count).toBe(expected.length);
        expect(native.pending).toStrictEqual({
          inputCount: tail.length,
          firstOutputIndex: pending.indexOf(true),
        });
        for (let index = 0; index < native.count; index++) {
          expect(await native.readAt(index)).toStrictEqual(expected[index]);
          expect(native.isPending(index)).toBe(pending[index]);
        }
        await history.addBatch([
          { speaker: 'human', blocks: [{ type: 'text', text: 'later' }] },
        ]);
        expect(await collect(native)).toStrictEqual(expected);
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
      }
    } finally {
      await history.dispose();
    }
  });
});
