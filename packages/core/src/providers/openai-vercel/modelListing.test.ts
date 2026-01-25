/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';

describe('OpenAIVercelProvider - Model Listing', () => {
  const apiModels = [
    { id: 'gpt-3.5-turbo', context_window: 16385, name: 'GPT-3.5 Turbo' },
    { id: 'gpt-4', context_window: 8192, name: 'GPT-4' },
    { id: 'gpt-4-turbo', context_window: 128000, name: 'GPT-4 Turbo' },
    { id: 'gpt-4o', context_window: 128000, name: 'GPT-4o' },
    { id: 'gpt-4o-mini', context_window: 128000, name: 'GPT-4o Mini' },
    { id: 'o1-mini', context_window: 128000, name: 'o1-mini' },
    { id: 'o1-preview', context_window: 128000, name: 'o1-preview' },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: apiModels }), { status: 200 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the expected static model list with provider metadata', async () => {
    const provider = new OpenAIVercelProvider('test-api-key');

    const models = await provider.getModels();
    const modelIds = models.map((m) => m.id);

    const expectedModels: Array<{ id: string; contextWindow: number }> = [
      { id: 'gpt-3.5-turbo', contextWindow: 16385 },
      { id: 'gpt-4', contextWindow: 8192 },
      { id: 'gpt-4-turbo', contextWindow: 128000 },
      { id: 'gpt-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', contextWindow: 128000 },
      { id: 'o1-mini', contextWindow: 128000 },
      { id: 'o1-preview', contextWindow: 128000 },
    ];

    for (const expected of expectedModels) {
      const found = models.find((model) => model.id === expected.id);
      expect(found).toBeDefined();
      expect(found?.provider).toBe('openaivercel');
      expect(found?.contextWindow).toBe(expected.contextWindow);
      expect(found?.supportedToolFormats).toEqual(['openai']);
    }

    expect(modelIds).toEqual(
      expect.arrayContaining(expectedModels.map((m) => m.id)),
    );
  });

  it('sorts models alphabetically by name', async () => {
    const provider = new OpenAIVercelProvider('test-api-key');
    const models = await provider.getModels();

    const names = models.map((m) => m.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));

    expect(names).toEqual(sortedNames);
  });
});
