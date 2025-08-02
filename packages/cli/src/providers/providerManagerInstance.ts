/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ProviderManager,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  sanitizeForByteString,
  needsSanitization,
} from '@vybestack/llxprt-code-core';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Settings, USER_SETTINGS_PATH } from '../config/settings.js';
import stripJsonComments from 'strip-json-comments';

/**
 * Sanitizes API keys to remove problematic characters that cause ByteString errors.
 * This handles cases where API key files have encoding issues or contain
 * Unicode replacement characters (U+FFFD).
 */
function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    console.warn(
      '[ProviderManager] API key contained non-ASCII or control characters that were removed. ' +
        'Please check your API key file encoding (should be UTF-8 without BOM).',
    );
  }

  return sanitized;
}

let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(config?: Config): ProviderManager {
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
          userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
          savedApiKeys = userSettings.providerApiKeys || {};
        }
      } catch (_error) {
        // Failed to load user settings, that's OK
      }

      // Register GeminiProvider
      const geminiProvider = new GeminiProvider();

      // Set initial model from settings if available
      if (userSettings?.defaultModel) {
        geminiProvider.setModel(userSettings.defaultModel);
      }

      if (config) {
        geminiProvider.setConfig(config);
      }
      providerManagerInstance.registerProvider(geminiProvider);

      // Configure Gemini auth with priority: keyfile > key > oauth
      // First check for saved API key
      if (savedApiKeys.gemini) {
        geminiProvider.setApiKey(sanitizeApiKey(savedApiKeys.gemini));
      }
      // Then check for keyfile
      else {
        try {
          const keyfilePath = join(homedir(), '.google_key');
          const geminiApiKey = readFileSync(keyfilePath, 'utf-8').trim();
          if (geminiApiKey) {
            geminiProvider.setApiKey(sanitizeApiKey(geminiApiKey));
          }
        } catch (_error) {
          // No Google keyfile available, that's OK - will use OAuth if available
        }
      }

      // Initialize with OpenAI provider if API key is available
      // Priority: CLI /key (in settings) > Environment variable > keyfile
      let openaiApiKey: string | undefined = savedApiKeys.openai
        ? sanitizeApiKey(savedApiKeys.openai)
        : undefined;

      if (!openaiApiKey && process.env.OPENAI_API_KEY) {
        openaiApiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
      }

      if (!openaiApiKey) {
        try {
          const apiKeyPath = join(homedir(), '.openai_key');
          const rawKey = readFileSync(apiKeyPath, 'utf-8').trim();
          openaiApiKey = sanitizeApiKey(rawKey);
        } catch (_error) {
          // No OpenAI keyfile available, that's OK
        }
      }

      const openaiBaseUrl = process.env.OPENAI_BASE_URL;
      if (process.env.DEBUG || process.env.VERBOSE) {
        console.log('[ProviderManager] Initializing OpenAI provider with:', {
          hasApiKey: !!openaiApiKey,
          baseUrl: openaiBaseUrl || 'default',
        });
      }
      const openaiProvider = new OpenAIProvider(
        openaiApiKey || '',
        openaiBaseUrl,
        userSettings,
      );
      providerManagerInstance.registerProvider(openaiProvider);
      // OpenAI provider registered

      // Initialize with Anthropic provider if API key is available
      // Priority: CLI /key (in settings) > Environment variable > keyfile
      let anthropicApiKey: string | undefined = savedApiKeys.anthropic
        ? sanitizeApiKey(savedApiKeys.anthropic)
        : undefined;

      if (!anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
        anthropicApiKey = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
      }

      if (!anthropicApiKey) {
        try {
          const apiKeyPath = join(homedir(), '.anthropic_key');
          const rawKey = readFileSync(apiKeyPath, 'utf-8').trim();
          anthropicApiKey = sanitizeApiKey(rawKey);
        } catch (_error) {
          // No Anthropic keyfile available, that's OK
        }
      }

      const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
      const anthropicProvider = new AnthropicProvider(
        anthropicApiKey || '',
        anthropicBaseUrl,
      );
      providerManagerInstance.registerProvider(anthropicProvider);
      // Anthropic provider registered
    }
  }

  return providerManagerInstance;
}

export function resetProviderManager(): void {
  providerManagerInstance = null;
}

export { getProviderManager as providerManager };
