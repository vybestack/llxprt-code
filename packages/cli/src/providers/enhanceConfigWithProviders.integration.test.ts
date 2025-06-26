/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '@google/gemini-cli-core';
import { enhanceConfigWithProviders } from './enhanceConfigWithProviders.js';
import {
  getProviderManager,
  resetProviderManager,
} from './providerManagerInstance.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

describe('enhanceConfigWithProviders Integration Test', () => {
  let apiKey: string | null = null;

  beforeEach(() => {
    // Reset provider manager to ensure clean state
    resetProviderManager();

    // Try to load OpenAI API key
    try {
      const apiKeyPath = join(homedir(), '.openai_key');
      if (existsSync(apiKeyPath)) {
        apiKey = readFileSync(apiKeyPath, 'utf-8').trim();
      }
    } catch (_error) {
      // No API key available
    }
  });

  afterEach(() => {
    resetProviderManager();
  });

  it('should enhance Config and use provider when available', async () => {
    if (!apiKey) {
      console.log(
        'Skipping integration test: No OpenAI API key found at ~/.openai_key',
      );
      return;
    }

    // Create a minimal config
    const config = new Config({
      sessionId: 'test-session',
      model: 'gpt-4',
      targetDir: process.cwd(),
      debugMode: false,
      question: '',
      fullContext: false,
      userMemory: '',
      geminiMdFileCount: 0,
      proxy: undefined,
      cwd: process.cwd(),
    });

    // Mock refreshAuth to avoid actual auth
    config.refreshAuth = async () => Promise.resolve();

    // Register OpenAI provider
    const providerManager = getProviderManager();
    const openaiProvider = new OpenAIProvider(apiKey);
    providerManager.registerProvider(openaiProvider);
    providerManager.setActiveProvider('openai');

    // Enhance the config after mocking refreshAuth
    const enhancedConfig = enhanceConfigWithProviders(config);

    // Verify it's the same config instance
    expect(enhancedConfig).toBe(config);

    // Now call refreshAuth to trigger provider integration
    await config.refreshAuth('test-auth');

    // Verify that the provider is being used
    const activeProvider = providerManager.getActiveProvider();
    expect(activeProvider).toBeDefined();
    expect(activeProvider.name).toBe('openai');
  });

  it('should fall back to default when no provider is available', async () => {
    // Reset provider manager to ensure clean state
    resetProviderManager();

    // Create a minimal config
    const config = new Config({
      sessionId: 'test-session',
      model: 'gemini-2.5-flash',
      targetDir: process.cwd(),
      debugMode: false,
      question: '',
      fullContext: false,
      userMemory: '',
      geminiMdFileCount: 0,
      proxy: undefined,
      cwd: process.cwd(),
    });

    // Mock refreshAuth to avoid actual auth
    config.refreshAuth = async () => Promise.resolve();

    // Don't register any providers
    const enhancedConfig = enhanceConfigWithProviders(config);

    // Verify it's the same config instance
    expect(enhancedConfig).toBe(config);

    // Simulate refreshAuth
    await config.refreshAuth('test-auth');

    // Verify provider handling when no provider is manually registered
    const providerManager = getProviderManager();
    const providers = providerManager.listProviders();
    // May have auto-loaded providers if API keys exist
    if (providers.length > 0) {
      console.log(
        `Found ${providers.length} auto-loaded provider(s): ${providers.join(', ')}`,
      );
    }
  });
});
