/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ProviderContentGenerator } from './ProviderContentGenerator.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

const dummyConfig: ContentGeneratorConfig = { model: 'test' };

describe('ProviderContentGenerator', () => {
  const providerManager = {
    getActiveProvider: () => ({ name: 'test-provider' }),
  };

  it('countTokens estimates from text blocks (~4 chars/token)', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    const result = await gen.countTokens({
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello world' }],
        },
      ],
    });
    // 'hello world ' = 12 chars → ceil(12/4) = 3
    expect(result.totalTokens).toBe(3);
  });

  it('countTokens concatenates text from multiple blocks', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    const result = await gen.countTokens({
      contents: [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'aaaa' },
            { type: 'text', text: 'bbbb' },
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'cccc' }],
        },
      ],
    });
    // 'aaaa bbbb cccc ' = 15 chars → ceil(15/4) = 4
    expect(result.totalTokens).toBe(4);
  });

  it('countTokens ignores non-text blocks', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    const result = await gen.countTokens({
      contents: [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'hello' },
            { type: 'tool_call', id: '1', name: 'x', parameters: {} },
            { type: 'thinking', thought: 'hmmm' },
          ],
        },
      ],
    });
    // only 'hello' counted → 'hello ' = 6 chars → ceil(6/4) = 2
    expect(result.totalTokens).toBe(2);
  });

  it('countTokens returns 0 for empty contents', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    const result = await gen.countTokens({
      contents: [],
    });
    expect(result.totalTokens).toBe(0);
  });

  it('generateContent throws unsupported error', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    await expect(gen.generateContent({ contents: [] }, 'id')).rejects.toThrow(
      'IContent pipeline',
    );
  });

  it('generateContentStream throws unsupported error', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    await expect(
      gen.generateContentStream({ contents: [] }, 'id'),
    ).rejects.toThrow('IContent pipeline');
  });

  it('embedContent throws unsupported error', async () => {
    const gen = new ProviderContentGenerator(providerManager, dummyConfig);
    await expect(gen.embedContent({ texts: ['hi'] })).rejects.toThrow(
      'Embeddings not supported',
    );
  });
});
