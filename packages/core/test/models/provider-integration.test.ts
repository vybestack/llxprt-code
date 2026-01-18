/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import {
  llxprtModelToIModel,
  hasModelInRegistry,
  getExtendedModelInfo,
  getRecommendedModel,
} from '../../src/models/provider-integration.js';
import { ModelRegistry, getModelRegistry } from '../../src/models/registry.js';
import type { LlxprtModel } from '../../src/models/schema.js';
import {
  mockApiResponse,
  fullModel,
  openaiProvider,
} from './__fixtures__/mock-data.js';
import { transformModel } from '../../src/models/transformer.js';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Reset singleton between tests
vi.mock('../../src/models/registry.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/models/registry.js')
  >('../../src/models/registry.js');
  let instance: ModelRegistry | null = null;

  return {
    ...actual,
    getModelRegistry: () => {
      if (!instance) {
        instance = new actual.ModelRegistry();
      }
      return instance;
    },
    // Expose reset for tests
    __resetRegistry: () => {
      if (instance) {
        instance.dispose();
      }
      instance = null;
    },
  };
});

// Get reset function
const resetRegistry = async () => {
  const mod = await import('../../src/models/registry.js');
  // @ts-expect-error - test helper
  mod.__resetRegistry?.();
};

describe('llxprtModelToIModel', () => {
  const sampleLlxprtModel: LlxprtModel = transformModel(
    'openai',
    openaiProvider,
    'gpt-4-turbo',
    fullModel,
  );

  it('converts to IModel with correct fields', () => {
    const result = llxprtModelToIModel(sampleLlxprtModel);
    expect(result.name).toBe('GPT-4 Turbo');
    expect(result.provider).toBe('OpenAI');
    expect(result.contextWindow).toBe(128000);
    expect(result.maxOutputTokens).toBe(4096);
  });

  it('uses modelId (short) not full ID', () => {
    const result = llxprtModelToIModel(sampleLlxprtModel);
    expect(result.id).toBe('gpt-4-turbo');
    expect(result.id).not.toBe('openai/gpt-4-turbo');
  });

  it('preserves supportedToolFormats array', () => {
    const result = llxprtModelToIModel(sampleLlxprtModel);
    expect(result.supportedToolFormats).toEqual(['openai']);
  });
});

describe('hasModelInRegistry', () => {
  beforeEach(async () => {
    await resetRegistry();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await resetRegistry();
  });

  it('returns false when registry not initialized', () => {
    const result = hasModelInRegistry('openai', 'gpt-4');
    expect(result).toBe(false);
  });

  describe('with initialized registry', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      const registry = getModelRegistry();
      await registry.initialize();
    });

    it('returns true for existing model', () => {
      const result = hasModelInRegistry('openai', 'gpt-4-turbo');
      expect(result).toBe(true);
    });

    it('returns false for non-existent model', () => {
      const result = hasModelInRegistry('openai', 'nonexistent-model');
      expect(result).toBe(false);
    });

    it('checks across mapped provider IDs', () => {
      // 'gemini' maps to ['google', 'google-vertex']
      const result = hasModelInRegistry('gemini', 'gemini-2.0-flash');
      expect(result).toBe(true);
    });
  });
});

describe('getExtendedModelInfo', () => {
  beforeEach(async () => {
    await resetRegistry();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await resetRegistry();
  });

  it('returns undefined when registry not initialized', () => {
    const result = getExtendedModelInfo('openai', 'gpt-4');
    expect(result).toBeUndefined();
  });

  describe('with initialized registry', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      const registry = getModelRegistry();
      await registry.initialize();
    });

    it('returns LlxprtModel for existing model', () => {
      const result = getExtendedModelInfo('openai', 'gpt-4-turbo');
      expect(result).toBeDefined();
      expect(result?.id).toBe('openai/gpt-4-turbo');
      expect(result?.pricing).toBeDefined();
      expect(result?.capabilities).toBeDefined();
    });

    it('returns undefined for non-existent model', () => {
      const result = getExtendedModelInfo('openai', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('searches across mapped provider IDs', () => {
      const result = getExtendedModelInfo('gemini', 'gemini-2.0-flash');
      expect(result).toBeDefined();
      expect(result?.name).toBe('Gemini 2.0 Flash');
    });
  });
});

describe('getRecommendedModel', () => {
  beforeEach(async () => {
    await resetRegistry();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await resetRegistry();
  });

  it('returns undefined when registry not initialized', () => {
    const result = getRecommendedModel('openai');
    expect(result).toBeUndefined();
  });

  describe('with initialized registry', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      const registry = getModelRegistry();
      await registry.initialize();
    });

    it('returns a model for valid provider', () => {
      const result = getRecommendedModel('openai');
      expect(result).toBeDefined();
      expect(result?.providerId).toBe('openai');
    });

    it('filters by requireToolCalling', () => {
      const result = getRecommendedModel('openai', {
        requireToolCalling: true,
      });
      expect(result).toBeDefined();
      expect(result?.capabilities.toolCalling).toBe(true);
    });

    it('filters by requireReasoning', () => {
      const result = getRecommendedModel('openai', { requireReasoning: true });
      expect(result).toBeDefined();
      expect(result?.capabilities.reasoning).toBe(true);
    });

    it('sorts by price when preferCheaper: true', () => {
      const result = getRecommendedModel('openai', { preferCheaper: true });
      expect(result).toBeDefined();
      // Should return model with lowest input price
    });

    it('sorts by context window by default', () => {
      const result = getRecommendedModel('openai');
      expect(result).toBeDefined();
      // Should return model with highest context window
    });

    it('returns undefined when no candidates match', () => {
      const result = getRecommendedModel('openai', {
        requireToolCalling: true,
        requireReasoning: true,
      });
      // o1-preview has reasoning but no tool_call
      // gpt-4-turbo has tool_call but no reasoning
      expect(result).toBeUndefined();
    });

    it('excludes deprecated models', () => {
      const result = getRecommendedModel('openai');
      expect(result?.metadata?.status).not.toBe('deprecated');
    });

    it('returns undefined for unknown provider', () => {
      const result = getRecommendedModel('nonexistent');
      expect(result).toBeUndefined();
    });
  });
});
