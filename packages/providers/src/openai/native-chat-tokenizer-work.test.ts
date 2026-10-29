/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { Tiktoken } from '@dqbd/tiktoken';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import type { RowFormatSettings } from '../../../core/src/journal/rowFormat.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { chatTokenMeasure } from './native-chat-estimate.js';
import { foldChatUnits } from './journal-chat-length.js';
import { oldMistralUnitTokens } from './__tests__/support/mistral-unit-token-oracle.js';

const model = 'mistral-large-latest';
const settings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: 2,
  model,
  endpoint: 'https://api.mistral.ai/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  chat: { includeInContext: true, toolFormat: 'mistral' },
};
const row: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought: 'reason 雪' },
    {
      type: 'tool_call',
      id: '123456789',
      name: 'read',
      parameters: { text: 'cold payload 雪 '.repeat(1800) },
    },
  ],
};

describe('native Chat thinking-variant tokenizer work', () => {
  for (const size of [400, 4000]) {
    it(`shares payload token counts within each of ${size} rows only`, async () => {
      const measure = await chatTokenMeasure(
        settings,
        {
          activeProvider: 'openai',
          canonicalModel: model,
          protocol: 'openai-chat',
          wireMethod: 'chat/completions/v1',
          projectionRevision: 1,
        },
        createRuntimeTokenizerFactory(),
      );
      const expected = await Promise.all([
        oldMistralUnitTokens([row], 'none'),
        oldMistralUnitTokens([row], 'all'),
      ]);
      const encode = spyOn(Tiktoken.prototype, 'encode');
      try {
        async function* rows(): AsyncGenerator<IContent> {
          for (let index = 0; index < size; index++) yield row;
        }
        const { summary } = await foldChatUnits(rows(), measure.settings, {
          count: measure.count,
          rowIds: async () => () => {
            const mapper = getToolIdStrategy('mistral').createStreamingMapper(
              createInMemoryToolIdStore(),
            );
            mapper.observe(row);
            return mapper;
          },
        });
        expect(summary.kind).toBe('chat');
        if (summary.kind !== 'chat') throw new Error('Missing Chat summary');
        expect(summary.tokens).toStrictEqual([
          expected[0] * size,
          expected[1] * size,
        ]);
        const characters = encode.mock.calls.reduce(
          (total, [text]) => total + text.length,
          0,
        );
        expect(characters).toBeGreaterThan(size * 100);
        expect(characters).toBeLessThan(size * 250);
      } finally {
        encode.mockRestore();
      }
    }, 180000);
  }
});
