/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  transformModel,
  transformProvider,
  transformApiResponse,
} from '../../src/models/transformer.js';
import {
  minimalModel,
  fullModel,
  visionModel,
  reasoningModel,
  deprecatedModel,
  claudeModel,
  geminiModel,
  deepseekModel,
  openaiProvider,
  anthropicProvider,
  googleProvider,
  deepseekProvider,
  mockApiResponse,
  emptyApiResponse,
} from './__fixtures__/mock-data.js';

describe('transformModel', () => {
  describe('ID generation', () => {
    it('creates correct full ID format provider/model', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.id).toBe('openai/gpt-4-turbo');
    });

    it('preserves short modelId separately', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.modelId).toBe('gpt-4-turbo');
    });
  });

  describe('capability mapping from modalities', () => {
    it('maps image in input to vision: true', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4o',
        visionModel,
      );
      expect(result.capabilities.vision).toBe(true);
    });

    it('maps audio in input to audio: true', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4o',
        visionModel,
      );
      expect(result.capabilities.audio).toBe(true);
    });

    it('maps pdf in input to pdf: true', () => {
      const result = transformModel(
        'anthropic',
        anthropicProvider,
        'claude-3-5-sonnet',
        claudeModel,
      );
      expect(result.capabilities.pdf).toBe(true);
    });

    it('sets vision/audio/pdf to false when not in modalities', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'o1-preview',
        reasoningModel,
      );
      expect(result.capabilities.vision).toBe(false);
      expect(result.capabilities.audio).toBe(false);
      expect(result.capabilities.pdf).toBe(false);
    });

    it('handles undefined modalities', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.capabilities.vision).toBe(false);
      expect(result.capabilities.audio).toBe(false);
      expect(result.capabilities.pdf).toBe(false);
    });
  });

  describe('defaults for missing booleans', () => {
    it('defaults tool_call undefined to toolCalling: false', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.capabilities.toolCalling).toBe(false);
    });

    it('defaults reasoning undefined to reasoning: false', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.capabilities.reasoning).toBe(false);
    });

    it('defaults temperature undefined to temperature: false', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.capabilities.temperature).toBe(false);
    });

    it('defaults attachment undefined to attachment: false', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.capabilities.attachment).toBe(false);
    });

    it('preserves true values when present', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.capabilities.toolCalling).toBe(true);
      expect(result.capabilities.temperature).toBe(true);
      expect(result.capabilities.attachment).toBe(true);
    });
  });

  describe('provider tool format mapping', () => {
    it('maps anthropic provider to anthropic format', () => {
      const result = transformModel(
        'anthropic',
        anthropicProvider,
        'claude-3-5-sonnet',
        claudeModel,
      );
      expect(result.supportedToolFormats).toEqual(['anthropic']);
    });

    it('maps openai provider to openai format', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.supportedToolFormats).toEqual(['openai']);
    });

    it('maps google provider to google and gemini formats', () => {
      const result = transformModel(
        'google',
        googleProvider,
        'gemini-2.0-flash',
        geminiModel,
      );
      expect(result.supportedToolFormats).toEqual(['google', 'gemini']);
    });

    it('maps google-vertex provider to google and gemini formats', () => {
      const vertexProvider = { ...googleProvider, id: 'google-vertex' };
      const result = transformModel(
        'google-vertex',
        vertexProvider,
        'gemini-2.0-flash',
        geminiModel,
      );
      expect(result.supportedToolFormats).toEqual(['google', 'gemini']);
    });

    it('defaults unknown provider to openai format', () => {
      const unknownProvider = {
        ...openaiProvider,
        id: 'unknown-provider',
        name: 'Unknown',
      };
      const result = transformModel(
        'unknown-provider',
        unknownProvider,
        'model',
        minimalModel,
      );
      expect(result.supportedToolFormats).toEqual(['openai']);
    });

    it('maps deepseek to openai format', () => {
      const result = transformModel(
        'deepseek',
        deepseekProvider,
        'deepseek-chat',
        deepseekModel,
      );
      expect(result.supportedToolFormats).toEqual(['openai']);
    });
  });

  describe('pricing transformation', () => {
    it('transforms cost object to pricing', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.pricing).toBeDefined();
      expect(result.pricing?.input).toBe(10);
      expect(result.pricing?.output).toBe(30);
      expect(result.pricing?.cacheRead).toBe(2.5);
      expect(result.pricing?.cacheWrite).toBe(5);
    });

    it('sets pricing undefined when no cost', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      expect(result.pricing).toBeUndefined();
    });
  });

  describe('status mapping', () => {
    it('maps undefined status to stable', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.metadata.status).toBe('stable');
    });

    it('maps alpha status to alpha', () => {
      const alphaModel = { ...minimalModel, status: 'alpha' as const };
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        alphaModel,
      );
      expect(result.metadata.status).toBe('alpha');
    });

    it('maps beta status to beta', () => {
      const betaModel = { ...minimalModel, status: 'beta' as const };
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        betaModel,
      );
      expect(result.metadata.status).toBe('beta');
    });

    it('maps deprecated status to deprecated', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-3.5-turbo-0301',
        deprecatedModel,
      );
      expect(result.metadata.status).toBe('deprecated');
    });
  });

  describe('limits transformation', () => {
    it('sets contextWindow from limit.context', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.contextWindow).toBe(128000);
      expect(result.limits.contextWindow).toBe(128000);
    });

    it('sets maxOutputTokens from limit.output', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.maxOutputTokens).toBe(4096);
      expect(result.limits.maxOutput).toBe(4096);
    });
  });

  describe('metadata transformation', () => {
    it('maps knowledge to knowledgeCutoff', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.metadata.knowledgeCutoff).toBe('2024-04');
    });

    it('maps release_date to releaseDate', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.metadata.releaseDate).toBe('2024-04-09');
    });

    it('maps last_updated to lastUpdated', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.metadata.lastUpdated).toBe('2024-06-01');
    });

    it('maps open_weights to openWeights', () => {
      const result = transformModel(
        'deepseek',
        deepseekProvider,
        'deepseek-chat',
        deepseekModel,
      );
      expect(result.metadata.openWeights).toBe(true);
    });
  });

  describe('provider config', () => {
    it('includes envVars from provider', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.envVars).toEqual(['OPENAI_API_KEY']);
    });

    it('includes apiEndpoint from provider', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.apiEndpoint).toBe('https://api.openai.com/v1');
    });

    it('includes npmPackage from provider', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.npmPackage).toBe('@ai-sdk/openai');
    });

    it('includes docUrl from provider', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'gpt-4-turbo',
        fullModel,
      );
      expect(result.docUrl).toBe('https://platform.openai.com/docs');
    });
  });

  describe('default profile generation', () => {
    it('includes defaultProfile for reasoning model', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'o1-preview',
        reasoningModel,
      );
      expect(result.defaultProfile).toBeDefined();
      expect(result.defaultProfile?.thinkingEnabled).toBe(true);
    });

    it('may return undefined defaultProfile for minimal model', () => {
      const result = transformModel(
        'openai',
        openaiProvider,
        'test',
        minimalModel,
      );
      // minimalModel has no capabilities, so profile may be undefined
      // This depends on generateDefaultProfile implementation
      expect(result.defaultProfile).toBeUndefined();
    });
  });
});

describe('transformProvider', () => {
  it('creates provider with correct ID', () => {
    const result = transformProvider('openai', openaiProvider);
    expect(result.id).toBe('openai');
  });

  it('includes provider name', () => {
    const result = transformProvider('openai', openaiProvider);
    expect(result.name).toBe('OpenAI');
  });

  it('counts models correctly', () => {
    const result = transformProvider('openai', openaiProvider);
    expect(result.modelCount).toBe(4); // fullModel, visionModel, reasoningModel, deprecatedModel
  });

  it('includes all provider metadata', () => {
    const result = transformProvider('openai', openaiProvider);
    expect(result.envVars).toEqual(['OPENAI_API_KEY']);
    expect(result.apiEndpoint).toBe('https://api.openai.com/v1');
    expect(result.npmPackage).toBe('@ai-sdk/openai');
    expect(result.docUrl).toBe('https://platform.openai.com/docs');
  });

  it('handles provider with no optional fields', () => {
    const minimalProvider = {
      id: 'minimal',
      name: 'Minimal',
      env: ['KEY'],
      models: {},
    };
    const result = transformProvider('minimal', minimalProvider);
    expect(result.apiEndpoint).toBeUndefined();
    expect(result.npmPackage).toBeUndefined();
    expect(result.docUrl).toBeUndefined();
  });
});

describe('transformApiResponse', () => {
  it('transforms multiple providers', () => {
    const { providers } = transformApiResponse(mockApiResponse);
    expect(providers.size).toBe(4); // openai, anthropic, google, deepseek
  });

  it('creates model and provider maps', () => {
    const { models, providers } = transformApiResponse(mockApiResponse);
    expect(models).toBeInstanceOf(Map);
    expect(providers).toBeInstanceOf(Map);
  });

  it('model IDs are unique across providers', () => {
    const { models } = transformApiResponse(mockApiResponse);
    const ids = Array.from(models.keys());
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('models have correct full IDs', () => {
    const { models } = transformApiResponse(mockApiResponse);
    expect(models.has('openai/gpt-4-turbo')).toBe(true);
    expect(models.has('anthropic/claude-3-5-sonnet')).toBe(true);
    expect(models.has('google/gemini-2.0-flash')).toBe(true);
  });

  it('empty response returns empty maps', () => {
    const { models, providers } = transformApiResponse(emptyApiResponse);
    expect(models.size).toBe(0);
    expect(providers.size).toBe(0);
  });

  it('transforms all models from all providers', () => {
    const { models } = transformApiResponse(mockApiResponse);
    // Count expected models: openai(4) + anthropic(1) + google(1) + deepseek(1) = 7
    expect(models.size).toBe(7);
  });
});
