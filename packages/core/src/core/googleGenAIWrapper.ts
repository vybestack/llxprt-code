/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ContentGenerator,
  ContentGeneratorConfig,
} from './contentGenerator.js';
import {
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GoogleGenAI,
  Models,
} from '@google/genai';

/**
 * Wrapper around GoogleGenAI models interface to implement ContentGenerator
 * This wrapper ensures that user_prompt_id is NOT passed to the Google GenAI API
 */
export class GoogleGenAIWrapper implements ContentGenerator {
  private models: Models;

  constructor(
    config: ContentGeneratorConfig,
    httpOptions: { headers: Record<string, string> },
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });
    this.models = googleGenAI.models;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    // The Google GenAI SDK doesn't accept user_prompt_id, so we just pass the request as-is
    return this.models.generateContent(request);
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // The Google GenAI SDK doesn't accept user_prompt_id, so we just pass the request as-is
    return this.models.generateContentStream(request);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    return this.models.countTokens(request);
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    return this.models.embedContent(request);
  }
}
