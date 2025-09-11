/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenAIProvider } from './packages/core/dist/providers/openai/OpenAIProvider.js';
import { AnthropicProvider } from './packages/core/dist/providers/anthropic/AnthropicProvider.js';
import { GeminiProvider } from './packages/core/dist/providers/gemini/GeminiProvider.js';

// Test with different base URL configurations
const testProviders = () => {
  console.log('Testing OpenAI Provider...');
  const openaiProvider = new OpenAIProvider(
    'test-key',
    'https://custom.openai.com',
    {
      baseUrl: 'https://config.openai.com',
    },
  );
  console.log(
    'OpenAI - baseProviderConfig.baseURL:',
    openaiProvider.baseProviderConfig?.baseURL,
  );
  console.log(
    'OpenAI - providerConfig.baseUrl:',
    openaiProvider.providerConfig?.baseUrl,
  );

  console.log('\nTesting Anthropic Provider...');
  const anthropicProvider = new AnthropicProvider(
    'test-key',
    'https://custom.anthropic.com',
    {
      baseUrl: 'https://config.anthropic.com',
    },
  );
  console.log(
    'Anthropic - baseProviderConfig.baseURL:',
    anthropicProvider.baseProviderConfig?.baseURL,
  );
  console.log(
    'Anthropic - providerConfig.baseUrl:',
    anthropicProvider.providerConfig?.baseUrl,
  );

  console.log('\nTesting Gemini Provider...');
  const geminiProvider = new GeminiProvider(
    'test-key',
    'https://custom.gemini.com',
  );
  console.log(
    'Gemini - baseProviderConfig.baseURL:',
    geminiProvider.baseProviderConfig?.baseURL,
  );

  console.log('\nAll providers tested successfully!');
};

testProviders();
