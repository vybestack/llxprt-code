/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Tests for Codex model listing functionality
 * @plan PLAN-20251213-ISSUE160.P04
 */

import { describe, it, expect } from 'vitest';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';

describe('OpenAIResponsesProvider - Codex Model Listing', () => {
  describe('getDefaultModel', () => {
    it('should return gpt-5.3-codex as default model when in Codex mode', () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://chatgpt.com/backend-api/codex',
      );
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('gpt-5.3-codex');
    });

    it('should return o3-mini as default model when in standard OpenAI mode', () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('o3-mini');
    });

    it('should return o3-mini as default when baseURL is undefined', () => {
      const provider = new OpenAIResponsesProvider('test-api-key');
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('o3-mini');
    });
  });

  describe('getModels', () => {
    it('should return hardcoded Codex models when in Codex mode', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://chatgpt.com/backend-api/codex',
      );
      const models = await provider.getModels();

      // Verify all expected Codex models are present (based on codex-rs list_models.rs + #1308 update)
      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain('gpt-5.3-codex');
      expect(modelIds).toContain('gpt-5.2-codex');
      expect(modelIds).toContain('gpt-5.1-codex-max');
      expect(modelIds).toContain('gpt-5.1-codex');
      expect(modelIds).toContain('gpt-5.1-codex-mini');
      expect(modelIds).toContain('gpt-5.2');
      expect(modelIds).toContain('gpt-5.1');

      // Verify gpt-5.3-codex is first (highest priority)
      expect(models[0].id).toBe('gpt-5.3-codex');

      // Verify all models have correct provider and tool format
      for (const model of models) {
        expect(model.provider).toBe('codex');
        expect(model.supportedToolFormats).toEqual(['openai']);
      }
    });

    it('should return standard OpenAI models when not in Codex mode', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const models = await provider.getModels();

      // Verify we get standard models, not Codex models
      const modelIds = models.map((m) => m.id);
      expect(modelIds).not.toContain('gpt-5.1-codex');
      expect(modelIds).not.toContain('gpt-5.1-codex-mini');

      // All models should have openai-responses as provider (not codex)
      for (const model of models) {
        expect(model.provider).toBe('openai-responses');
      }
    });

    it('should include exactly the hardcoded Codex models in correct order', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://chatgpt.com/backend-api/codex',
      );
      const models = await provider.getModels();

      // Expected models in priority order (with #1308 gpt-5.3-codex addition)
      const expectedModelIds = [
        'gpt-5.3-codex',
        'gpt-5.2-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex',
        'gpt-5.1-codex-mini',
        'gpt-5.2',
        'gpt-5.1',
      ];

      // Verify order and presence
      expect(models.length).toBe(expectedModelIds.length);
      for (let i = 0; i < expectedModelIds.length; i++) {
        expect(models[i].id).toBe(expectedModelIds[i]);
      }
    });

    it('should set correct model names for Codex models', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://chatgpt.com/backend-api/codex',
      );
      const models = await provider.getModels();

      // Find specific models and verify their names (names match IDs in codex-rs)
      const codexMax = models.find((m) => m.id === 'gpt-5.1-codex-max');
      expect(codexMax).toBeDefined();
      expect(codexMax?.name).toBe('gpt-5.1-codex-max');

      const gpt52 = models.find((m) => m.id === 'gpt-5.2');
      expect(gpt52).toBeDefined();
      expect(gpt52?.name).toBe('gpt-5.2');

      const gpt51 = models.find((m) => m.id === 'gpt-5.1');
      expect(gpt51).toBeDefined();
      expect(gpt51?.name).toBe('gpt-5.1');
    });
  });

  it('should use this.name for provider field so aliases work correctly', async () => {
    const provider = new OpenAIResponsesProvider(
      undefined,
      'https://api.openai.com/v1',
    );

    Object.defineProperty(provider, 'name', {
      value: 'my-alias',
      writable: false,
      enumerable: true,
      configurable: true,
    });

    const models = await provider.getModels();

    for (const model of models) {
      expect(model.provider).toBe('my-alias');
    }
  });
});
