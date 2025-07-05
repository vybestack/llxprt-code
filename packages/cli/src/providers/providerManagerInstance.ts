/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager } from './ProviderManager.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { AnthropicProvider } from './anthropic/AnthropicProvider.js';
import { Qwen3FireworksProvider } from './openai/Qwen3FireworksProvider.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Settings, USER_SETTINGS_PATH } from '../config/settings.js';
import stripJsonComments from 'strip-json-comments';

let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();

    // Only auto-initialize providers when not in test environment
    if (process.env.NODE_ENV !== 'test') {
      // Load user settings to check for saved API keys
      let savedApiKeys: Record<string, string> = {};
      let userSettings: Settings | undefined;
      try {
        if (existsSync(USER_SETTINGS_PATH)) {
          const userContent = readFileSync(USER_SETTINGS_PATH, 'utf-8');
          userSettings = JSON.parse(
            stripJsonComments(userContent),
          ) as Settings;
          savedApiKeys = userSettings.providerApiKeys || {};
        }
      } catch (_error) {
        // Failed to load user settings, that's OK
      }

      // Register GeminiProvider
      const geminiProvider = new GeminiProvider();
      providerManagerInstance.registerProvider(geminiProvider);

      // If there's a saved Gemini API key, apply it
      if (savedApiKeys.gemini) {
        geminiProvider.setApiKey(savedApiKeys.gemini);
      }

      // Initialize with OpenAI provider if API key is available
      // Priority: CLI /key (in settings) > Environment variable > keyfile
      let openaiApiKey: string | undefined = savedApiKeys.openai;

      if (!openaiApiKey) {
        openaiApiKey = process.env.OPENAI_API_KEY;
      }

      if (!openaiApiKey) {
        try {
          const apiKeyPath = join(homedir(), '.openai_key');
          openaiApiKey = readFileSync(apiKeyPath, 'utf-8').trim();
        } catch (_error) {
          // No OpenAI keyfile available, that's OK
        }
      }

      if (openaiApiKey) {
        const openaiProvider = new OpenAIProvider(openaiApiKey);
        providerManagerInstance.registerProvider(openaiProvider);
        console.debug('OpenAI provider registered (not active by default)');
      }

      // Initialize with Anthropic provider if API key is available
      // Priority: CLI /key (in settings) > Environment variable > keyfile
      let anthropicApiKey: string | undefined = savedApiKeys.anthropic;

      if (!anthropicApiKey) {
        anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      }

      if (!anthropicApiKey) {
        try {
          const apiKeyPath = join(homedir(), '.anthropic_key');
          anthropicApiKey = readFileSync(apiKeyPath, 'utf-8').trim();
        } catch (_error) {
          // No Anthropic keyfile available, that's OK
        }
      }

      if (anthropicApiKey) {
        const anthropicProvider = new AnthropicProvider(anthropicApiKey);
        providerManagerInstance.registerProvider(anthropicProvider);
        console.debug('Anthropic provider registered (not active by default)');
      }

      // Initialize Qwen3-Fireworks provider if API key is available
      // Priority: Environment variable > OpenAI API key (since Fireworks uses OpenAI-compatible API)
      let fireworksApiKey: string | undefined = savedApiKeys['qwen3-fireworks'];
      
      if (!fireworksApiKey) {
        fireworksApiKey = process.env.FIREWORKS_API_KEY;
      }
      
      // If no Fireworks-specific key, try using OpenAI key as fallback
      if (!fireworksApiKey) {
        fireworksApiKey = openaiApiKey;
      }
      
      if (fireworksApiKey) {
        const qwen3Provider = new Qwen3FireworksProvider(fireworksApiKey, userSettings);
        providerManagerInstance.registerProvider(qwen3Provider);
        console.debug('Qwen3-Fireworks provider registered (not active by default)');
      }
    }
  }

  return providerManagerInstance;
}

export function resetProviderManager(): void {
  providerManagerInstance = null;
}
