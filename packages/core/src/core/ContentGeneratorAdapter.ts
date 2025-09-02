/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ContentGenerator } from './contentGenerator.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import {
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensResponse,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import { UserTierId } from '../code_assist/types.js';
import type { IContent } from '../services/history/IContent.js';

/**
 * Adapter that wraps ContentGenerator to work with IContent[]
 * This allows GeminiChat to pass IContent[] which gets converted
 * to Content[] format for providers
 */
export class ContentGeneratorAdapter implements ContentGenerator {
  constructor(private contentGenerator: ContentGenerator) {}

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    // Request should already have the contents set by GeminiChat
    return this.contentGenerator.generateContent(request, userPromptId);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // Request should already have the contents set by GeminiChat
    return this.contentGenerator.generateContentStream(request, userPromptId);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Request should already have the contents set by GeminiChat
    return this.contentGenerator.countTokens(request);
  }

  /**
   * Helper method to convert IContent[] to Content[] and create request
   */
  static createRequest(
    iContents: IContent[],
    model: string,
    config?: Record<string, unknown>,
  ): GenerateContentParameters {
    const contents = ContentConverters.toGeminiContents(iContents);
    return {
      model,
      contents,
      config,
    };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Embedding doesn't use history, so just pass through
    return this.contentGenerator.embedContent(request);
  }

  get userTier(): UserTierId | undefined {
    return this.contentGenerator.userTier;
  }
}
