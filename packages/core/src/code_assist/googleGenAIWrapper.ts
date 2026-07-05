/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GoogleGenAIWrapper — implements the NEUTRAL ContentGenerator interface using
 * the Google GenAI SDK. Lives in the code_assist enclave so @google/genai
 * imports are permitted. Converts neutral requests to Google parameters via
 * the boundary adapters and Google responses back to neutral ModelOutput.
 */

import {
  type ContentGenerator,
  type ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import type { Models, GoogleGenAI } from '@google/genai';
import { GoogleGenAI as GoogleGenAIClass } from '@google/genai';
import type {
  ModelGenerationRequest,
  ModelOutput,
  ModelStreamChunk,
  CountTokensRequest,
  CountTokensResult,
  EmbedContentRequest,
  EmbedContentResult,
} from '../llm-types/index.js';
import {
  toGenerateContentParameters,
  fromGenerateContentResponse,
  toCountTokensParameters,
  fromCountTokensResponse,
  fromEmbedContentResponse,
  mapGeminiStreamToChunks,
} from './contentGeneratorAdapters.js';

/**
 * Wrapper around GoogleGenAI models interface to implement the neutral
 * ContentGenerator. Converts at the boundary so callers never see Google types.
 */
export class GoogleGenAIWrapper implements ContentGenerator {
  private models: Models;

  constructor(
    config: ContentGeneratorConfig,
    httpOptions: { headers: Record<string, string> },
  ) {
    const googleGenAI: GoogleGenAI = new GoogleGenAIClass({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });
    this.models = googleGenAI.models;
  }

  async generateContent(
    request: ModelGenerationRequest,
    _userPromptId: string,
  ): Promise<ModelOutput> {
    const params = toGenerateContentParameters(request);
    const response = await this.models.generateContent(params);
    return fromGenerateContentResponse(response);
  }

  async generateContentStream(
    request: ModelGenerationRequest,
    _userPromptId: string,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const params = toGenerateContentParameters(request);
    const stream = await this.models.generateContentStream(params);
    return mapGeminiStreamToChunks(stream);
  }

  async countTokens(request: CountTokensRequest): Promise<CountTokensResult> {
    const params = toCountTokensParameters(request);
    const response = await this.models.countTokens(params);
    return fromCountTokensResponse(response);
  }
  async embedContent(
    request: EmbedContentRequest,
  ): Promise<EmbedContentResult> {
    const params = {
      model: '',
      contents: request.texts,
    };
    const response = await this.models.embedContent(params);
    return fromEmbedContentResponse(response);
  }
}
