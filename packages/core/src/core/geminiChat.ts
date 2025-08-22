/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// DISCLAIMER: This is a copied version of https://github.com/googleapis/js-genai/blob/main/src/chats.ts with the intention of working around a key bug
// where function responses are not treated as "valid" responses: https://b.corp.google.com/issues/420354090

import {
  GenerateContentResponse,
  Content,
  GenerateContentConfig,
  GenerateContentParameters,
  SendMessageParameters,
  createUserContent,
  Part,
  GenerateContentResponseUsageMetadata,
  Tool,
  PartListUnion,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { ContentGenerator, AuthType } from './contentGenerator.js';
import { Config } from '../config/config.js';
import { estimateTokens } from '../utils/toolOutputLimiter.js';
import {
  logApiRequest,
  logApiResponse,
  logApiError,
} from '../telemetry/loggers.js';
import {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
} from '../telemetry/types.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { hasCycleInSchema } from '../tools/tools.js';
import { isStructuredError } from '../utils/quotaErrorDetection.js';

/**
 * Custom createUserContent function that properly handles function response arrays.
 * This fixes the issue where multiple function responses are incorrectly nested.
 *
 * The Gemini API requires that when multiple function calls are made, each function response
 * must be sent as a separate Part in the same Content, not as nested arrays.
 */
function createUserContentWithFunctionResponseFix(
  message: PartListUnion,
): Content {
  if (typeof message === 'string') {
    return createUserContent(message);
  }

  // Handle array of parts or nested function response arrays
  const parts: Part[] = [];

  if (process.env.DEBUG) {
    console.log(
      '[DEBUG] createUserContentWithFunctionResponseFix - input message:',
      JSON.stringify(message, null, 2),
    );
    console.log(
      '[DEBUG] createUserContentWithFunctionResponseFix - input type check - isArray:',
      Array.isArray(message),
    );
  }

  // If the message is an array, process each element
  if (Array.isArray(message)) {
    // First check if this is an array of functionResponse Parts
    // This happens when multiple tool responses are sent together
    const allFunctionResponses = message.every(
      (item) => item && typeof item === 'object' && 'functionResponse' in item,
    );

    if (allFunctionResponses) {
      // This is already a properly formatted array of function response Parts
      // Just use them directly without any wrapping
      if (process.env.DEBUG) {
        console.log(
          '[DEBUG] createUserContentWithFunctionResponseFix - array of functionResponse Parts, using directly:',
          JSON.stringify(message, null, 2),
        );
      }
      // Cast is safe here because we've checked all items are objects with functionResponse
      parts.push(...(message as Part[]));
    } else {
      // Process mixed content
      for (const item of message) {
        if (typeof item === 'string') {
          parts.push({ text: item });
        } else if (Array.isArray(item)) {
          // Nested array case - flatten it
          if (process.env.DEBUG) {
            console.log(
              '[DEBUG] createUserContentWithFunctionResponseFix - flattening nested array:',
              JSON.stringify(item, null, 2),
            );
          }
          for (const subItem of item) {
            parts.push(subItem);
          }
        } else if (item && typeof item === 'object') {
          // Individual part (function response, text, etc.)
          parts.push(item);
        }
      }
    }
  } else {
    // Not an array, pass through to original createUserContent
    return createUserContent(message);
  }

  const result = {
    role: 'user' as const,
    parts,
  };

  if (process.env.DEBUG) {
    console.log(
      '[DEBUG] createUserContentWithFunctionResponseFix - result parts count:',
      parts.length,
    );
    console.log(
      '[DEBUG] createUserContentWithFunctionResponseFix - result:',
      JSON.stringify(result, null, 2),
    );
  }

  return result;
}

/**
 * Options for retrying due to invalid content from the model.
 */
interface ContentRetryOptions {
  /** Total number of attempts to make (1 initial + N retries). */
  maxAttempts: number;
  /** The base delay in milliseconds for linear backoff. */
  initialDelayMs: number;
}

const INVALID_CONTENT_RETRY_OPTIONS: ContentRetryOptions = {
  maxAttempts: 3, // 1 initial call + 2 retries
  initialDelayMs: 500,
};

/**
 * Returns true if the response is valid, false otherwise.
 */
function isValidResponse(response: GenerateContentResponse): boolean {
  if (response.candidates === undefined || response.candidates.length === 0) {
    return false;
  }
  const content = response.candidates[0]?.content;
  if (content === undefined) {
    return false;
  }
  return isValidContent(content);
}

function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    if (!part.thought && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}

/**
 * Validates the history contains the correct roles.
 *
 * @throws Error if the history does not start with a user turn.
 * @throws Error if the history contains an invalid role.
 */
function validateHistory(history: Content[]) {
  for (const content of history) {
    if (content.role !== 'user' && content.role !== 'model') {
      throw new Error(`Role must be user or model, but got ${content.role}.`);
    }
  }
}

/**
 * Extracts the curated (valid) history from a comprehensive history.
 *
 * @remarks
 * The model may sometimes generate invalid or empty contents(e.g., due to safety
 * filters or recitation). Extracting valid turns from the history
 * ensures that subsequent requests could be accepted by the model.
 */
function extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
  if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
    return [];
  }
  const curatedHistory: Content[] = [];
  const length = comprehensiveHistory.length;
  let i = 0;
  while (i < length) {
    if (comprehensiveHistory[i].role === 'user') {
      curatedHistory.push(comprehensiveHistory[i]);
      i++;
    } else {
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }
      if (isValid) {
        curatedHistory.push(...modelOutput);
      }
    }
  }
  return curatedHistory;
}

/**
 * Custom error to signal that a stream completed without valid content,
 * which should trigger a retry.
 */
export class EmptyStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyStreamError';
  }
}

/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
export class GeminiChat {
  // A promise to represent the current state of the message being sent to the
  // model.
  private sendPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: Config,
    private readonly contentGenerator: ContentGenerator,
    private readonly generationConfig: GenerateContentConfig = {},
    private history: Content[] = [],
  ) {
    validateHistory(history);
  }

  private _getRequestTextFromContents(contents: Content[]): string {
    return JSON.stringify(contents);
  }

  private async _logApiRequest(
    contents: Content[],
    model: string,
    prompt_id: string,
  ): Promise<void> {
    const requestText = this._getRequestTextFromContents(contents);
    logApiRequest(
      this.config,
      new ApiRequestEvent(model, prompt_id, requestText),
    );
  }

  private async _logApiResponse(
    durationMs: number,
    prompt_id: string,
    usageMetadata?: GenerateContentResponseUsageMetadata,
    responseText?: string,
  ): Promise<void> {
    logApiResponse(
      this.config,
      new ApiResponseEvent(
        this.config.getModel(),
        durationMs,
        prompt_id,
        this.config.getContentGeneratorConfig()?.authType,
        usageMetadata,
        responseText,
      ),
    );
  }

  private _logApiError(
    durationMs: number,
    error: unknown,
    prompt_id: string,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : 'unknown';

    logApiError(
      this.config,
      new ApiErrorEvent(
        this.config.getModel(),
        errorMessage,
        durationMs,
        prompt_id,
        this.config.getContentGeneratorConfig()?.authType,
        errorType,
      ),
    );
  }

  /**
   * Handles falling back to Flash model when persistent 429 errors occur for OAuth users.
   * Uses a fallback handler if provided by the config; otherwise, returns null.
   */
  private async handleFlashFallback(
    authType?: string,
    error?: unknown,
  ): Promise<string | null> {
    // Only handle fallback for OAuth users, not for providers
    if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
      return null;
    }

    const currentModel = this.config.getModel();
    const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

    // Don't fallback if already using Flash model
    if (currentModel === fallbackModel) {
      return null;
    }

    // Check if config has a fallback handler (set by CLI package)
    const fallbackHandler = this.config.flashFallbackHandler;
    if (typeof fallbackHandler === 'function') {
      try {
        const accepted = await fallbackHandler(
          currentModel,
          fallbackModel,
          error,
        );
        if (accepted !== false && accepted !== null) {
          this.config.setModel(fallbackModel);
          this.config.setFallbackMode(true);
          return fallbackModel;
        }
        // Check if the model was switched manually in the handler
        if (this.config.getModel() === fallbackModel) {
          return null; // Model was switched but don't continue with current prompt
        }
      } catch (error) {
        console.warn('Flash fallback handler failed:', error);
      }
    }

    return null;
  }

  setSystemInstruction(sysInstr: string) {
    this.generationConfig.systemInstruction = sysInstr;
  }
  /**
   * Sends a message to the model and returns the response.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessageStream} for streaming method.
   * @param params - parameters for sending messages within a chat session.
   * @returns The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessage({
   *   message: 'Why is the sky blue?'
   * });
   * console.log(response.text);
   * ```
   */
  async sendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    await this.sendPromise;
    const userContent = createUserContentWithFunctionResponseFix(
      params.message,
    );
    const requestContents = this.getHistory(true).concat(userContent);

    this._logApiRequest(requestContents, this.config.getModel(), prompt_id);

    const startTime = Date.now();
    let response: GenerateContentResponse;

    try {
      const apiCall = () => {
        const modelToUse = this.config.getModel() || DEFAULT_GEMINI_FLASH_MODEL;

        // Prevent Flash model calls immediately after quota error
        if (
          this.config.getQuotaErrorOccurred() &&
          modelToUse === DEFAULT_GEMINI_FLASH_MODEL
        ) {
          throw new Error(
            'Please submit a new query to continue with the Flash model.',
          );
        }

        return this.contentGenerator.generateContent(
          {
            model: modelToUse,
            contents: requestContents,
            config: { ...this.generationConfig, ...params.config },
          },
          prompt_id,
        );
      };

      response = await retryWithBackoff(apiCall, {
        shouldRetry: (error: unknown) => {
          // Check for known error messages and codes.
          if (error instanceof Error && error.message) {
            if (isSchemaDepthError(error.message)) return false;
            if (error.message.includes('429')) return true;
            if (error.message.match(/5\d{2}/)) return true;
          }
          return false; // Don't retry other errors by default
        },
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });
      const durationMs = Date.now() - startTime;
      await this._logApiResponse(
        durationMs,
        prompt_id,
        response.usageMetadata,
        JSON.stringify(response),
      );

      this.sendPromise = (async () => {
        const outputContent = response.candidates?.[0]?.content;
        // Because the AFC input contains the entire curated chat history in
        // addition to the new user input, we need to truncate the AFC history
        // to deduplicate the existing chat history.
        const fullAutomaticFunctionCallingHistory =
          response.automaticFunctionCallingHistory;
        const index = this.getHistory(true).length;
        let automaticFunctionCallingHistory: Content[] = [];
        if (fullAutomaticFunctionCallingHistory != null) {
          automaticFunctionCallingHistory =
            fullAutomaticFunctionCallingHistory.slice(index) ?? [];
        }
        const modelOutput = outputContent ? [outputContent] : [];
        this.recordHistory(
          userContent,
          modelOutput,
          automaticFunctionCallingHistory,
        );
      })();
      await this.sendPromise.catch(() => {
        // Resets sendPromise to avoid subsequent calls failing
        this.sendPromise = Promise.resolve();
      });
      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      await this.maybeIncludeSchemaDepthContext(error);
      this.sendPromise = Promise.resolve();
      throw error;
    }
  }

  /**
   * Sends a message to the model and returns the response in chunks.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessage} for non-streaming method.
   * @param params - parameters for sending the message.
   * @return The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessageStream({
   *   message: 'Why is the sky blue?'
   * });
   * for await (const chunk of response) {
   *   console.log(chunk.text);
   * }
   * ```
   */
  async sendMessageStream(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    if (process.env.DEBUG) {
      console.log('DEBUG [geminiChat]: ===== SEND MESSAGE STREAM START =====');
      console.log(
        'DEBUG [geminiChat]: Model from config:',
        this.config.getModel(),
      );
      console.log(
        'DEBUG [geminiChat]: Params:',
        JSON.stringify(params, null, 2),
      );
      console.log('DEBUG [geminiChat]: Message type:', typeof params.message);
      console.log(
        'DEBUG [geminiChat]: Message content:',
        JSON.stringify(params.message, null, 2),
      );
    }

    if (process.env.DEBUG) {
      console.log('DEBUG: GeminiChat.sendMessageStream called');
      console.log(
        'DEBUG: GeminiChat.sendMessageStream params:',
        JSON.stringify(params, null, 2),
      );
      console.log(
        'DEBUG: GeminiChat.sendMessageStream params.message type:',
        typeof params.message,
      );
      console.log(
        'DEBUG: GeminiChat.sendMessageStream params.message:',
        JSON.stringify(params.message, null, 2),
      );
    }
    await this.sendPromise;

    let streamDoneResolver: () => void;
    const streamDonePromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });
    this.sendPromise = streamDonePromise;

    const userContent = createUserContent(params.message);

    // Add user content to history ONCE before any attempts.
    this.history.push(userContent);
    const requestContents = this.getHistory(true);

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (async function* () {
      try {
        let lastError: unknown = new Error('Request failed after all retries.');

        for (
          let attempt = 0;
          attempt <= INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;
          attempt++
        ) {
          try {
            const stream = await self.makeApiCallAndProcessStream(
              requestContents,
              params,
              prompt_id,
              userContent,
            );

            for await (const chunk of stream) {
              yield chunk;
            }

            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const isContentError = error instanceof EmptyStreamError;

            if (isContentError) {
              // Check if we have more attempts left.
              if (attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1) {
                await new Promise((res) =>
                  setTimeout(
                    res,
                    INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs *
                      (attempt + 1),
                  ),
                );
                continue;
              }
            }
            break;
          }
        }

        if (lastError) {
          // If the stream fails, remove the user message that was added.
          if (self.history[self.history.length - 1] === userContent) {
            self.history.pop();
          }
          throw lastError;
        }
      } finally {
        streamDoneResolver!();
      }
    })();
  }

  private async makeApiCallAndProcessStream(
    requestContents: Content[],
    params: SendMessageParameters,
    prompt_id: string,
    userContent: Content,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const apiCall = () => {
      const modelToUse = this.config.getModel();

      if (
        this.config.getQuotaErrorOccurred() &&
        modelToUse === DEFAULT_GEMINI_FLASH_MODEL
      ) {
        throw new Error(
          'Please submit a new query to continue with the Flash model.',
        );
      }

      return this.contentGenerator.generateContentStream(
        {
          model: modelToUse,
          contents: requestContents,
          config: { ...this.generationConfig, ...params.config },
        },
        prompt_id,
      );
    };

    const streamResponse = await retryWithBackoff(apiCall, {
      shouldRetry: (error: unknown) => {
        if (error instanceof Error && error.message) {
          if (isSchemaDepthError(error.message)) return false;
          if (error.message.includes('429')) return true;
          if (error.message.match(/5\d{2}/)) return true;
        }
        return false;
      },
      onPersistent429: async (authType?: string, error?: unknown) =>
        await this.handleFlashFallback(authType, error),
      authType: this.config.getContentGeneratorConfig()?.authType,
    });

    return this.processStreamResponse(streamResponse, userContent);
  }

  /**
   * Returns the chat history.
   *
   * @remarks
   * The history is a list of contents alternating between user and model.
   *
   * There are two types of history:
   * - The `curated history` contains only the valid turns between user and
   * model, which will be included in the subsequent requests sent to the model.
   * - The `comprehensive history` contains all turns, including invalid or
   *   empty model outputs, providing a complete record of the history.
   *
   * The history is updated after receiving the response from the model,
   * for streaming response, it means receiving the last chunk of the response.
   *
   * The `comprehensive history` is returned by default. To get the `curated
   * history`, set the `curated` parameter to `true`.
   *
   * @param curated - whether to return the curated history or the comprehensive
   *     history.
   * @return History contents alternating between user and model for the entire
   *     chat session.
   */
  getHistory(curated: boolean = false): Content[] {
    const history = curated
      ? extractCuratedHistory(this.history)
      : this.history;
    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(history);
  }

  /**
   * Clears the chat history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Adds a new entry to the chat history.
   */
  addHistory(content: Content): void {
    this.history.push(content);
  }
  setHistory(history: Content[]): void {
    this.history = history;
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  getFinalUsageMetadata(
    chunks: GenerateContentResponse[],
  ): GenerateContentResponseUsageMetadata | undefined {
    const lastChunkWithMetadata = chunks
      .slice()
      .reverse()
      .find((chunk) => chunk.usageMetadata);

    return lastChunkWithMetadata?.usageMetadata;
  }

  private async *processStreamResponse(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    userInput: Content,
  ): AsyncGenerator<GenerateContentResponse> {
    const modelResponseParts: Part[] = [];
    let isStreamInvalid = false;
    let hasReceivedAnyChunk = false;

    for await (const chunk of streamResponse) {
      hasReceivedAnyChunk = true;
      if (isValidResponse(chunk)) {
        const content = chunk.candidates?.[0]?.content;
        if (content) {
          // Filter out thought parts from being added to history.
          if (!this.isThoughtContent(content) && content.parts) {
            modelResponseParts.push(...content.parts);
          }
        }
      } else {
        isStreamInvalid = true;
      }
      yield chunk; // Yield every chunk to the UI immediately.
    }

    // Now that the stream is finished, make a decision.
    // Throw an error if the stream was invalid OR if it was completely empty.
    if (isStreamInvalid || !hasReceivedAnyChunk) {
      throw new EmptyStreamError(
        'Model stream was invalid or completed without valid content.',
      );
    }

    // Use recordHistory to correctly save the conversation turn.
    const modelOutput: Content[] = [
      { role: 'model', parts: modelResponseParts },
    ];
    this.recordHistory(userInput, modelOutput);
  }

  private recordHistory(
    userInput: Content,
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
  ) {
    const newHistoryEntries: Content[] = [];

    // Part 1: Handle the user's part of the turn.
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      newHistoryEntries.push(
        ...extractCuratedHistory(automaticFunctionCallingHistory),
      );
    } else {
      // Guard for streaming calls where the user input might already be in the history.
      if (
        this.history.length === 0 ||
        this.history[this.history.length - 1] !== userInput
      ) {
        newHistoryEntries.push(userInput);
      }
    }

    // Part 2: Handle the model's part of the turn, filtering out thoughts.
    const nonThoughtModelOutput = modelOutput.filter(
      (content) => !this.isThoughtContent(content),
    );

    let outputContents: Content[] = [];
    if (nonThoughtModelOutput.length > 0) {
      outputContents = nonThoughtModelOutput;
    } else if (
      modelOutput.length === 0 &&
      !isFunctionResponse(userInput) &&
      !automaticFunctionCallingHistory
    ) {
      // Add an empty model response if the model truly returned nothing.
      outputContents.push({ role: 'model', parts: [] } as Content);
    }

    // Part 3: Consolidate the parts of this turn's model response.
    const consolidatedOutputContents: Content[] = [];
    if (outputContents.length > 0) {
      for (const content of outputContents) {
        const lastContent =
          consolidatedOutputContents[consolidatedOutputContents.length - 1];
        if (this.hasTextContent(lastContent) && this.hasTextContent(content)) {
          lastContent.parts[0].text += content.parts[0].text || '';
          if (content.parts.length > 1) {
            lastContent.parts.push(...content.parts.slice(1));
          }
        } else {
          consolidatedOutputContents.push(content);
        }
      }
    }

    // Part 4: Add the new turn (user and model parts) to the main history.
    this.history.push(...newHistoryEntries, ...consolidatedOutputContents);
  }

  private hasTextContent(
    content: Content | undefined,
  ): content is Content & { parts: [{ text: string }, ...Part[]] } {
    return !!(
      content &&
      content.role === 'model' &&
      content.parts &&
      content.parts.length > 0 &&
      typeof content.parts[0].text === 'string' &&
      content.parts[0].text !== ''
    );
  }

  private isThoughtContent(
    content: Content | undefined,
  ): content is Content & { parts: [{ thought: boolean }, ...Part[]] } {
    return !!(
      content &&
      content.role === 'model' &&
      content.parts &&
      content.parts.length > 0 &&
      typeof content.parts[0].thought === 'boolean' &&
      content.parts[0].thought === true
    );
  }

  /**
   * Trim prompt contents to fit within token limit
   * Strategy: Keep the most recent user message, trim older history and tool outputs
   */
  private trimPromptContents(
    contents: Content[],
    maxTokens: number,
  ): Content[] {
    if (contents.length === 0) return contents;

    // Always keep the last message (current user input)
    const lastMessage = contents[contents.length - 1];
    const result: Content[] = [];

    // Reserve tokens for the last message and warning
    const lastMessageTokens = estimateTokens(JSON.stringify(lastMessage));
    const warningTokens = 200; // Reserve for warning message
    let remainingTokens = maxTokens - lastMessageTokens - warningTokens;

    if (remainingTokens <= 0) {
      // Even the last message is too big, truncate it
      return [this.truncateContent(lastMessage, maxTokens - warningTokens)];
    }

    // Add messages from most recent to oldest, stopping when we hit the limit
    for (let i = contents.length - 2; i >= 0; i--) {
      const content = contents[i];
      const contentTokens = estimateTokens(JSON.stringify(content));

      if (contentTokens <= remainingTokens) {
        result.unshift(content);
        remainingTokens -= contentTokens;
      } else if (remainingTokens > 100) {
        // Try to truncate this content to fit
        const truncated = this.truncateContent(content, remainingTokens);
        // Only add if we actually got some content back
        if (truncated.parts && truncated.parts.length > 0) {
          result.unshift(truncated);
        }
        break;
      } else {
        // No room left, stop
        break;
      }
    }

    // Add the last message
    result.push(lastMessage);

    return result;
  }

  /**
   * Truncate a single content to fit within token limit
   */
  private truncateContent(content: Content, maxTokens: number): Content {
    if (!content.parts || content.parts.length === 0) {
      return content;
    }

    const truncatedParts: Part[] = [];
    let currentTokens = 0;

    for (const part of content.parts) {
      if ('text' in part && part.text) {
        const partTokens = estimateTokens(part.text);
        if (currentTokens + partTokens <= maxTokens) {
          truncatedParts.push(part);
          currentTokens += partTokens;
        } else {
          // Truncate this part
          const remainingTokens = maxTokens - currentTokens;
          if (remainingTokens > 10) {
            const remainingChars = remainingTokens * 4;
            truncatedParts.push({
              text:
                part.text.substring(0, remainingChars) +
                '\n[...content truncated due to token limit...]',
            });
          }
          break;
        }
      } else {
        // Non-text parts (function calls, responses, etc) - NEVER truncate these
        // Either include them fully or skip them entirely to avoid breaking JSON
        const partTokens = estimateTokens(JSON.stringify(part));
        if (currentTokens + partTokens <= maxTokens) {
          truncatedParts.push(part);
          currentTokens += partTokens;
        } else {
          // Skip this part entirely - DO NOT truncate function calls/responses
          // Log what we're skipping for debugging
          if (process.env.DEBUG || process.env.VERBOSE) {
            let skipInfo = 'unknown part';
            if ('functionCall' in part) {
              const funcPart = part as { functionCall?: { name?: string } };
              skipInfo = `functionCall: ${funcPart.functionCall?.name || 'unnamed'}`;
            } else if ('functionResponse' in part) {
              const respPart = part as { functionResponse?: { name?: string } };
              skipInfo = `functionResponse: ${respPart.functionResponse?.name || 'unnamed'}`;
            }
            console.warn(
              `INFO: Skipping ${skipInfo} due to token limit (needs ${partTokens} tokens, only ${maxTokens - currentTokens} available)`,
            );
          }
          // Add a marker that content was omitted
          if (
            truncatedParts.length > 0 &&
            !truncatedParts.some(
              (p) =>
                'text' in p &&
                p.text?.includes(
                  '[...function calls omitted due to token limit...]',
                ),
            )
          ) {
            truncatedParts.push({
              text: '[...function calls omitted due to token limit...]',
            });
          }
          break;
        }
      }
    }

    return {
      role: content.role,
      parts: truncatedParts,
    };
  }

  private async maybeIncludeSchemaDepthContext(error: unknown): Promise<void> {
    // Check for potentially problematic cyclic tools with cyclic schemas
    // and include a recommendation to remove potentially problematic tools.
    if (isStructuredError(error) && isSchemaDepthError(error.message)) {
      const tools = (await this.config.getToolRegistry()).getAllTools();
      const cyclicSchemaTools: string[] = [];
      for (const tool of tools) {
        if (
          (tool.schema.parametersJsonSchema &&
            hasCycleInSchema(tool.schema.parametersJsonSchema)) ||
          (tool.schema.parameters && hasCycleInSchema(tool.schema.parameters))
        ) {
          cyclicSchemaTools.push(tool.displayName);
        }
      }
      if (cyclicSchemaTools.length > 0) {
        const extraDetails =
          `\n\nThis error was probably caused by cyclic schema references in one of the following tools, try disabling them:\n\n - ` +
          cyclicSchemaTools.join(`\n - `) +
          `\n`;
        error.message += extraDetails;
      }
    }
  }
}

/** Visible for Testing */
export function isSchemaDepthError(errorMessage: string): boolean {
  return errorMessage.includes('maximum schema depth exceeded');
}
