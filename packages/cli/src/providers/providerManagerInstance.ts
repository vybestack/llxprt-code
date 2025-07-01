/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager } from './ProviderManager.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();

    // Only auto-initialize providers when not in test environment
    if (process.env.NODE_ENV !== 'test') {
      // Register GeminiProvider
      const geminiProvider = new GeminiProvider();
      providerManagerInstance.registerProvider(geminiProvider);

      // Initialize with OpenAI provider if API key is available
      try {
        const apiKeyPath = join(homedir(), '.openai_key');
        const apiKey = readFileSync(apiKeyPath, 'utf-8').trim();
        if (apiKey) {
          const openaiProvider = new OpenAIProvider(apiKey);
          providerManagerInstance.registerProvider(openaiProvider);
          // Don't set as active automatically - let user choose
          console.debug('OpenAI provider registered (not active by default)');
        }
      } catch (_error) {
        // No OpenAI key available, that's OK
        // Note: console.debug might not work in all environments
      }
    }
  }

  return providerManagerInstance;
}

export function resetProviderManager(): void {
  providerManagerInstance = null;
}
