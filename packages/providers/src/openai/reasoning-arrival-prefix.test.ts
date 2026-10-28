/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { parseResponsesStream } from './parseResponsesStream.js';

describe('Responses reasoning arrival prefixes', () => {
  it.each(
    ['reasoning_text', 'reasoning_summary_text'].flatMap((source) =>
      ['done', 'item', 'response'].map((ending) => ({ source, ending })),
    ),
  )(
    'records exact split-word text and whitespace ($source, $ending)',
    async ({ source, ending }) => {
      const history = new HistoryService();
      const arrival = await history.openResponseArrival({
        id: 'reasoning',
        submissionId: 'prompt',
      });
      const deltas = [' Inspect', 'ing 4', 'k files ', '\n'];
      const thought = deltas.join('');
      const events: unknown[] = deltas.map((delta) => ({
        type: `response.${source}.delta`,
        delta,
      }));
      if (ending === 'done')
        events.push({ type: `response.${source}.done`, text: thought });
      if (ending !== 'response')
        events.push({
          type: 'response.output_item.done',
          item: {
            type: 'reasoning',
            id: 'item',
            summary: [{ type: 'summary_text', text: thought }],
          },
        });
      events.push({
        type: 'response.completed',
        response: { id: 'response', status: 'completed', output: [] },
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events)
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          controller.close();
        },
      });
      try {
        const snapshots: string[] = [];
        for await (const content of parseResponsesStream(stream)) {
          for (const block of content.blocks) {
            snapshots.push(
              ...(block.type === 'thinking' ? [block.thought] : []),
            );
            await arrival.append(block);
          }
        }
        await arrival.seal({});
        expect(snapshots).toStrictEqual([
          ' Inspect',
          ' Inspecting 4',
          ' Inspecting 4k files ',
          ' Inspecting 4k files \n',
          ' Inspecting 4k files \n',
        ]);
        const rows = await Array.fromAsync(history.streamRawHistory());
        expect(rows).toHaveLength(1);
        expect(rows[0].blocks).toStrictEqual([
          expect.objectContaining({ type: 'thinking', thought }),
        ]);
      } finally {
        await arrival.interrupt('cancelled');
        await history.dispose();
      }
    },
  );
});
