/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModelsDevModel,
  ModelsDevProvider,
  ModelsDevApiResponse,
} from '../../../src/models/schema.js';

/**
 * Minimal valid model with only required fields
 */
export const minimalModel: ModelsDevModel = {
  id: 'test-model',
  name: 'Test Model',
  limit: {
    context: 8000,
    output: 4000,
  },
  release_date: '2024-01-01',
  open_weights: false,
};

/**
 * Full model with all fields populated
 */
export const fullModel: ModelsDevModel = {
  id: 'gpt-4-turbo',
  name: 'GPT-4 Turbo',
  family: 'gpt-4',
  attachment: true,
  reasoning: false,
  tool_call: true,
  temperature: true,
  structured_output: true,
  cost: {
    input: 10,
    output: 30,
    cache_read: 2.5,
    cache_write: 5,
  },
  limit: {
    context: 128000,
    output: 4096,
  },
  modalities: {
    input: ['text', 'image'],
    output: ['text'],
  },
  knowledge: '2024-04',
  release_date: '2024-04-09',
  last_updated: '2024-06-01',
  open_weights: false,
  status: undefined,
};

/**
 * Reasoning model (like o1)
 */
export const reasoningModel: ModelsDevModel = {
  id: 'o1-preview',
  name: 'O1 Preview',
  family: 'o1',
  attachment: false,
  reasoning: true,
  tool_call: false,
  temperature: true,
  limit: {
    context: 128000,
    output: 32768,
  },
  release_date: '2024-09-12',
  open_weights: false,
};

/**
 * Deprecated model
 */
export const deprecatedModel: ModelsDevModel = {
  id: 'gpt-3.5-turbo-0301',
  name: 'GPT-3.5 Turbo (0301)',
  family: 'gpt-3.5',
  attachment: false,
  reasoning: false,
  tool_call: true,
  temperature: true,
  limit: {
    context: 4096,
    output: 4096,
  },
  release_date: '2023-03-01',
  open_weights: false,
  status: 'deprecated',
};

/**
 * Model with vision capability
 */
export const visionModel: ModelsDevModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  family: 'gpt-4o',
  attachment: true,
  reasoning: false,
  tool_call: true,
  temperature: true,
  structured_output: true,
  cost: {
    input: 2.5,
    output: 10,
  },
  limit: {
    context: 128000,
    output: 16384,
  },
  modalities: {
    input: ['text', 'image', 'audio'],
    output: ['text', 'audio'],
  },
  release_date: '2024-05-13',
  open_weights: false,
};

/**
 * Claude model for family-specific profile testing
 */
export const claudeModel: ModelsDevModel = {
  id: 'claude-3-5-sonnet',
  name: 'Claude 3.5 Sonnet',
  family: 'claude-3.5',
  attachment: true,
  reasoning: false,
  tool_call: true,
  temperature: true,
  cost: {
    input: 3,
    output: 15,
  },
  limit: {
    context: 200000,
    output: 8192,
  },
  modalities: {
    input: ['text', 'image', 'pdf'],
    output: ['text'],
  },
  release_date: '2024-06-20',
  open_weights: false,
};

/**
 * Gemini model for family-specific profile testing
 */
export const geminiModel: ModelsDevModel = {
  id: 'gemini-2.0-flash',
  name: 'Gemini 2.0 Flash',
  family: 'gemini-2.0',
  attachment: true,
  reasoning: false,
  tool_call: true,
  temperature: true,
  structured_output: true,
  cost: {
    input: 0.1,
    output: 0.4,
  },
  limit: {
    context: 1000000,
    output: 8192,
  },
  modalities: {
    input: ['text', 'image', 'audio', 'video'],
    output: ['text'],
  },
  release_date: '2024-12-11',
  open_weights: false,
};

/**
 * DeepSeek model
 */
export const deepseekModel: ModelsDevModel = {
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  family: 'deepseek-v3',
  attachment: false,
  reasoning: false,
  tool_call: true,
  temperature: true,
  cost: {
    input: 0.14,
    output: 0.28,
  },
  limit: {
    context: 64000,
    output: 8000,
  },
  release_date: '2024-12-26',
  open_weights: true,
};

/**
 * Mock OpenAI provider
 */
export const openaiProvider: ModelsDevProvider = {
  id: 'openai',
  name: 'OpenAI',
  env: ['OPENAI_API_KEY'],
  api: 'https://api.openai.com/v1',
  npm: '@ai-sdk/openai',
  doc: 'https://platform.openai.com/docs',
  models: {
    'gpt-4-turbo': fullModel,
    'gpt-4o': visionModel,
    'o1-preview': reasoningModel,
    'gpt-3.5-turbo-0301': deprecatedModel,
  },
};

/**
 * Mock Anthropic provider
 */
export const anthropicProvider: ModelsDevProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  env: ['ANTHROPIC_API_KEY'],
  api: 'https://api.anthropic.com',
  npm: '@ai-sdk/anthropic',
  doc: 'https://docs.anthropic.com',
  models: {
    'claude-3-5-sonnet': claudeModel,
  },
};

/**
 * Mock Google provider
 */
export const googleProvider: ModelsDevProvider = {
  id: 'google',
  name: 'Google AI',
  env: ['GOOGLE_API_KEY'],
  api: 'https://generativelanguage.googleapis.com/v1beta',
  npm: '@ai-sdk/google',
  doc: 'https://ai.google.dev/docs',
  models: {
    'gemini-2.0-flash': geminiModel,
  },
};

/**
 * Mock DeepSeek provider
 */
export const deepseekProvider: ModelsDevProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  env: ['DEEPSEEK_API_KEY'],
  api: 'https://api.deepseek.com',
  npm: '@ai-sdk/openai-compatible',
  doc: 'https://platform.deepseek.com/docs',
  models: {
    'deepseek-chat': deepseekModel,
  },
};

/**
 * Complete mock API response
 */
export const mockApiResponse: ModelsDevApiResponse = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  deepseek: deepseekProvider,
};

/**
 * Empty API response
 */
export const emptyApiResponse: ModelsDevApiResponse = {};

/**
 * Provider with no models
 */
export const emptyProvider: ModelsDevProvider = {
  id: 'empty',
  name: 'Empty Provider',
  env: ['EMPTY_API_KEY'],
  models: {},
};

/**
 * Invalid model data (for negative testing)
 */
export const invalidModelData = {
  // Missing required 'id'
  name: 'Invalid Model',
  limit: { context: 8000, output: 4000 },
  release_date: '2024-01-01',
  open_weights: false,
};

/**
 * Invalid provider data (for negative testing)
 */
export const invalidProviderData = {
  // Missing required 'env'
  id: 'invalid',
  name: 'Invalid Provider',
  models: {},
};
