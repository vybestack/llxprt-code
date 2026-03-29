/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  Content,
  Part,
} from '@google/genai';
import type { IProviderManager as ProviderManager } from './IProviderManager.js';

/**
 * ContentGenerator implementation that delegates to external providers
 */
export class ProviderContentGenerator implements ContentGenerator {
  constructor(
    private providerManager: ProviderManager,
    private _config: ContentGeneratorConfig,
  ) {
    // Config parameter is reserved for future use
    void this._config;
  }

  private getWrapper(): unknown {
    const provider = this.providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider');
    }
    throw new Error(
      'GeminiCompatibleWrapper has been removed - direct IContent interface is now used',
    );
  }

  async generateContent(
    _request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    // The getWrapper method always throws, so we'll never reach this return
    this.getWrapper();
    throw new Error('This should never be reached');
  }

  async generateContentStream(
    _request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // The getWrapper method always throws, so we'll never reach this return
    this.getWrapper();
    throw new Error('This should never be reached');
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Rough estimation for providers that don't support token counting
    let text = '';
    if (typeof request.contents === 'string') {
      text = request.contents;
    } else if (Array.isArray(request.contents)) {
      text = request.contents
        .flatMap((c: Content) => c.parts || [])
        .map((p: Part) => (p as { text: string }).text || '')
        .join(' ');
    }
    // Very rough approximation: ~4 characters per token
    const estimatedTokens = Math.ceil(text.length / 4);
    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Embeddings not supported for providers');
  }
}
