/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ContentGenerator,
  ContentGeneratorConfig,
} from '@google/gemini-cli-core';
import { getProviderManager } from './providerManagerInstance.js';
import { GeminiCompatibleWrapper } from './adapters/GeminiCompatibleWrapper.js';

/**
 * Creates a ContentGenerator using the active provider if available
 * @param config The content generator configuration
 * @param defaultGenerator Function to create the default Gemini generator
 * @returns A ContentGenerator instance
 */
export async function createProviderContentGenerator(
  config: ContentGeneratorConfig,
  defaultGenerator: () => Promise<ContentGenerator>,
): Promise<ContentGenerator> {
  try {
    const providerManager = getProviderManager();
    const providers = providerManager.listProviders();

    // If no providers are registered or active, use the default Gemini generator
    if (providers.length === 0) {
      return defaultGenerator();
    }

    // Get the active provider
    const activeProvider = providerManager.getActiveProvider();

    // Create a wrapper that makes the provider compatible with ContentGenerator
    const wrapper = new GeminiCompatibleWrapper(activeProvider);

    // Return an object that implements ContentGenerator interface
    return {
      async generateContent(request) {
        return wrapper.generateContent({
          model: request.model || config.model,
          contents: request.contents,
          config: request.config,
        });
      },

      async generateContentStream(request) {
        return wrapper.generateContentStream({
          model: request.model || config.model,
          contents: request.contents,
          config: request.config,
        });
      },

      // These methods are not supported by providers yet
      async countTokens() {
        throw new Error(
          'Token counting not supported for provider-based generators',
        );
      },

      async embedContent() {
        throw new Error(
          'Embeddings not supported for provider-based generators',
        );
      },
    };
  } catch (error) {
    // If there's any error setting up the provider, fall back to default
    console.debug('Failed to create provider content generator:', error);
    return defaultGenerator();
  }
}
