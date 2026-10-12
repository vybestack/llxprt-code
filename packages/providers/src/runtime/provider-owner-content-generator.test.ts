/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config, createContentGenerator } from '@vybestack/llxprt-code-core';
import { ProviderContentGenerator } from '../ProviderContentGenerator.js';

describe('owner-bound content generator factory', () => {
  it('constructs from an explicit factory without passing manager authority through Config', async () => {
    const config = new Config({
      sessionId: 'factory-owner',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'local-model',
    });
    const generator = await createContentGenerator(
      {
        model: 'local-model',
        contentGeneratorFactory: {
          createContentGenerator: () => new ProviderContentGenerator(),
        },
      },
      config,
    );
    const result = await generator.countTokens({
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'sixteen letters.' }],
        },
      ],
    });
    expect(result.totalTokens).toBe(4);
    await expect(generator.embedContent({ texts: [] })).rejects.toThrow(
      'Embeddings not supported',
    );
  });
});
