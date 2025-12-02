/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider.js';

describe('OpenAIVercelProvider - Model Listing', () => {
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

    // Ensure all required IDs are present
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
