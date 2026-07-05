/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ContentGenerator,
  type ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type {
  ModelGenerationRequest,
  ModelOutput,
  ModelStreamChunk,
  CountTokensRequest,
  CountTokensResult,
  EmbedContentRequest,
  EmbedContentResult,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Minimal structural contract for the provider-manager capability that
 * {@link ProviderContentGenerator} consumes. Both the concrete
 * `ProviderManager` (via `IProviderManager`) and the core-owned
 * `RuntimeProviderManager` satisfy this surface, so the composition root can
 * pass either without a cast bridge.
 */
export interface ProviderContentGeneratorManager {
  getActiveProvider(): { name: string } | undefined;
}

/**
 * ContentGenerator implementation that delegates to external providers.
 *
 * The actual generation goes through the IContent pipeline (not this class).
 * Only countTokens estimation and embedContent throwing are implemented here.
 */
export class ProviderContentGenerator implements ContentGenerator {
  constructor(
    private providerManager: ProviderContentGeneratorManager,
    private _config: ContentGeneratorConfig,
  ) {
    void this.providerManager;
    void this._config;
  }

  private throwDirectNotSupported(): never {
    throw new Error(
      'Provider-backed content generation uses the IContent pipeline; direct ContentGenerator generation is not supported',
    );
  }

  async generateContent(
    _request: ModelGenerationRequest,
    _userPromptId: string,
  ): Promise<ModelOutput> {
    this.throwDirectNotSupported();
  }

  async generateContentStream(
    _request: ModelGenerationRequest,
    _userPromptId: string,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    this.throwDirectNotSupported();
  }

  async countTokens(request: CountTokensRequest): Promise<CountTokensResult> {
    let text = '';
    for (const content of request.contents) {
      for (const block of content.blocks) {
        if (block.type === 'text') {
          text += block.text + ' ';
        }
      }
    }
    const estimatedTokens = Math.ceil(text.trim().length / 4);
    return { totalTokens: estimatedTokens };
  }

  async embedContent(
    _request: EmbedContentRequest,
  ): Promise<EmbedContentResult> {
    throw new Error('Embeddings not supported for providers');
  }
}
