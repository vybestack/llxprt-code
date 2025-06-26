/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ContentGenerator } from '@google/gemini-cli-core';
import {
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
} from '@google/genai';
import { getProviderManager } from './providerManagerInstance.js';
import { GeminiCompatibleWrapper } from './adapters/GeminiCompatibleWrapper.js';

/**
 * A ContentGenerator that checks for active providers and delegates to them,
 * or falls back to the original Gemini content generator
 */
export class ProviderAwareContentGenerator implements ContentGenerator {
  private providerWrapper: GeminiCompatibleWrapper | null = null;

  constructor(
    private fallbackGenerator: ContentGenerator,
    private getModel: () => string,
  ) {}

  private getActiveWrapper(): GeminiCompatibleWrapper | null {
    try {
      const providerManager = getProviderManager();
      if (providerManager.hasActiveProvider()) {
        const activeProvider = providerManager.getActiveProvider();
        if (
          !this.providerWrapper ||
          this.providerWrapper.provider !== activeProvider
        ) {
          this.providerWrapper = new GeminiCompatibleWrapper(activeProvider);
        }
        return this.providerWrapper;
      }
    } catch (error) {
      console.debug('Failed to get active provider:', error);
    }
    return null;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const wrapper = this.getActiveWrapper();
    if (wrapper) {
      console.debug(
        '[ProviderAwareContentGenerator] Using provider for generateContent',
      );
      return wrapper.generateContent({
        model: request.model || this.getModel(),
        contents: request.contents,
        config: request.config,
      });
    }

    console.debug(
      '[ProviderAwareContentGenerator] Using fallback generator for generateContent',
    );
    return this.fallbackGenerator.generateContent(request);
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const wrapper = this.getActiveWrapper();
    if (wrapper) {
      console.debug(
        '[ProviderAwareContentGenerator] Using provider for generateContentStream',
      );
      console.debug(
        '[ProviderAwareContentGenerator] Provider:',
        wrapper.provider.name,
      );
      console.debug(
        '[ProviderAwareContentGenerator] Model:',
        request.model || this.getModel(),
      );
      return wrapper.generateContentStream({
        model: request.model || this.getModel(),
        contents: request.contents,
        config: request.config,
      });
    }

    console.debug(
      '[ProviderAwareContentGenerator] Using fallback generator for generateContentStream',
    );
    console.debug('[ProviderAwareContentGenerator] No active provider found');
    return this.fallbackGenerator.generateContentStream(request);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Providers don't support token counting yet, always use fallback
    return this.fallbackGenerator.countTokens(request);
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Providers don't support embeddings yet, always use fallback
    return this.fallbackGenerator.embedContent(request);
  }
}
