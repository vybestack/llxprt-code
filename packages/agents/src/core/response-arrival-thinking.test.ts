/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { StreamOutputAccumulator } from './streamOutputAccumulator.js';
import { consolidateTextBlocks } from './streamResponseHelpers.js';

const corpora: ReadonlyArray<{ name: string; blocks: ContentBlock[] }> =
  Object.freeze([
    {
      name: 'Anthropic signed and redacted thinking',
      blocks: [
        {
          type: 'thinking',
          thought: 'Check',
          streamId: 'thinking-0',
          streamStatus: 'delta',
          sourceField: 'thinking',
        },
        {
          type: 'thinking',
          thought: 'Check the answer',
          streamId: 'thinking-0',
          streamStatus: 'complete',
          sourceField: 'thinking',
          signature: 'anthropic-frozen-signature',
          isHidden: false,
        },
        {
          type: 'thinking',
          thought: '[redacted]',
          signature: 'redacted-frozen-data',
          isHidden: true,
        },
        { type: 'text', text: 'Answer.' },
      ],
    },
    {
      name: 'Responses reasoning identity and encrypted content',
      blocks: [
        {
          type: 'thinking',
          thought: 'Reasoning summary',
          encryptedContent: 'encrypted-frozen',
          providerMetadata: { 'openai.responses.reasoningId': 'rs_frozen_17' },
        },
        { type: 'text', text: 'Answer.' },
      ],
    },
  ]);
describe('thinking arrival parity', () => {
  for (const corpus of corpora) {
    it(`seals the same blocks as the old finalizer for ${corpus.name}`, async () => {
      const history = new HistoryService();
      try {
        const arrival = await history.openResponseArrival({
          id: 'attempt',
          submissionId: 'prompt',
        });
        const accumulator = new StreamOutputAccumulator();
        for (const block of corpus.blocks) {
          accumulator.add({ content: { speaker: 'ai', blocks: [block] } });
          await arrival.append(block);
        }
        await arrival.seal({});
        const rows = await Array.fromAsync(history.streamRawHistory());
        expect(rows).toHaveLength(1);
        expect(rows[0].blocks).toStrictEqual(
          consolidateTextBlocks(accumulator.materialize().content.blocks),
        );
      } finally {
        await history.dispose();
      }
    });
  }
});
