/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'bun:test';
import {
  createContentGenerator,
  createContentGeneratorConfig,
  type ContentGenerator,
} from './contentGenerator.js';
import type { Config } from '../config/config.js';
import type { RuntimeProviderManager } from '../runtime/contracts/RuntimeProviderManager.js';
import type { RuntimeContentGeneratorFactory } from '../runtime/contracts/RuntimeContentGeneratorFactory.js';

const mockConfig = {
  getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
} as unknown as Config;

function createRuntimeProviderManager(): RuntimeProviderManager {
  return {
    getActiveProvider: vi.fn(),
    getActiveProviderName: vi.fn(),
    setActiveProvider: vi.fn(),
    setRuntimeContext: vi.fn(),
    getAvailableModels: vi.fn(async () => []),
    getProviderNames: () => [],
    listProviders: () => [],
    getProviderByName: vi.fn(),
    registerProvider: vi.fn(),
    prepareStatelessProviderInvocation: vi.fn(),
    getProviderMetrics: () => ({}),
    getSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
    getServerToolsProvider: () => null,
    setServerToolsProvider: vi.fn(),
    setConfig: vi.fn(),
    hasActiveProvider: () => true,
    accumulateSessionTokens: vi.fn(),
  };
}

describe('createContentGenerator', () => {
  it('rejects when no provider runtime is composed, even with an API key', async () => {
    await expect(
      createContentGenerator(
        {
          model: 'test-model',
          apiKey: 'test-api-key',
        },
        mockConfig,
      ),
    ).rejects.toThrow(
      'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
    );
  });

  it('rejects when no provider runtime is composed even with Vertex settings', async () => {
    await expect(
      createContentGenerator(
        {
          model: 'test-model',
          vertexai: true,
        },
        mockConfig,
      ),
    ).rejects.toThrow(
      'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
    );
  });

  it('rejects a composed provider manager without a content-generator factory', async () => {
    const providerManager = createRuntimeProviderManager();

    await expect(
      createContentGenerator(
        {
          model: 'test-model',
          providerManager,
        },
        mockConfig,
      ),
    ).rejects.toThrow(
      'Provider content generator factory is required when a provider manager is configured',
    );
  });

  it('creates a generator through an injected factory when a provider manager is composed', async () => {
    const providerManager = createRuntimeProviderManager();
    const created: ContentGenerator = {
      generateContent: vi.fn(async () => ({ candidates: [] })),
      generateContentStream: vi.fn(async function* () {
        yield { candidates: [] };
      }),
      countTokens: vi.fn(async () => ({ totalTokens: 0 })),
      embedContent: vi.fn(async () => ({ embeddings: [] })),
    };
    const factory: RuntimeContentGeneratorFactory<ContentGenerator> = {
      createContentGenerator: () => created,
    };
    const generator = await createContentGenerator(
      {
        model: 'test-model',
        providerManager,
        contentGeneratorFactory: factory,
      },
      mockConfig,
    );
    expect(generator).toBe(created);
  });
});

describe('createContentGeneratorConfig', () => {
  const originalEnv = process.env;
  const mockConfig = {
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    setModel: vi.fn(),
    getProxy: vi.fn(),
  } as unknown as Config;

  beforeEach(() => {
    // Restore process.env before each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterAll(() => {
    // Restore original process.env after all tests
    process.env = originalEnv;
  });

  it('should configure for Gemini using GEMINI_API_KEY when set', () => {
    process.env.GEMINI_API_KEY = 'env-gemini-key';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.apiKey).toBe('env-gemini-key');
    expect(config.vertexai).toBe(false);
  });

  it('should not configure for Gemini if GEMINI_API_KEY is empty', () => {
    process.env.GEMINI_API_KEY = '';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.apiKey).toBeUndefined();
    expect(config.vertexai).toBeUndefined();
  });

  it('should configure for Vertex AI using GOOGLE_API_KEY when set', () => {
    process.env.GOOGLE_API_KEY = 'env-google-key';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.apiKey).toBe('env-google-key');
    expect(config.vertexai).toBe(true);
  });

  it('should configure for Vertex AI using GCP project and location when set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-gcp-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'env-gcp-location';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.vertexai).toBe(true);
    expect(config.apiKey).toBeUndefined();
  });

  it('should fall back to GOOGLE_CLOUD_PROJECT_ID when GOOGLE_CLOUD_PROJECT is empty', () => {
    process.env.GOOGLE_CLOUD_PROJECT = '';
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'fallback-gcp-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'env-gcp-location';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.vertexai).toBe(true);
    expect(config.apiKey).toBeUndefined();
  });

  it('should not configure for Vertex AI if required env vars are empty', () => {
    process.env.GOOGLE_API_KEY = '';
    process.env.GOOGLE_CLOUD_PROJECT = '';
    process.env.GOOGLE_CLOUD_LOCATION = '';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.apiKey).toBeUndefined();
    expect(config.vertexai).toBeUndefined();
  });
});
