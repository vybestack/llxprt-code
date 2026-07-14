/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type {
  ModelGenerationRequest,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';

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
  contents?: IContent[];
  model: string;
}

/**
 * Options for the generateContent utility function.
 */
export interface GenerateContentOptions {
  /** The input prompt or history. */
  contents: IContent[];
  /** The model to use. */
  model: string;
  /**
   * Task-specific system instructions.
   * If omitted, no system instruction is sent.
   */
  systemInstruction?: string;
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
  const openingFence = text.indexOf('```');
  if (openingFence === -1) {
    return text.trim();
  }

  const afterOpeningFence = openingFence + '```'.length;
  const lineEnd = text.indexOf('\n', afterOpeningFence);
  const openingLineEnd = lineEnd === -1 ? text.length : lineEnd;
  const infoString = text.slice(afterOpeningFence, openingLineEnd).trim();
  if (infoString !== '' && infoString.toLowerCase() !== 'json') {
    return text.trim();
  }

  const contentStart = lineEnd === -1 ? openingLineEnd : lineEnd + 1;
  const closingFence = text.indexOf('```', contentStart);
  if (closingFence !== -1) {
    return text.slice(contentStart, closingFence).trim();
  }

  return text.trim();
}

/**
 * Extract text from a neutral ModelOutput's content blocks.
 */
function getTextFromModelOutput(output: ModelOutput): string {
  const blocks = output.content.blocks;
  const textBlocks = blocks.filter(
    (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text',
  );
  return textBlocks.map((b) => b.text).join('');
}

/**
 * Convert IContent[] to IContent[] — identity pass-through now that the
 * Content type is neutral IContent everywhere.
 */
function contentsToIContents(contents: IContent[]): IContent[] {
  return contents;
}

/**
 * BaseLLMClient extracts stateless utility methods for LLM operations.
 * Unlike the main Client class, this handles utility calls without conversation state.
 *
 * Key features:
 * - Multi-provider support (Anthropic, OpenAI, Gemini, Vertex AI)
 * - Stateless operations (no conversation history)
 * - Clean separation from AgentClient
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

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: prompt }],
      },
    ];

    const icontents = contentsToIContents(contents);

    const settings: ModelGenerationRequest['settings'] = {
      temperature,
      topP: 1,
    };

    if (systemInstruction) {
      settings.systemInstruction = systemInstruction;
    }

    const modelParams: Record<string, unknown> = {};
    if (schema) {
      settings.responseJsonSchema = schema;
      modelParams.responseMimeType = 'application/json';
    }

    const shouldRetryOnContent = (output: ModelOutput) => {
      const text = getTextFromModelOutput(output).trim();
      if (!text) {
        return true;
      }
      try {
        const cleanedText = extractJsonFromMarkdown(text);
        JSON.parse(cleanedText);
        return false;
      } catch {
        return true;
      }
    };

    const result = await this._generateWithRetry(
      {
        model,
        contents: icontents,
        settings,
        modelParams:
          Object.keys(modelParams).length > 0 ? modelParams : undefined,
      },
      promptId,
      options.maxAttempts,
      shouldRetryOnContent,
      'generateJson',
    );

    let text = getTextFromModelOutput(result);
    if (!text) {
      throw new Error('API returned an empty response for generateJson.');
    }

    const prefix = '```json';
    const suffix = '```';
    if (text.startsWith(prefix) && text.endsWith(suffix)) {
      text = text.substring(prefix.length, text.length - suffix.length).trim();
    }

    try {
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
   */
  async generateEmbedding(
    options: GenerateEmbeddingOptions,
  ): Promise<number[] | number[][]> {
    const { text } = options;

    try {
      const texts = Array.isArray(text) ? text : [text];

      const result = await this.contentGenerator!.embedContent({
        texts,
      });

      if (result.embeddings.length === 0) {
        throw new Error('No embeddings found in API response.');
      }

      if (result.embeddings.length !== texts.length) {
        throw new Error(
          `API returned a mismatched number of embeddings. Expected ${texts.length}, got ${result.embeddings.length}.`,
        );
      }

      const embeddings = result.embeddings.map((values, index) => {
        if (values.length === 0) {
          throw new Error(
            `API returned an empty embedding for input text at index ${index}: "${texts[index]}"`,
          );
        }
        return values;
      });

      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      throw new Error(
        `Failed to generate embedding: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Count tokens in text or contents without making an API call to generate.
   */
  async countTokens(options: CountTokensOptions): Promise<number> {
    const { text, contents } = options;

    try {
      let requestContents: IContent[];

      if (contents) {
        requestContents = contents;
      } else if (text) {
        requestContents = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text }],
          },
        ];
      } else {
        throw new Error('Either text or contents must be provided');
      }

      const icontents = contentsToIContents(requestContents);

      const result = await this.contentGenerator!.countTokens({
        contents: icontents,
      });

      return result.totalTokens;
    } catch (error) {
      throw new Error(`Failed to count tokens: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Generate content from a prompt.
   * Returns the neutral ModelOutput contract.
   */
  async generateContent(options: GenerateContentOptions): Promise<ModelOutput> {
    const {
      contents,
      model,
      systemInstruction,
      abortSignal,
      promptId,
      maxAttempts,
    } = options;

    const icontents = contentsToIContents(contents);

    const settings: ModelGenerationRequest['settings'] = {
      temperature: 0,
      topP: 1,
    };

    if (systemInstruction !== undefined && systemInstruction !== '') {
      settings.systemInstruction = systemInstruction;
    }

    const shouldRetryOnContent = (output: ModelOutput) => {
      const text = getTextFromModelOutput(output).trim();
      return !text;
    };

    return this._generateWithRetry(
      {
        model,
        contents: icontents,
        settings,
        abortSignal,
      },
      promptId,
      maxAttempts,
      shouldRetryOnContent,
      'generateContent',
    );
  }

  private async _generateWithRetry(
    request: ModelGenerationRequest,
    promptId: string,
    maxAttempts: number | undefined,
    shouldRetryOnContent: (output: ModelOutput) => boolean,
    _errorContext: 'generateJson' | 'generateContent',
  ): Promise<ModelOutput> {
    const abortSignal = request.abortSignal;

    try {
      const apiCall = () =>
        this.contentGenerator!.generateContent(request, promptId);

      return await retryWithBackoff(apiCall, {
        shouldRetryOnContent,
        maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });
    } catch (error) {
      if (abortSignal?.aborted === true) {
        throw error;
      }

      throw new Error(`Failed to generate content: ${getErrorMessage(error)}`);
    }
  }
}
