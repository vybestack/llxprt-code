/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GenerateContentResponse,
  Content,
  CountTokensResponse,
  EmbedContentResponse,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { getErrorMessage } from '../utils/errors.js';

/**
 * Options for generateJson method
 */
export interface GenerateJsonOptions {
  prompt: string;
  schema?: Record<string, unknown>;
  model: string;
  temperature?: number;
  systemInstruction?: string;
  promptId?: string;
}

/**
 * Options for generateEmbedding method
 */
export interface GenerateEmbeddingOptions {
  text: string | string[];
  model: string;
}

/**
 * Options for countTokens method
 */
export interface CountTokensOptions {
  text?: string;
  contents?: Content[];
  model: string;
}

/**
 * Extracts JSON from a string that might be wrapped in markdown code blocks
 * @param text - The raw text that might contain markdown-wrapped JSON
 * @returns The extracted JSON string or the original text if no markdown found
 */
function extractJsonFromMarkdown(text: string): string {
  // Try to match ```json ... ``` or ``` ... ```
  const markdownMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }

  // If no markdown found, return trimmed original text
  return text.trim();
}

/**
 * BaseLLMClient extracts stateless utility methods for LLM operations.
 * Unlike the main Client class, this handles utility calls without conversation state.
 *
 * This implements the baseLlmClient pattern from upstream gemini-cli but adapted
 * for llxprt's multi-provider architecture.
 *
 * Key features:
 * - Multi-provider support (Anthropic, OpenAI, Gemini, Vertex AI)
 * - Stateless operations (no conversation history)
 * - Clean separation from GeminiClient
 * - Dependency injection for testing
 */
export class BaseLLMClient {
  constructor(private readonly contentGenerator: ContentGenerator | null) {
    if (!contentGenerator) {
      throw new Error('ContentGenerator is required');
    }
  }

  /**
   * Generate structured JSON from a prompt with optional schema validation.
   * Supports all providers through the ContentGenerator abstraction.
   *
   * @param options - Generation options including prompt, schema, model, etc.
   * @returns Parsed JSON object
   * @throws Error if generation fails or response cannot be parsed
   */
  async generateJson<T = unknown>(options: GenerateJsonOptions): Promise<T> {
    const {
      prompt,
      schema,
      model,
      temperature = 0,
      systemInstruction,
      promptId = 'baseLlmClient-generateJson',
    } = options;

    try {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ];

      const config: Record<string, unknown> = {
        temperature,
        topP: 1,
      };

      if (systemInstruction) {
        config.systemInstruction = { text: systemInstruction };
      }

      if (schema) {
        config.responseJsonSchema = schema;
        config.responseMimeType = 'application/json';
      }

      const result: GenerateContentResponse =
        await this.contentGenerator!.generateContent(
          {
            model,
            config,
            contents,
          },
          promptId,
        );

      let text = getResponseText(result);
      if (!text) {
        throw new Error('API returned an empty response for generateJson.');
      }

      // Handle markdown wrapping
      const prefix = '```json';
      const suffix = '```';
      if (text.startsWith(prefix) && text.endsWith(suffix)) {
        text = text
          .substring(prefix.length, text.length - suffix.length)
          .trim();
      }

      try {
        // Extract JSON from potential markdown wrapper
        const cleanedText = extractJsonFromMarkdown(text);
        return JSON.parse(cleanedText) as T;
      } catch (parseError) {
        throw new Error(
          `Failed to parse API response as JSON: ${getErrorMessage(
            parseError,
          )}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to generate JSON content: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Generate embeddings for text input.
   * Supports single text string or array of strings.
   *
   * @param options - Embedding options including text and model
   * @returns Embedding vector(s) as number array(s)
   * @throws Error if generation fails or response is invalid
   */
  async generateEmbedding(
    options: GenerateEmbeddingOptions,
  ): Promise<number[] | number[][]> {
    const { text, model } = options;

    try {
      const texts = Array.isArray(text) ? text : [text];

      const embedContentResponse: EmbedContentResponse =
        await this.contentGenerator!.embedContent({
          model,
          contents: texts,
        });

      if (
        !embedContentResponse.embeddings ||
        embedContentResponse.embeddings.length === 0
      ) {
        throw new Error('No embeddings found in API response.');
      }

      if (embedContentResponse.embeddings.length !== texts.length) {
        throw new Error(
          `API returned a mismatched number of embeddings. Expected ${texts.length}, got ${embedContentResponse.embeddings.length}.`,
        );
      }

      const embeddings = embedContentResponse.embeddings.map(
        (embedding, index) => {
          const values = embedding.values;
          if (!values || values.length === 0) {
            throw new Error(
              `API returned an empty embedding for input text at index ${index}: "${texts[index]}"`,
            );
          }
          return values;
        },
      );

      // Return single array if input was a single string
      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      throw new Error(
        `Failed to generate embedding: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Count tokens in text or contents without making an API call to generate.
   * Useful for checking context limits before generation.
   *
   * @param options - Options including text/contents and model
   * @returns Token count
   * @throws Error if counting fails
   */
  async countTokens(options: CountTokensOptions): Promise<number> {
    const { text, contents, model } = options;

    try {
      let requestContents: Content[];

      if (contents) {
        requestContents = contents;
      } else if (text) {
        requestContents = [
          {
            role: 'user',
            parts: [{ text }],
          },
        ];
      } else {
        throw new Error('Either text or contents must be provided');
      }

      const response: CountTokensResponse =
        await this.contentGenerator!.countTokens({
          model,
          contents: requestContents,
        });

      return response.totalTokens ?? 0;
    } catch (error) {
      throw new Error(`Failed to count tokens: ${getErrorMessage(error)}`);
    }
  }
}
