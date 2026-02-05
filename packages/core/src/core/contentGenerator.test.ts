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
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { GoogleGenAI } from '@google/genai';
import { Config } from '../config/config.js';

vi.mock('../code_assist/codeAssist.js');
vi.mock('@google/genai');

const mockConfig = {
  getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
} as unknown as Config;

describe('createContentGenerator', () => {
  it('should create a CodeAssistContentGenerator', async () => {
    const mockGenerator = {} as unknown;
    vi.mocked(createCodeAssistContentGenerator).mockResolvedValue(
      mockGenerator as never,
    );
    const generator = await createContentGenerator(
      {
        model: 'test-model',
        vertexai: true,
      },
      mockConfig,
    );
    expect(createCodeAssistContentGenerator).toHaveBeenCalled();
    expect(generator).toBe(mockGenerator);
  });

  it('should create a GoogleGenAIWrapper content generator', async () => {
    const mockGenerator = {
      models: {},
    } as unknown;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator(
      {
        model: 'test-model',
        apiKey: 'test-api-key',
      },
      mockConfig,
    );
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: {
        headers: {},
      },
    });
    // Now we expect a GoogleGenAIWrapper instance, not the raw models
    expect(generator).toHaveProperty('generateContent');
    expect(generator).toHaveProperty('generateContentStream');
    expect(generator).toHaveProperty('countTokens');
    expect(generator).toHaveProperty('embedContent');
  });

  it('should fall back to CodeAssist when no API key is provided', async () => {
    const mockGenerator = {} as unknown;
    vi.mocked(createCodeAssistContentGenerator).mockResolvedValue(
      mockGenerator as never,
    );

    const generator = await createContentGenerator(
      {
        model: 'test-model',
      },
      mockConfig,
    );

    expect(createCodeAssistContentGenerator).toHaveBeenCalled();
    expect(generator).toBe(mockGenerator);
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

  it('should not configure for Vertex AI if required env vars are empty', () => {
    process.env.GOOGLE_API_KEY = '';
    process.env.GOOGLE_CLOUD_PROJECT = '';
    process.env.GOOGLE_CLOUD_LOCATION = '';
    const config = createContentGeneratorConfig(mockConfig);
    expect(config.apiKey).toBeUndefined();
    expect(config.vertexai).toBeUndefined();
  });
});
