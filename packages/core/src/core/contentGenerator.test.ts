/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import {
  createContentGenerator,
  createContentGeneratorConfig,
} from './contentGenerator.js';
import type { Config } from '../config/config.js';

const mockGoogleGenAIWrapperConstructor = vi.hoisted(() => vi.fn());
const mockGoogleGenAIWrapperInstance = vi.hoisted(() => ({
  generateContent: async (): Promise<unknown> => ({}),
  generateContentStream: async (): Promise<AsyncGenerator<unknown>> => {
    async function* emptyStream(): AsyncGenerator<unknown> {
      yield* [];
    }
    return emptyStream();
  },
  countTokens: async (): Promise<unknown> => ({}),
  embedContent: async (): Promise<unknown> => ({}),
}));

vi.mock('../code_assist/googleGenAIWrapper.js', () => ({
  GoogleGenAIWrapper: vi
    .fn()
    .mockImplementation((config: unknown, requestOptions: unknown) => {
      mockGoogleGenAIWrapperConstructor(config, requestOptions);
      return mockGoogleGenAIWrapperInstance;
    }),
}));

vi.mock('../utils/installationManager.js', () => ({
  InstallationManager: vi.fn().mockImplementation(() => ({
    getInstallationId: () => 'test-installation-id',
  })),
}));

const mockConfig = {
  getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
} as unknown as Config;

describe('createContentGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a GoogleGenAIWrapper content generator', async () => {
    const generator = await createContentGenerator(
      {
        model: 'test-model',
        apiKey: 'test-api-key',
      },
      mockConfig,
    );
    expect(generator).toBe(mockGoogleGenAIWrapperInstance);
    expect(mockGoogleGenAIWrapperConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', apiKey: 'test-api-key' }),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('should add usage-statistics header when enabled', async () => {
    const statsConfig = {
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
    } as unknown as Config;

    await createContentGenerator(
      {
        model: 'test-model',
        apiKey: 'test-api-key',
      },
      statsConfig,
    );

    expect(mockGoogleGenAIWrapperConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', apiKey: 'test-api-key' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-gemini-api-privileged-user-id': 'test-installation-id',
        }),
      }),
    );
  });

  it('should create a GoogleGenAIWrapper content generator with Vertex AI', async () => {
    const generator = await createContentGenerator(
      {
        model: 'test-model',
        vertexai: true,
      },
      mockConfig,
    );
    expect(generator).toBe(mockGoogleGenAIWrapperInstance);
    expect(mockGoogleGenAIWrapperConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', vertexai: true }),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('should throw an error when no authentication is provided', async () => {
    await expect(
      createContentGenerator(
        {
          model: 'test-model',
        },
        mockConfig,
      ),
    ).rejects.toThrow('No Gemini authentication configured');
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
    // Reset modules to re-evaluate imports and environment variables
    vi.resetModules();
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
