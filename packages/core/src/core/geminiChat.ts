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
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  UsageStats,
} from '../services/history/IContent.js';
import type { IProvider } from '../providers/IProvider.js';
// import { estimateTokens } from '../utils/toolOutputLimiter.js'; // Unused after retry stream refactor
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
import { DebugLogger } from '../debug/index.js';
import { getCompressionPrompt } from './prompts.js';
import {
  COMPRESSION_TOKEN_THRESHOLD,
  COMPRESSION_PRESERVE_THRESHOLD,
} from './compression-config.js';

export enum StreamEventType {
  /** A regular content chunk from the API. */
  CHUNK = 'chunk',
  /** A signal that a retry is about to happen. The UI should discard any partial
   * content from the attempt that just failed. */
  RETRY = 'retry',
}

export type StreamEvent =
  | { type: StreamEventType.CHUNK; value: GenerateContentResponse }
  | { type: StreamEventType.RETRY };

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
      // Cast is safe here because we've checked all items are objects with functionResponse
      parts.push(...(message as Part[]));
    } else {
      // Process mixed content
      for (const item of message) {
        if (typeof item === 'string') {
          parts.push({ text: item });
        } else if (Array.isArray(item)) {
          // Nested array case - flatten it
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

  return result;
}

/**
 * Normalizes tool interaction input to prevent tool call loops.
 *
 * When the UI flattens multiple tool call/response pairs into a single array
 * [call1, response1, call2, response2, ...], we need to restore the
 * alternating model/user turn structure so providers see `tool_use` blocks
 * immediately followed by their matching `tool_result`.
 *
 * @param message - Raw input from caller (string, Part, or Part[])
 * @returns Single Content or array of Content objects with correct roles
 */
function normalizeToolInteractionInput(
  message: PartListUnion,
): Content | Content[] {
  // Handle simple string input
  if (typeof message === 'string') {
    return createUserContent(message);
  }

  // Handle single Part (not an array)
  if (!Array.isArray(message)) {
    return createUserContentWithFunctionResponseFix(message);
  }

  // Now we have an array of parts - check if it contains tool interactions
  const parts = message as Part[];

  // Detect if this is a tool interaction sequence
  const hasFunctionCalls = parts.some(
    (part) => part && typeof part === 'object' && 'functionCall' in part,
  );
  const hasFunctionResponses = parts.some(
    (part) => part && typeof part === 'object' && 'functionResponse' in part,
  );

  // If no tool interactions, fall back to original behavior
  if (!hasFunctionCalls && !hasFunctionResponses) {
    return createUserContentWithFunctionResponseFix(message);
  }

  const result: Content[] = [];
  let pendingRole: 'user' | null = null;
  let pendingParts: Part[] = [];

  const flushPending = () => {
    if (pendingRole && pendingParts.length > 0) {
      result.push({ role: pendingRole, parts: pendingParts });
    }
    pendingRole = null;
    pendingParts = [];
  };

  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if ('functionCall' in part) {
      // Finish any accumulated user content before the next call
      flushPending();
      result.push({ role: 'model', parts: [part] });
      continue;
    }

    if ('functionResponse' in part) {
      if (pendingRole !== 'user') {
        flushPending();
        pendingRole = 'user';
      }
      pendingParts.push(part);
      continue;
    }

    // Any other parts (text, inline data, etc.) belong with the most recent
    // user-facing content.
    if (pendingRole !== 'user') {
      flushPending();
      pendingRole = 'user';
    }
    pendingParts.push(part);
  }

  flushPending();

  if (result.length === 0) {
    return createUserContentWithFunctionResponseFix(message);
  }

  if (result.length === 1) {
    return result[0];
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
  // A promise to represent any ongoing compression operation
  private compressionPromise: Promise<void> | null = null;
  private historyService: HistoryService;
  private logger = new DebugLogger('llxprt:gemini:chat');
  // Cache the compression threshold to avoid recalculating
  private cachedCompressionThreshold: number | null = null;

  constructor(
    private readonly config: Config,
    contentGenerator: ContentGenerator,
    private readonly generationConfig: GenerateContentConfig = {},
    initialHistory: Content[] = [],
    historyService?: HistoryService,
  ) {
    validateHistory(initialHistory);

    // Use provided HistoryService or create a new one
    this.historyService = historyService || new HistoryService();

    this.logger.debug('GeminiChat initialized:', {
      model: this.config.getModel(),
      initialHistoryLength: initialHistory.length,
      hasHistoryService: !!historyService,
    });

    // Convert and add initial history if provided
    if (initialHistory.length > 0) {
      const currentModel = this.config.getModel();
      this.logger.debug('Adding initial history to service:', {
        count: initialHistory.length,
      });
      const idGen = this.historyService.getIdGeneratorCallback();
      for (const content of initialHistory) {
        const matcher = this.makePositionMatcher();
        this.historyService.add(
          ContentConverters.toIContent(content, idGen, matcher),
          currentModel,
        );
      }
    }
  }

  /**
   * Create a position-based matcher for Gemini tool responses.
   * It returns the next unmatched tool call from the current history.
   */
  private makePositionMatcher():
    | (() => { historyId: string; toolName?: string })
    | undefined {
    const queue = this.historyService
      .findUnmatchedToolCalls()
      .map((b) => ({ historyId: b.id, toolName: b.name }));

    // Return undefined if there are no unmatched tool calls
    if (queue.length === 0) {
      return undefined;
    }

    // Return a function that always returns a valid value (never undefined)
    return () => {
      const result = queue.shift();
      // If queue is empty, return a fallback value
      return result || { historyId: '', toolName: undefined };
    };
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
        this.logger.warn(() => 'Flash fallback handler failed:', { error });
      }
    }

    return null;
  }

  setSystemInstruction(sysInstr: string) {
    this.generationConfig.systemInstruction = sysInstr;
  }

  /**
   * Get the underlying HistoryService instance
   * @returns The HistoryService managing conversation history
   */
  getHistoryService(): HistoryService {
    return this.historyService;
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

    // Check compression - first check if already compressing, then check if needed
    if (this.compressionPromise) {
      this.logger.debug('Waiting for ongoing compression to complete');
      await this.compressionPromise;
    } else if (this.shouldCompress()) {
      // Only check shouldCompress if not already compressing
      this.logger.debug('Triggering compression before message send');
      this.compressionPromise = this.performCompression(prompt_id);
      await this.compressionPromise;
      this.compressionPromise = null;
    }

    const userContent = normalizeToolInteractionInput(params.message);

    // DO NOT add user content to history yet - use send-then-commit pattern

    // Get the active provider
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    // Check if provider supports IContent interface
    if (!this.providerSupportsIContent(provider)) {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    // Get curated history WITHOUT the new user message
    const currentHistory = this.historyService.getCuratedForProvider();

    // Convert user content to IContent
    const idGen = this.historyService.getIdGeneratorCallback();
    const matcher = this.makePositionMatcher();

    // Handle both single Content and Content[] from normalizeToolInteractionInput
    const userIContents: IContent[] = Array.isArray(userContent)
      ? userContent.map((c) => ContentConverters.toIContent(c, idGen, matcher))
      : [ContentConverters.toIContent(userContent, idGen, matcher)];

    // Build request with history + new message(s)
    const iContents = [...currentHistory, ...userIContents];

    this._logApiRequest(
      ContentConverters.toGeminiContents(iContents),
      this.config.getModel(),
      prompt_id,
    );

    const startTime = Date.now();
    let response: GenerateContentResponse;

    try {
      const apiCall = async () => {
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

        // Get tools in the format the provider expects
        const tools = this.generationConfig.tools;

        // Critical debug for intermittent "Tool not present" errors
        if (tools && Array.isArray(tools)) {
          const totalFunctionDeclarations = tools.reduce((sum, group) => {
            // Check if it's a Tool (not CallableTool) and has functionDeclarations
            if (
              group &&
              'functionDeclarations' in group &&
              Array.isArray(group.functionDeclarations)
            ) {
              return sum + group.functionDeclarations.length;
            }
            return sum;
          }, 0);

          if (totalFunctionDeclarations === 0) {
            this.logger.warn(
              () =>
                `[geminiChat] WARNING: Tools array exists but has 0 function declarations!`,
              {
                tools,
                modelToUse,
                provider: provider.name,
              },
            );
          }
        }

        // Debug log what tools we're passing to the provider
        this.logger.debug(
          () =>
            `[GeminiChat] Passing tools to provider.generateChatCompletion:`,
          {
            hasTools: !!tools,
            toolsLength: tools?.length,
            toolsType: typeof tools,
            isArray: Array.isArray(tools),
            firstTool: tools?.[0],
            toolNames: Array.isArray(tools)
              ? tools.map((t: unknown) => {
                  const toolObj = t as {
                    functionDeclarations?: Array<{ name?: string }>;
                    name?: string;
                  };
                  return (
                    toolObj.functionDeclarations?.[0]?.name ||
                    toolObj.name ||
                    'unknown'
                  );
                })
              : 'not-an-array',
            providerName: provider.name,
          },
        );

        // Call the provider directly with IContent
        const streamResponse = provider.generateChatCompletion!(
          iContents,
          tools as
            | Array<{
                functionDeclarations: Array<{
                  name: string;
                  description?: string;
                  parametersJsonSchema?: unknown;
                }>;
              }>
            | undefined,
        );

        // Collect all chunks from the stream
        let lastResponse: IContent | undefined;
        for await (const iContent of streamResponse) {
          lastResponse = iContent;
        }

        if (!lastResponse) {
          throw new Error('No response from provider');
        }

        // Convert the final IContent to GenerateContentResponse
        return this.convertIContentToResponse(lastResponse);
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

        // Send-then-commit: Now that we have a successful response, add both user and model messages
        const currentModel = this.config.getModel();

        // Handle AFC history or regular history
        const fullAutomaticFunctionCallingHistory =
          response.automaticFunctionCallingHistory;

        if (
          fullAutomaticFunctionCallingHistory &&
          fullAutomaticFunctionCallingHistory.length > 0
        ) {
          // AFC case: Add the AFC history which includes the user input
          const curatedHistory = this.historyService.getCurated();
          const index =
            ContentConverters.toGeminiContents(curatedHistory).length;
          const automaticFunctionCallingHistory =
            fullAutomaticFunctionCallingHistory.slice(index) ?? [];

          for (const content of automaticFunctionCallingHistory) {
            const idGen = this.historyService.getIdGeneratorCallback();
            const matcher = this.makePositionMatcher();
            this.historyService.add(
              ContentConverters.toIContent(content, idGen, matcher),
              currentModel,
            );
          }
        } else {
          // Regular case: Add user content first
          const idGen = this.historyService.getIdGeneratorCallback();
          const matcher = this.makePositionMatcher();

          // Handle both single Content and Content[] from normalizeToolInteractionInput
          if (Array.isArray(userContent)) {
            for (const content of userContent) {
              this.historyService.add(
                ContentConverters.toIContent(content, idGen, matcher),
                currentModel,
              );
            }
          } else {
            this.historyService.add(
              ContentConverters.toIContent(userContent, idGen, matcher),
              currentModel,
            );
          }
        }

        // Add model response if we have one (but filter out pure thinking responses)
        if (outputContent) {
          // Check if this is pure thinking content that should be filtered
          if (!this.isThoughtContent(outputContent)) {
            // Not pure thinking, add it
            const idGen = this.historyService.getIdGeneratorCallback();
            this.historyService.add(
              ContentConverters.toIContent(outputContent, idGen),
              currentModel,
            );
          }
          // If it's pure thinking content, don't add it to history
        } else if (response.candidates && response.candidates.length > 0) {
          // We have candidates but no content - add empty model response
          // This handles the case where the model returns empty content
          if (
            !fullAutomaticFunctionCallingHistory ||
            fullAutomaticFunctionCallingHistory.length === 0
          ) {
            const emptyModelContent: Content = { role: 'model', parts: [] };
            const idGen = this.historyService.getIdGeneratorCallback();
            this.historyService.add(
              ContentConverters.toIContent(emptyModelContent, idGen),
              currentModel,
            );
          }
        }
        // If no candidates at all, don't add anything (error case)
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
  ): Promise<AsyncGenerator<StreamEvent>> {
    this.logger.debug(
      () => 'DEBUG [geminiChat]: ===== SEND MESSAGE STREAM START =====',
    );
    this.logger.debug(
      () => `DEBUG [geminiChat]: Model from config: ${this.config.getModel()}`,
    );
    this.logger.debug(
      () => `DEBUG [geminiChat]: Params: ${JSON.stringify(params, null, 2)}`,
    );
    this.logger.debug(
      () => `DEBUG [geminiChat]: Message type: ${typeof params.message}`,
    );
    this.logger.debug(
      () =>
        `DEBUG [geminiChat]: Message content: ${JSON.stringify(params.message, null, 2)}`,
    );
    this.logger.debug(() => 'DEBUG: GeminiChat.sendMessageStream called');
    this.logger.debug(
      () =>
        `DEBUG: GeminiChat.sendMessageStream params: ${JSON.stringify(params, null, 2)}`,
    );
    this.logger.debug(
      () =>
        `DEBUG: GeminiChat.sendMessageStream params.message type: ${typeof params.message}`,
    );
    this.logger.debug(
      () =>
        `DEBUG: GeminiChat.sendMessageStream params.message: ${JSON.stringify(params.message, null, 2)}`,
    );
    await this.sendPromise;

    // Check compression - first check if already compressing, then check if needed
    if (this.compressionPromise) {
      this.logger.debug('Waiting for ongoing compression to complete');
      await this.compressionPromise;
    } else if (this.shouldCompress()) {
      // Only check shouldCompress if not already compressing
      this.logger.debug('Triggering compression before message send in stream');
      this.compressionPromise = this.performCompression(prompt_id);
      await this.compressionPromise;
      this.compressionPromise = null;
    }

    // Normalize tool interaction input - handles flattened arrays from UI
    const userContent: Content | Content[] = normalizeToolInteractionInput(
      params.message,
    );

    // DO NOT add anything to history here - wait until after successful send!
    // Tool responses will be handled in recordHistory after the model responds

    let streamDoneResolver: () => void;
    const streamDonePromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });
    this.sendPromise = streamDonePromise;

    // DO NOT add user content to history yet - wait until successful send
    // This is the send-then-commit pattern to avoid orphaned tool calls

    return (async function* (instance) {
      try {
        let lastError: unknown = new Error('Request failed after all retries.');

        for (
          let attempt = 0;
          attempt <= INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;
          attempt++
        ) {
          try {
            if (attempt > 0) {
              yield { type: StreamEventType.RETRY };
            }

            const stream = await instance.makeApiCallAndProcessStream(
              params,
              prompt_id,
              userContent,
            );

            for await (const chunk of stream) {
              yield { type: StreamEventType.CHUNK, value: chunk };
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
          // With send-then-commit pattern, we don't add to history until success,
          // so there's nothing to remove on failure
          throw lastError;
        }
      } finally {
        streamDoneResolver!();
      }
    })(this);
  }

  private async makeApiCallAndProcessStream(
    _params: SendMessageParameters,
    _prompt_id: string,
    userContent: Content | Content[],
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // Get the active provider
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    // Check if provider supports IContent interface
    if (!this.providerSupportsIContent(provider)) {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    const apiCall = async () => {
      const modelToUse = this.config.getModel();
      const authType = this.config.getContentGeneratorConfig()?.authType;

      // Prevent Flash model calls immediately after quota error (only for Gemini providers)
      if (
        authType !== AuthType.USE_PROVIDER &&
        this.config.getQuotaErrorOccurred() &&
        modelToUse === DEFAULT_GEMINI_FLASH_MODEL
      ) {
        throw new Error(
          'Please submit a new query to continue with the Flash model.',
        );
      }

      // Convert user content to IContent first so we can check if it's a tool response
      const idGen = this.historyService.getIdGeneratorCallback();
      const matcher = this.makePositionMatcher();

      let requestContents: IContent[];
      if (Array.isArray(userContent)) {
        // This is a paired tool call/response - convert each separately
        const userIContents = userContent.map((content) =>
          ContentConverters.toIContent(content, idGen, matcher),
        );
        // Get curated history WITHOUT the new user message (since we haven't added it yet)
        const currentHistory = this.historyService.getCuratedForProvider();
        // Build request with history + new messages (but don't commit to history yet)
        requestContents = [...currentHistory, ...userIContents];
      } else {
        const userIContent = ContentConverters.toIContent(
          userContent,
          idGen,
          matcher,
        );
        // Get curated history WITHOUT the new user message (since we haven't added it yet)
        const currentHistory = this.historyService.getCuratedForProvider();
        // Build request with history + new message (but don't commit to history yet)
        requestContents = [...currentHistory, userIContent];
      }

      // DEBUG: Check for malformed entries
      this.logger.debug(
        () =>
          `[DEBUG] geminiChat IContent request (history + new message): ${JSON.stringify(requestContents, null, 2)}`,
      );

      // Get tools in the format the provider expects
      const tools = this.generationConfig.tools;

      // Call the provider directly with IContent
      const streamResponse = provider.generateChatCompletion!(
        requestContents,
        tools as
          | Array<{
              functionDeclarations: Array<{
                name: string;
                description?: string;
                parametersJsonSchema?: unknown;
              }>;
            }>
          | undefined,
      );

      // Convert the IContent stream to GenerateContentResponse stream
      return (async function* (instance) {
        for await (const iContent of streamResponse) {
          yield instance.convertIContentToResponse(iContent);
        }
      })(this);
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
    // Get history from HistoryService in IContent format
    const iContents = curated
      ? this.historyService.getCurated()
      : this.historyService.getAll();

    // Convert to Gemini Content format
    const contents = ContentConverters.toGeminiContents(iContents);

    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(contents);
  }

  /**
   * Clears the chat history.
   */
  clearHistory(): void {
    this.historyService.clear();
  }

  /**
   * Adds a new entry to the chat history.
   */
  addHistory(content: Content): void {
    this.historyService.add(
      ContentConverters.toIContent(content),
      this.config.getModel(),
    );
  }
  setHistory(history: Content[]): void {
    this.historyService.clear();
    const currentModel = this.config.getModel();
    for (const content of history) {
      this.historyService.add(
        ContentConverters.toIContent(content),
        currentModel,
      );
    }
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  /**
   * Check if compression is needed based on token count
   */
  private shouldCompress(): boolean {
    // Calculate compression threshold only if not cached
    if (this.cachedCompressionThreshold === null) {
      const threshold =
        (this.config.getEphemeralSetting('compression-threshold') as
          | number
          | undefined) ?? COMPRESSION_TOKEN_THRESHOLD;
      const contextLimit =
        (this.config.getEphemeralSetting('context-limit') as
          | number
          | undefined) ?? 60000; // Default context limit

      this.cachedCompressionThreshold = threshold * contextLimit;
      this.logger.debug('Calculated compression threshold:', {
        threshold,
        contextLimit,
        compressionThreshold: this.cachedCompressionThreshold,
      });
    }

    const currentTokens = this.historyService.getTotalTokens();
    const shouldCompress = currentTokens >= this.cachedCompressionThreshold;

    if (shouldCompress) {
      this.logger.debug('Compression needed:', {
        currentTokens,
        threshold: this.cachedCompressionThreshold,
      });
    }

    return shouldCompress;
  }

  /**
   * Perform compression of chat history
   * Made public to allow manual compression triggering
   */
  async performCompression(prompt_id: string): Promise<void> {
    this.logger.debug('Starting compression');
    // Reset cached threshold after compression in case settings changed
    this.cachedCompressionThreshold = null;

    // Lock history service
    this.historyService.startCompression();

    try {
      // Get compression split
      const { toCompress, toKeep } = this.getCompressionSplit();

      if (toCompress.length === 0) {
        this.logger.debug('Nothing to compress');
        return;
      }

      // Perform direct compression API call
      const summary = await this.directCompressionCall(toCompress, prompt_id);

      // Apply compression atomically
      this.applyCompression(summary, toKeep);

      this.logger.debug('Compression completed successfully');
    } catch (error) {
      this.logger.error('Compression failed:', error);
      throw error;
    } finally {
      // Always unlock
      this.historyService.endCompression();
    }
  }

  /**
   * Get the split point for compression
   */
  private getCompressionSplit(): {
    toCompress: IContent[];
    toKeep: IContent[];
  } {
    const curated = this.historyService.getCurated();

    // Calculate split point (keep last 30%)
    const preserveThreshold =
      (this.config.getEphemeralSetting('compression-preserve-threshold') as
        | number
        | undefined) ?? COMPRESSION_PRESERVE_THRESHOLD;
    let splitIndex = Math.floor(curated.length * (1 - preserveThreshold));

    // Adjust for tool call boundaries
    splitIndex = this.adjustForToolCallBoundary(curated, splitIndex);

    // Never compress if too few messages
    if (splitIndex < 4) {
      return { toCompress: [], toKeep: curated };
    }

    return {
      toCompress: curated.slice(0, splitIndex),
      toKeep: curated.slice(splitIndex),
    };
  }

  /**
   * Adjust compression boundary to not split tool call/response pairs
   */
  private adjustForToolCallBoundary(
    history: IContent[],
    index: number,
  ): number {
    // Don't split tool responses from their calls
    while (index < history.length && history[index].speaker === 'tool') {
      index++;
    }

    // Check if previous message has unmatched tool calls
    if (index > 0) {
      const prev = history[index - 1];
      if (prev.speaker === 'ai') {
        const toolCalls = prev.blocks.filter((b) => b.type === 'tool_call');
        if (toolCalls.length > 0) {
          // Check if there are matching tool responses in the kept portion
          const keptHistory = history.slice(index);
          const hasMatchingResponses = toolCalls.every((call) => {
            const toolCall = call as ToolCallBlock;
            return keptHistory.some(
              (msg) =>
                msg.speaker === 'tool' &&
                msg.blocks.some(
                  (b) =>
                    b.type === 'tool_response' &&
                    (b as ToolResponseBlock).callId === toolCall.id,
                ),
            );
          });

          if (!hasMatchingResponses) {
            // Include the AI message with unmatched calls in the compression
            return index - 1;
          }
        }
      }
    }

    return index;
  }

  /**
   * Direct API call for compression, bypassing normal message flow
   */
  private async directCompressionCall(
    historyToCompress: IContent[],
    _prompt_id: string,
  ): Promise<string> {
    const provider = this.getActiveProvider();
    if (!provider || !this.providerSupportsIContent(provider)) {
      throw new Error('Provider does not support compression');
    }

    // Build compression request with system prompt and user history
    const compressionRequest: IContent[] = [
      // Add system instruction as the first message
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: getCompressionPrompt(),
          },
        ],
      },
      // Add the history to compress
      ...historyToCompress,
      // Add the trigger instruction
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'First, reason in your scratchpad. Then, generate the <state_snapshot>.',
          },
        ],
      },
    ];

    // Direct provider call without tools for compression
    const stream = provider.generateChatCompletion!(
      compressionRequest,
      undefined, // no tools for compression
    );

    // Collect response
    let summary = '';
    for await (const chunk of stream) {
      if (chunk.blocks) {
        for (const block of chunk.blocks) {
          if (block.type === 'text') {
            summary += block.text;
          }
        }
      }
    }

    return summary;
  }

  /**
   * Apply compression results to history
   */
  private applyCompression(summary: string, toKeep: IContent[]): void {
    // Clear and rebuild history atomically
    this.historyService.clear();

    const currentModel = this.config.getModel();

    // Add compressed summary as user message
    this.historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: summary }],
      },
      currentModel,
    );

    // Add acknowledgment from AI
    this.historyService.add(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'Got it. Thanks for the additional context!',
          },
        ],
      },
      currentModel,
    );

    // Add back the kept messages
    for (const content of toKeep) {
      this.historyService.add(content, currentModel);
    }
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
    userInput: Content | Content[],
  ): AsyncGenerator<GenerateContentResponse> {
    const modelResponseParts: Part[] = [];
    let hasReceivedValidContent = false;
    let hasReceivedAnyChunk = false;
    let invalidChunkCount = 0;
    let totalChunkCount = 0;
    let streamingUsageMetadata: UsageStats | null = null;

    for await (const chunk of streamResponse) {
      hasReceivedAnyChunk = true;
      totalChunkCount++;

      // Capture usage metadata from IContent chunks (from providers that yield IContent)
      const chunkWithMetadata = chunk as { metadata?: { usage?: UsageStats } };
      if (chunkWithMetadata?.metadata?.usage) {
        streamingUsageMetadata = chunkWithMetadata.metadata.usage;
      }

      if (isValidResponse(chunk)) {
        const content = chunk.candidates?.[0]?.content;
        if (content) {
          // Check if this chunk has meaningful content (text or function calls)
          if (content.parts && content.parts.length > 0) {
            const hasMeaningfulContent = content.parts.some(
              (part) =>
                part.text ||
                'functionCall' in part ||
                'functionResponse' in part,
            );
            if (hasMeaningfulContent) {
              hasReceivedValidContent = true;
            }
          }

          // Filter out thought parts from being added to history.
          if (!this.isThoughtContent(content) && content.parts) {
            modelResponseParts.push(...content.parts);
          }
        }
      } else {
        invalidChunkCount++;
      }
      yield chunk; // Yield every chunk to the UI immediately.
    }

    // Now that the stream is finished, make a decision.
    // Only throw an error if:
    // 1. We received no chunks at all, OR
    // 2. We received chunks but NONE had valid content (all were invalid or empty)
    // This allows models like Qwen to send empty chunks at the end of a stream
    // as long as they sent valid content earlier.
    if (
      !hasReceivedAnyChunk ||
      (!hasReceivedValidContent && totalChunkCount > 0)
    ) {
      // Only throw if this looks like a genuinely empty/invalid stream
      // Not just a stream that ended with some invalid chunks
      if (
        invalidChunkCount === totalChunkCount ||
        modelResponseParts.length === 0
      ) {
        throw new EmptyStreamError(
          'Model stream was invalid or completed without valid content.',
        );
      }
    }

    // Use recordHistory to correctly save the conversation turn.
    const modelOutput: Content[] = [
      { role: 'model', parts: modelResponseParts },
    ];
    this.recordHistory(
      userInput,
      modelOutput,
      undefined,
      streamingUsageMetadata,
    );
  }

  private recordHistory(
    userInput: Content | Content[],
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
    usageMetadata?: UsageStats | null,
  ) {
    const newHistoryEntries: IContent[] = [];

    // Part 1: Handle the user's part of the turn.
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      const curatedAfc = extractCuratedHistory(automaticFunctionCallingHistory);
      for (const content of curatedAfc) {
        newHistoryEntries.push(ContentConverters.toIContent(content));
      }
    } else {
      // Handle both single Content and Content[] (for paired tool call/response)
      const idGen = this.historyService.getIdGeneratorCallback();
      const matcher = this.makePositionMatcher();

      if (Array.isArray(userInput)) {
        // This is a paired tool call/response from the executor
        // Add each part to history
        for (const content of userInput) {
          const userIContent = ContentConverters.toIContent(
            content,
            idGen,
            matcher,
          );
          newHistoryEntries.push(userIContent);
        }
      } else {
        // Normal user message
        const userIContent = ContentConverters.toIContent(
          userInput,
          idGen,
          matcher,
        );
        newHistoryEntries.push(userIContent);
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
      !Array.isArray(userInput) &&
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

    // Part 4: Add the new turn (user and model parts) to the history service.
    const currentModel = this.config.getModel();
    for (const entry of newHistoryEntries) {
      this.historyService.add(entry, currentModel);
    }
    for (const content of consolidatedOutputContents) {
      // Check if this contains tool calls
      const hasToolCalls = content.parts?.some(
        (part) => part && typeof part === 'object' && 'functionCall' in part,
      );

      if (!hasToolCalls) {
        // Only add non-tool-call responses to history immediately
        // Tool calls will be added when the executor returns with the response
        const iContent = ContentConverters.toIContent(content);

        // Add usage metadata if available from streaming
        if (usageMetadata) {
          iContent.metadata = {
            ...iContent.metadata,
            usage: usageMetadata,
          };
        }

        this.historyService.add(iContent, currentModel);
      }
      // Tool calls are NOT added here - they'll come back from the executor
      // along with their responses and be added together
    }
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
  //   private _trimPromptContents(
  //     contents: Content[],
  //     maxTokens: number,
  //   ): Content[] {
  //     if (contents.length === 0) return contents;
  //
  //     // Always keep the last message (current user input)
  //     const lastMessage = contents[contents.length - 1];
  //     const result: Content[] = [];
  //
  //     // Reserve tokens for the last message and warning
  //     const lastMessageTokens = estimateTokens(JSON.stringify(lastMessage));
  //     const warningTokens = 200; // Reserve for warning message
  //     let remainingTokens = maxTokens - lastMessageTokens - warningTokens;
  //
  //     if (remainingTokens <= 0) {
  //       // Even the last message is too big, truncate it
  //       return [this._truncateContent(lastMessage, maxTokens - warningTokens)];
  //     }
  //
  //     // Add messages from most recent to oldest, stopping when we hit the limit
  //     for (let i = contents.length - 2; i >= 0; i--) {
  //       const content = contents[i];
  //       const contentTokens = estimateTokens(JSON.stringify(content));
  //
  //       if (contentTokens <= remainingTokens) {
  //         result.unshift(content);
  //         remainingTokens -= contentTokens;
  //       } else if (remainingTokens > 100) {
  //         // Try to truncate this content to fit
  //         const truncated = this._truncateContent(content, remainingTokens);
  //         // Only add if we actually got some content back
  //         if (truncated.parts && truncated.parts.length > 0) {
  //           result.unshift(truncated);
  //         }
  //         break;
  //       } else {
  //         // No room left, stop
  //         break;
  //       }
  //     }
  //
  //     // Add the last message
  //     result.push(lastMessage);
  //
  //     return result;
  //   }
  //
  /**
   * Truncate a single content to fit within token limit
   */
  //   private _truncateContent(content: Content, maxTokens: number): Content {
  //     if (!content.parts || content.parts.length === 0) {
  //       return content;
  //     }
  //
  //     const truncatedParts: Part[] = [];
  //     let currentTokens = 0;
  //
  //     for (const part of content.parts) {
  //       if ('text' in part && part.text) {
  //         const partTokens = estimateTokens(part.text);
  //         if (currentTokens + partTokens <= maxTokens) {
  //           truncatedParts.push(part);
  //           currentTokens += partTokens;
  //         } else {
  //           // Truncate this part
  //           const remainingTokens = maxTokens - currentTokens;
  //           if (remainingTokens > 10) {
  //             const remainingChars = remainingTokens * 4;
  //             truncatedParts.push({
  //               text:
  //                 part.text.substring(0, remainingChars) +
  //                 '\n[...content truncated due to token limit...]',
  //             });
  //           }
  //           break;
  //         }
  //       } else {
  //         // Non-text parts (function calls, responses, etc) - NEVER truncate these
  //         // Either include them fully or skip them entirely to avoid breaking JSON
  //         const partTokens = estimateTokens(JSON.stringify(part));
  //         if (currentTokens + partTokens <= maxTokens) {
  //           truncatedParts.push(part);
  //           currentTokens += partTokens;
  //         } else {
  //           // Skip this part entirely - DO NOT truncate function calls/responses
  //           // Log what we're skipping for debugging
  //           if (process.env.DEBUG || process.env.VERBOSE) {
  //             let skipInfo = 'unknown part';
  //             if ('functionCall' in part) {
  //               const funcPart = part as { functionCall?: { name?: string } };
  //               skipInfo = `functionCall: ${funcPart.functionCall?.name || 'unnamed'}`;
  //             } else if ('functionResponse' in part) {
  //               const respPart = part as { functionResponse?: { name?: string } };
  //               skipInfo = `functionResponse: ${respPart.functionResponse?.name || 'unnamed'}`;
  //             }
  //             console.warn(
  //               `INFO: Skipping ${skipInfo} due to token limit (needs ${partTokens} tokens, only ${maxTokens - currentTokens} available)`,
  //             );
  //           }
  //           // Add a marker that content was omitted
  //           if (
  //             truncatedParts.length > 0 &&
  //             !truncatedParts.some(
  //               (p) =>
  //                 'text' in p &&
  //                 p.text?.includes(
  //                   '[...function calls omitted due to token limit...]',
  //                 ),
  //             )
  //           ) {
  //             truncatedParts.push({
  //               text: '[...function calls omitted due to token limit...]',
  //             });
  //           }
  //           break;
  //         }
  //       }
  //     }
  //
  //     return {
  //       role: content.role,
  //       parts: truncatedParts,
  //     };
  //   }

  private async maybeIncludeSchemaDepthContext(error: unknown): Promise<void> {
    // Check for potentially problematic cyclic tools with cyclic schemas
    // and include a recommendation to remove potentially problematic tools.
    if (isStructuredError(error) && isSchemaDepthError(error.message)) {
      const tools = this.config.getToolRegistry().getAllTools();
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

  /**
   * Convert PartListUnion (user input) to IContent format for provider/history
   */
  convertPartListUnionToIContent(input: PartListUnion): IContent {
    const blocks: ContentBlock[] = [];

    if (typeof input === 'string') {
      // Simple string input from user
      return {
        speaker: 'human',
        blocks: [{ type: 'text', text: input }],
      };
    }

    // Handle Part or Part[]
    const parts = Array.isArray(input) ? input : [input];

    // Check if all parts are function responses (tool responses)
    const allFunctionResponses = parts.every(
      (part) => part && typeof part === 'object' && 'functionResponse' in part,
    );

    if (allFunctionResponses) {
      // Tool responses - speaker is 'tool'
      for (const part of parts) {
        if (
          typeof part === 'object' &&
          'functionResponse' in part &&
          part.functionResponse
        ) {
          blocks.push({
            type: 'tool_response',
            callId: part.functionResponse.id || '',
            toolName: part.functionResponse.name || '',
            result:
              (part.functionResponse.response as Record<string, unknown>) || {},
            error: undefined,
          } as ToolResponseBlock);
        }
      }
      return {
        speaker: 'tool',
        blocks,
      };
    }

    // Mixed content or function calls - must be from AI
    let hasAIContent = false;

    for (const part of parts) {
      if (typeof part === 'string') {
        blocks.push({ type: 'text', text: part });
      } else if ('text' in part && part.text !== undefined) {
        blocks.push({ type: 'text', text: part.text });
      } else if ('functionCall' in part && part.functionCall) {
        hasAIContent = true; // Function calls only come from AI
        blocks.push({
          type: 'tool_call',
          id: part.functionCall.id || '',
          name: part.functionCall.name || '',
          parameters: (part.functionCall.args as Record<string, unknown>) || {},
        } as ToolCallBlock);
      } else if ('functionResponse' in part && part.functionResponse) {
        // Single function response in mixed content
        blocks.push({
          type: 'tool_response',
          callId: part.functionResponse.id || '',
          toolName: part.functionResponse.name || '',
          result:
            (part.functionResponse.response as Record<string, unknown>) || {},
          error: undefined,
        } as ToolResponseBlock);
      }
    }

    // If we have function calls, it's AI content; otherwise assume human
    return {
      speaker: hasAIContent ? 'ai' : 'human',
      blocks,
    };
  }

  /**
   * Convert IContent (from provider) to GenerateContentResponse for SDK compatibility
   */
  private convertIContentToResponse(input: IContent): GenerateContentResponse {
    // Convert IContent blocks to Gemini Parts
    const parts: Part[] = [];

    for (const block of input.blocks) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text });
          break;
        case 'tool_call': {
          const toolCall = block as ToolCallBlock;
          parts.push({
            functionCall: {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.parameters as Record<string, unknown>,
            },
          });
          break;
        }
        case 'tool_response': {
          const toolResponse = block as ToolResponseBlock;
          parts.push({
            functionResponse: {
              id: toolResponse.callId,
              name: toolResponse.toolName,
              response: toolResponse.result as Record<string, unknown>,
            },
          });
          break;
        }
        case 'thinking':
          // Include thinking blocks as thought parts
          parts.push({
            thought: true,
            text: block.thought,
          });
          break;
        default:
          // Skip unsupported block types
          break;
      }
    }

    // Build the response structure
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
        },
      ],
      // These are required properties that must be present
      get text() {
        return parts.find((p) => 'text' in p)?.text || '';
      },
      functionCalls: parts
        .filter((p) => 'functionCall' in p)
        .map((p) => p.functionCall!),
      executableCode: undefined,
      codeExecutionResult: undefined,
      // data property will be added below
    } as GenerateContentResponse;

    // Add data property that returns self-reference
    // Make it non-enumerable to avoid circular reference in JSON.stringify
    Object.defineProperty(response, 'data', {
      get() {
        return response;
      },
      enumerable: false, // Changed from true to false
      configurable: true,
    });

    // Add usage metadata if present
    if (input.metadata?.usage) {
      response.usageMetadata = {
        promptTokenCount: input.metadata.usage.promptTokens || 0,
        candidatesTokenCount: input.metadata.usage.completionTokens || 0,
        totalTokenCount: input.metadata.usage.totalTokens || 0,
      };
    }

    return response;
  }

  /**
   * Get the active provider from the ProviderManager via Config
   */
  private getActiveProvider(): IProvider | undefined {
    const providerManager = this.config.getProviderManager();
    if (!providerManager) {
      return undefined;
    }

    try {
      return providerManager.getActiveProvider();
    } catch {
      // No active provider set
      return undefined;
    }
  }

  /**
   * Check if a provider supports the IContent interface
   */
  private providerSupportsIContent(provider: IProvider | undefined): boolean {
    if (!provider) {
      return false;
    }

    // Check if the provider has the IContent method
    return (
      typeof (provider as { generateChatCompletion?: unknown })
        .generateChatCompletion === 'function'
    );
  }
}

/** Visible for Testing */
export function isSchemaDepthError(errorMessage: string): boolean {
  return errorMessage.includes('maximum schema depth exceeded');
}
