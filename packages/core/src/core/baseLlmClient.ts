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
  Part,
  GenerateContentParameters,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { getErrorMessage } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

const DEFAULT_MAX_ATTEMPTS = 3;

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
  /**
   * The maximum number of attempts for the request.
   */
  maxAttempts?: number;
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
 * Options for the generateContent utility function.
 */
export interface GenerateContentOptions {
  /** The input prompt or history. */
  contents: Content[];
  /** The model to use. */
  model: string;
  /**
   * Task-specific system instructions.
   * If omitted, no system instruction is sent.
   */
  systemInstruction?: string | Part | Part[] | Content;
  /** Signal for cancellation. */
  abortSignal: AbortSignal;
  /**
   * A unique ID for the prompt, used for logging/telemetry correlation.
   */
  promptId: string;
  /**
   * The maximum number of attempts for the request.
   */
  maxAttempts?: number;
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

    const shouldRetryOnContent = (response: GenerateContentResponse) => {
      const text = getResponseText(response)?.trim();
      if (!text) {
        return true; // Retry on empty response
      }
      try {
        // Extract JSON from potential markdown wrapper
        const cleanedText = extractJsonFromMarkdown(text);
        JSON.parse(cleanedText);
        return false; // Valid JSON, don't retry
      } catch (_e) {
        return true; // Invalid JSON, retry
      }
    };

    const result = await this._generateWithRetry(
      {
        model,
        contents,
        config,
      },
      promptId,
      options.maxAttempts,
      shouldRetryOnContent,
      'generateJson',
    );

    let text = getResponseText(result);
    if (!text) {
      throw new Error('API returned an empty response for generateJson.');
    }

    // Handle markdown wrapping
    const prefix = '```json';
    const suffix = '```';
    if (text.startsWith(prefix) && text.endsWith(suffix)) {
      text = text.substring(prefix.length, text.length - suffix.length).trim();
    }

    try {
      // Extract JSON from potential markdown wrapper
      const cleanedText = extractJsonFromMarkdown(text);
      return JSON.parse(cleanedText) as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse API response as JSON: ${getErrorMessage(parseError)}`,
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

  /**
   * Generate content from a prompt.
   * This is a general-purpose content generation method that doesn't enforce JSON output.
   *
   * @param options - Generation options
   * @returns Raw GenerateContentResponse
   * @throws Error if generation fails
   */
  async generateContent(
    options: GenerateContentOptions,
  ): Promise<GenerateContentResponse> {
    const {
      contents,
      model,
      systemInstruction,
      abortSignal,
      promptId,
      maxAttempts,
    } = options;

    const config: Record<string, unknown> = {
      temperature: 0,
      topP: 1,
      abortSignal,
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const shouldRetryOnContent = (response: GenerateContentResponse) => {
      const text = getResponseText(response)?.trim();
      return !text; // Retry on empty response
    };

    return this._generateWithRetry(
      {
        model,
        contents,
        config,
      },
      promptId,
      maxAttempts,
      shouldRetryOnContent,
      'generateContent',
    );
  }

  private async _generateWithRetry(
    requestParams: GenerateContentParameters,
    promptId: string,
    maxAttempts: number | undefined,
    shouldRetryOnContent: (response: GenerateContentResponse) => boolean,
    _errorContext: 'generateJson' | 'generateContent',
  ): Promise<GenerateContentResponse> {
    const abortSignal = requestParams.config?.abortSignal as
      | AbortSignal
      | undefined;

    try {
      const apiCall = () =>
        this.contentGenerator!.generateContent(requestParams, promptId);

      return await retryWithBackoff(apiCall, {
        shouldRetryOnContent,
        maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        throw error;
      }

      throw new Error(`Failed to generate content: ${getErrorMessage(error)}`);
    }
  }
}
