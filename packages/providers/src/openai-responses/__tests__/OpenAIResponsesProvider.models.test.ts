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
 * Tests for OpenAIResponsesProvider model listing.
 *
 * Fully deterministic: globalThis.fetch is mocked so no real network is hit.
 *
 * @issue #2272 — The base provider no longer carries a hardcoded Codex model
 * fallback. The Codex model list now lives solely in
 * composition/aliases/codex.config (staticModels), which the alias factory
 * monkeypatches onto the `/provider codex` alias. A raw OpenAIResponsesProvider
 * constructed directly against the Codex backend URL therefore does NOT return
 * the Codex list; it follows the standard dynamic /models flow (and the
 * RESPONSES_API_MODELS fallback when unauthenticated / fetch fails).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { RESPONSES_API_MODELS } from '../../openai/RESPONSES_API_MODELS.js';
import type { IModel } from '../../IModel.js';

const STANDARD_BASE_URL = 'https://api.openai.com/v1';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function mockOkResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockNonOkResponse(status: number): Response {
  return new Response(JSON.stringify({}), { status });
}

function buildExpectedResponsesModels(provider: string): IModel[] {
  return RESPONSES_API_MODELS.map((modelId) => ({
    id: modelId,
    name: modelId,
    provider,
    supportedToolFormats: ['openai'],
  }));
}

describe('OpenAIResponsesProvider - Model Listing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', '');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('getDefaultModel', () => {
    it('should return gpt-5.5 as default model when in Codex mode', () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        CODEX_BASE_URL,
      );
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('gpt-5.5');
    });

    it('should return o3-mini as default model when in standard OpenAI mode', () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        STANDARD_BASE_URL,
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

  describe('getModels - standard OpenAI dynamic flow', () => {
    it('should return dynamically fetched chat models on /models success', async () => {
      fetchSpy.mockResolvedValue(
        mockOkResponse({
          data: [
            { id: 'gpt-4o' },
            { id: 'o3-mini' },
            { id: 'text-embedding-3-small' },
            { id: 'whisper-1' },
          ],
        }),
      );

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        STANDARD_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${STANDARD_BASE_URL}/models`,
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer test-api-key' },
        }),
      );

      // Non-chat models (embedding, whisper) must be filtered out.
      expect(modelIds).toStrictEqual(['gpt-4o', 'o3-mini']);
      for (const model of models) {
        expect(model.provider).toBe('openai-responses');
        expect(model.supportedToolFormats).toStrictEqual(['openai']);
      }
    });

    it('should fall back to RESPONSES_API_MODELS on non-OK response', async () => {
      fetchSpy.mockResolvedValue(mockNonOkResponse(401));

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        STANDARD_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toStrictEqual([...RESPONSES_API_MODELS]);
      for (const model of models) {
        expect(model.provider).toBe('openai-responses');
        expect(model.supportedToolFormats).toStrictEqual(['openai']);
      }
    });

    it('should fall back to RESPONSES_API_MODELS when fetch throws', async () => {
      fetchSpy.mockRejectedValue(new Error('network down'));

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        STANDARD_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toStrictEqual([...RESPONSES_API_MODELS]);
      for (const model of models) {
        expect(model.provider).toBe('openai-responses');
      }
    });

    it('should fall back to RESPONSES_API_MODELS when dynamic list is empty', async () => {
      fetchSpy.mockResolvedValue(
        mockOkResponse({
          data: [{ id: 'text-embedding-3-small' }],
        }),
      );

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        STANDARD_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      // Fetch was called, returned OK, but all models were non-chat → fallback list used.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(modelIds).toStrictEqual([...RESPONSES_API_MODELS]);
    });

    it('should fall back to RESPONSES_API_MODELS when no API key is available', async () => {
      const provider = new OpenAIResponsesProvider(
        undefined,
        STANDARD_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toStrictEqual([...RESPONSES_API_MODELS]);
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const model of models) {
        expect(model.provider).toBe('openai-responses');
      }
    });
  });

  describe('getModels - no hardcoded Codex fallback (@issue:2272)', () => {
    const CODEX_ONLY_IDS = [
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5.3-codex-spark',
      'gpt-5.2-codex',
    ];

    it('should follow the standard dynamic /models flow for a raw Codex-URL provider', async () => {
      fetchSpy.mockResolvedValue(
        mockOkResponse({
          data: [{ id: 'gpt-4o' }, { id: 'o3-mini' }],
        }),
      );

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        CODEX_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      // It does fetch against the Codex backend like any standard provider.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${CODEX_BASE_URL}/models`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(models).toStrictEqual([
        {
          id: 'gpt-4o',
          name: 'gpt-4o',
          provider: 'openai-responses',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'o3-mini',
          name: 'o3-mini',
          provider: 'openai-responses',
          supportedToolFormats: ['openai'],
        },
      ]);

      // The base provider must not synthesize the Codex-only models. Those are
      // only available via the /provider codex alias (codex.config staticModels).
      for (const codexId of CODEX_ONLY_IDS) {
        expect(modelIds).not.toContain(codexId);
      }
      // A raw provider instance reports its own provider name, never "codex".
      for (const model of models) {
        expect(model.provider).not.toBe('codex');
      }
    });

    it('should fall back to RESPONSES_API_MODELS when fetch fails for a Codex-URL provider', async () => {
      fetchSpy.mockRejectedValue(new Error('cloudflare blocked'));

      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        CODEX_BASE_URL,
      );
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(models).toStrictEqual(
        buildExpectedResponsesModels('openai-responses'),
      );
      // Fallback is the standard Responses API list — no hardcoded Codex list.
      for (const codexId of CODEX_ONLY_IDS) {
        expect(modelIds).not.toContain(codexId);
      }
    });

    it('should fall back to RESPONSES_API_MODELS (no fetch) when unauthenticated Codex-URL provider', async () => {
      const provider = new OpenAIResponsesProvider(undefined, CODEX_BASE_URL);
      const models = await provider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(models).toStrictEqual(
        buildExpectedResponsesModels('openai-responses'),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const codexId of CODEX_ONLY_IDS) {
        expect(modelIds).not.toContain(codexId);
      }
    });
  });

  describe('getModels - alias name propagation', () => {
    it('should use this.name for provider field so aliases work correctly', async () => {
      const provider = new OpenAIResponsesProvider(
        undefined,
        STANDARD_BASE_URL,
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
});
