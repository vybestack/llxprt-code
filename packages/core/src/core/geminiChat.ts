/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// DISCLAIMER: This is a copied version of https://github.com/googleapis/js-genai/blob/main/src/chats.ts with the intention of working around a key bug
// where function responses are not treated as "valid" responses: https://b.corp.google.com/issues/420354090

import os from 'node:os';
import path from 'node:path';
import {
  GenerateContentResponse,
  type Content,
  type GenerateContentConfig,
  type SendMessageParameters,
  createUserContent,
  type Part,
  GenerateContentResponseUsageMetadata,
  type Tool,
  type PartListUnion,
  ApiError,
  FinishReason,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { flushRuntimeAuthScope } from '../auth/precedence.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import {
  extractThinkingBlocks,
  estimateThinkingTokens,
} from '../providers/reasoning/reasoningUtils.js';
import { type ContentGenerator } from './contentGenerator.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
  UsageStats,
} from '../services/history/IContent.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../providers/IProvider.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { hasCycleInSchema } from '../tools/tools.js';
import { isStructuredError } from '../utils/quotaErrorDetection.js';
import { DebugLogger } from '../debug/index.js';
import { estimateTokens as estimateTextTokens } from '../utils/toolOutputLimiter.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from './compression/compressionStrategyFactory.js';
import type { CompressionContext, DensityConfig } from './compression/types.js';
import { PromptResolver } from '../prompt-config/prompt-resolver.js';
import { tokenLimit } from './tokenLimits.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

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

type UsageMetadataWithCache = GenerateContentResponseUsageMetadata & {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/**
 * Aggregates text from content blocks while preserving spacing around non-text blocks.
 * When thinking blocks (or other non-text blocks) appear between text chunks, this ensures
 * proper spacing is maintained in the aggregated output.
 *
 * @param blocks - Array of content blocks to process
 * @param currentText - The current accumulated text
 * @param lastBlockWasNonText - Whether the previous block was a non-text block
 * @returns Object containing the aggregated text and the updated non-text flag
 */
export function aggregateTextWithSpacing(
  blocks: ContentBlock[],
  currentText: string,
  lastBlockWasNonText: boolean,
): { text: string; lastBlockWasNonText: boolean } {
  let aggregatedText = currentText;
  let wasNonText = lastBlockWasNonText;

  for (const block of blocks) {
    if (block.type === 'text') {
      if (wasNonText && aggregatedText.length > 0) {
        aggregatedText += ' ';
      }
      aggregatedText += block.text;
      wasNonText = false;
    } else {
      wasNonText = true;
    }
  }

  return { text: aggregatedText, lastBlockWasNonText: wasNonText };
}

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

type ThoughtPart = Part & {
  thought: true;
  text?: string;
  thoughtSignature?: string;
  llxprtSourceField?: ThinkingBlock['sourceField'];
};

function isThoughtPart(part: Part | undefined): part is ThoughtPart {
  return Boolean(
    part &&
      typeof part === 'object' &&
      'thought' in part &&
      part.thought === true,
  );
}

/**
 * Normalizes tool interaction input for the provider.
 *
 * Tool responses from coreToolScheduler include ONLY functionResponse parts
 * (functionCall parts are filtered out by useGeminiStream because they're
 * already in history from the original assistant turn).
 *
 * This function packages the responses as a user message for the provider.
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

  // Detect if this is a tool response sequence (functionResponse parts only)
  const hasFunctionResponses = parts.some(
    (part) => part && typeof part === 'object' && 'functionResponse' in part,
  );

  // If no function responses, fall back to original behavior
  if (!hasFunctionResponses) {
    return createUserContentWithFunctionResponseFix(message);
  }

  // Tool responses go in a user message
  return createUserContentWithFunctionResponseFix(parts);
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
  maxAttempts: 2, // 1 initial call + 1 retry
  initialDelayMs: 500,
};

/**
 * Checks if a part contains valid non-thought text content.
 * This helps in consolidating text parts properly during stream processing.
 */
export function isValidNonThoughtTextPart(part: Part): boolean {
  return (
    typeof part.text === 'string' &&
    !part.thought &&
    // Technically, the model should never generate parts that have text and
    // any of these but we don't trust them so check anyways.
    !part.functionCall &&
    !part.functionResponse &&
    !part.inlineData &&
    !part.fileData
  );
}

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
 * Custom error to signal that a stream completed with invalid content,
 * which should trigger a retry.
 */
export class InvalidStreamError extends Error {
  readonly type:
    | 'NO_FINISH_REASON'
    | 'NO_RESPONSE_TEXT'
    | 'NO_FINISH_REASON_NO_TEXT'
    | 'MALFORMED_FUNCTION_CALL';

  constructor(
    message: string,
    type:
      | 'NO_FINISH_REASON'
      | 'NO_RESPONSE_TEXT'
      | 'NO_FINISH_REASON_NO_TEXT'
      | 'MALFORMED_FUNCTION_CALL',
  ) {
    super(message);
    this.name = 'InvalidStreamError';
    this.type = type;
  }
}

/**
 * Legacy error class for backward compatibility.
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
  private static readonly TOKEN_SAFETY_MARGIN = 1000;
  private static readonly DEFAULT_COMPLETION_BUDGET = 65_536;
  // A promise to represent the current state of the message being sent to the
  // model.
  private sendPromise: Promise<void> = Promise.resolve();
  // A promise to represent any ongoing compression operation
  private compressionPromise: Promise<void> | null = null;
  private logger = new DebugLogger('llxprt:gemini:chat');
  private lastPromptTokenCount: number | null = null;

  /**
   * Optional callback that supplies formatted active todo items for compression.
   * Set by the owning client so the compression context can include todo awareness
   * without GeminiChat depending on the todo system directly.
   */
  private activeTodosProvider?: () => Promise<string | undefined>;

  /**
   * Density dirty flag — tracks whether new content has been added since last optimization.
   * @plan PLAN-20260211-HIGHDENSITY.P20
   * @requirement REQ-HD-002.6, REQ-HD-002.7
   */
  private densityDirty: boolean = true;

  /**
   * Suppresses densityDirty from being set during compression rebuilds.
   * @plan PLAN-20260211-HIGHDENSITY.P20
   * @requirement REQ-HD-002.6
   */
  private _suppressDensityDirty: boolean = false;
  private readonly generationConfig: GenerateContentConfig;

  /**
   * Runtime state for stateless operation (Phase 6)
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-001.2
   * @pseudocode agent-runtime-context.md lines 83-91 (step 006)
   */
  private readonly runtimeState: AgentRuntimeState;
  private readonly historyService: HistoryService;
  private readonly runtimeContext: AgentRuntimeContext;

  /**
   * Gets the last prompt token count.
   */
  getLastPromptTokenCount(): number {
    return this.lastPromptTokenCount ?? 0;
  }

  /**
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3
   * @pseudocode agent-runtime-context.md lines 83-91 (step 006.1-006.2)
   *
   * Phase 6 constructor: Accept AgentRuntimeContext as first parameter
   * Eliminates Config dependency by using runtime view adapters
   */
  constructor(
    view: AgentRuntimeContext,
    contentGenerator: ContentGenerator,
    generationConfig: GenerateContentConfig = {},
    initialHistory: Content[] = [],
  ) {
    if (!view) {
      throw new Error('AgentRuntimeContext is required for GeminiChat');
    }

    // Step 006.2: Extract runtime state and history from view
    this.runtimeContext = view;
    this.runtimeState = view.state;
    this.historyService = view.history;
    this.generationConfig = generationConfig;
    void contentGenerator;

    // @plan PLAN-20260211-HIGHDENSITY.P20
    // @requirement REQ-HD-002.6
    // Wrap historyService.add to set densityDirty on turn-loop content adds.
    // Compression rebuilds suppress this via _suppressDensityDirty.
    if (typeof this.historyService.add === 'function') {
      const originalAdd = this.historyService.add.bind(this.historyService);
      this.historyService.add = (...args: Parameters<typeof originalAdd>) => {
        const result = originalAdd(...args);
        if (!this._suppressDensityDirty) {
          this.densityDirty = true;
        }
        return result;
      };
    }

    validateHistory(initialHistory);

    const model = this.runtimeState.model;
    this.logger.debug('GeminiChat initialized:', {
      model,
      initialHistoryLength: initialHistory.length,
      hasHistoryService: !!this.historyService,
      hasRuntimeState: true,
    });

    if (initialHistory.length > 0) {
      for (const content of initialHistory) {
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        const matcher = this.makePositionMatcher();
        this.historyService.add(
          ContentConverters.toIContent(content, idGen, matcher, turnKey),
          model,
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

  private buildProviderRuntime(
    source: string,
    metadata: Record<string, unknown> = {},
  ): ProviderRuntimeContext {
    const baseRuntime = this.runtimeContext.providerRuntime;
    const runtimeId =
      baseRuntime.runtimeId ?? this.runtimeState.runtimeId ?? 'geminiChat';

    return {
      ...baseRuntime,
      runtimeId,
      metadata: {
        ...(baseRuntime.metadata ?? {}),
        source,
        ...metadata,
      },
    };
  }

  private extractDirectGeminiOverrides(config?: GenerateContentConfig):
    | {
        serverTools?: unknown;
        toolConfig?: GenerateContentConfig['toolConfig'];
      }
    | undefined {
    if (!config || typeof config !== 'object') {
      return undefined;
    }
    const overrides: {
      serverTools?: unknown;
      toolConfig?: GenerateContentConfig['toolConfig'];
    } = {};
    const rawConfig = config as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'serverTools')) {
      overrides.serverTools = rawConfig.serverTools;
    }
    if (config.toolConfig) {
      overrides.toolConfig = config.toolConfig;
    }

    if (
      typeof overrides.serverTools === 'undefined' &&
      typeof overrides.toolConfig === 'undefined'
    ) {
      return undefined;
    }
    return overrides;
  }

  /**
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-002.3
   * @pseudocode agent-runtime-context.md line 88 (step 006.5)
   */
  private async _logApiRequest(
    contents: Content[],
    model: string,
    promptId: string,
  ): Promise<void> {
    const requestText = this._getRequestTextFromContents(contents);
    // Step 006.5: Replace telemetry logging with view.telemetry adapter
    this.runtimeContext.telemetry.logApiRequest({
      model,
      promptId,
      requestText,
      sessionId: this.runtimeState.sessionId,
      runtimeId: this.runtimeState.runtimeId,
      provider: this.runtimeState.provider,
      timestamp: Date.now(),
    });
  }

  /**
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-002.3
   * @pseudocode agent-runtime-context.md line 88 (step 006.5)
   */
  private async _logApiResponse(
    durationMs: number,
    promptId: string,
    usageMetadata?: GenerateContentResponseUsageMetadata,
    responseText?: string,
  ): Promise<void> {
    // Step 006.5: Replace telemetry logging with view.telemetry adapter
    this.runtimeContext.telemetry.logApiResponse({
      model: this.runtimeState.model,
      promptId,
      durationMs,
      sessionId: this.runtimeState.sessionId,
      runtimeId: this.runtimeState.runtimeId,
      provider: this.runtimeState.provider,
      usageMetadata,
      responseText,
    });
  }

  /**
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-002.3
   * @pseudocode agent-runtime-context.md line 88 (step 006.5)
   */
  private _logApiError(
    durationMs: number,
    error: unknown,
    promptId: string,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : 'unknown';

    // Step 006.5: Replace telemetry logging with view.telemetry adapter
    this.runtimeContext.telemetry.logApiError({
      model: this.runtimeState.model,
      promptId,
      durationMs,
      error: errorMessage,
      errorType,
      sessionId: this.runtimeState.sessionId,
      runtimeId: this.runtimeState.runtimeId,
      provider: this.runtimeState.provider,
    });
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
   * Wait until any in-flight send/stream has completed and history has been committed.
   * This is used by provider switching to avoid capturing partial turns.
   */
  async waitForIdle(): Promise<void> {
    try {
      await this.sendPromise;
    } catch {
      // If a previous send failed, sendPromise can reject; callers that just need
      // a "best effort" flush should not fail provider switching.
    }
  }

  getToolsView(): ToolRegistryView {
    return this.runtimeContext.tools;
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

    // Reset lastPromptTokenCount at the start of each send call to avoid leaking
    // previous values across different API calls
    this.lastPromptTokenCount = null;

    const userContent = normalizeToolInteractionInput(params.message);

    const userIContents: IContent[] = Array.isArray(userContent)
      ? userContent.map((c) => {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          return ContentConverters.toIContent(c, idGen, matcher, turnKey);
        })
      : [
          (() => {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            const matcher = this.makePositionMatcher();
            return ContentConverters.toIContent(
              userContent,
              idGen,
              matcher,
              turnKey,
            );
          })(),
        ];

    const pendingTokens = await this.estimatePendingTokens(userIContents);
    await this.ensureCompressionBeforeSend(prompt_id, pendingTokens, 'send');

    // DO NOT add user content to history yet - use send-then-commit pattern

    const provider = this.resolveProviderForRuntime('sendMessage');

    const providerBaseUrl = this.resolveProviderBaseUrl(provider);

    // @plan PLAN-20251027-STATELESS5.P10
    // @requirement REQ-STAT5-004.1
    this.logger.debug(
      () => '[GeminiChat] Active provider snapshot before stream/send',
      {
        providerName: provider.name,
        providerDefaultModel: provider.getDefaultModel?.(),
        configModel: this.runtimeState.model,
        baseUrl: providerBaseUrl,
      },
    );

    // Enforce context window limits before proceeding
    await this.enforceContextWindow(pendingTokens, prompt_id, provider);

    // Check if provider supports IContent interface
    if (!this.providerSupportsIContent(provider)) {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    // Build a provider-safe request transcript that includes the new message(s)
    // without committing them to history yet.
    const strictToolAdjacency = provider.name.includes('anthropic');
    const iContents = this.historyService.getCuratedForProvider(userIContents, {
      strictToolAdjacency,
    });

    // @plan PLAN-20251027-STATELESS5.P10
    // @requirement REQ-STAT5-004.1
    this._logApiRequest(
      ContentConverters.toGeminiContents(iContents),
      this.runtimeState.model,
      prompt_id,
    );

    const startTime = Date.now();
    let response: GenerateContentResponse;

    try {
      const apiCall = async () => {
        // @plan PLAN-20251027-STATELESS5.P10
        // @requirement REQ-STAT5-004.1
        const modelToUse =
          this.runtimeState.model || DEFAULT_GEMINI_FLASH_MODEL;

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
        // @plan PLAN-20251027-STATELESS5.P10
        // @requirement REQ-STAT5-004.1
        this.logger.debug(
          () => '[GeminiChat] Calling provider.generateChatCompletion',
          {
            providerName: provider.name,
            model: this.runtimeState.model,
            toolCount: tools?.length ?? 0,
            baseUrl: this.resolveProviderBaseUrl(provider),
          },
        );
        const runtimeContext = this.buildProviderRuntime(
          'GeminiChat.trySendMessage',
          { toolCount: tools?.length ?? 0 },
        );

        const streamResponse = provider.generateChatCompletion!({
          contents: iContents,
          tools: tools as ProviderToolset | undefined,
          config: runtimeContext.config,
          runtime: runtimeContext,
          settings: runtimeContext.settingsService,
          metadata: runtimeContext.metadata,
          userMemory: runtimeContext.config?.getUserMemory?.(),
        });

        // Collect all chunks from the stream
        let lastResponse: IContent | undefined;
        for await (const iContent of streamResponse) {
          // Track prompt token count from provider usage metadata when available
          const promptTokens = iContent.metadata?.usage?.promptTokens;
          if (promptTokens !== undefined) {
            const cacheReads =
              iContent.metadata?.usage?.cache_read_input_tokens || 0;
            const cacheWrites =
              iContent.metadata?.usage?.cache_creation_input_tokens || 0;
            const combinedPromptTokens =
              promptTokens + cacheReads + cacheWrites;
            this.logger.debug(
              () =>
                `[GeminiChat] Tracking promptTokens from IContent (non-streaming): ${combinedPromptTokens}`,
            );
            this.lastPromptTokenCount = combinedPromptTokens;
          }

          lastResponse = iContent;
        }

        if (!lastResponse) {
          throw new Error('No response from provider');
        }

        // Convert the final IContent to GenerateContentResponse
        return this.convertIContentToResponse(lastResponse);
      };

      response = await retryWithBackoff(apiCall, {
        shouldRetryOnError: (error: unknown) => {
          // Check for known error messages and codes.
          if (error instanceof ApiError && error.message) {
            if (error.status === 400) return false;
            if (isSchemaDepthError(error.message)) return false;
            if (error.status === 429) return true;
            if (error.status >= 500 && error.status < 600) return true;
          }
          return false; // Don't retry other errors by default
        },
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
        // @plan PLAN-20251027-STATELESS5.P10
        // @requirement REQ-STAT5-004.1
        const currentModel = this.runtimeState.model;

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
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            const matcher = this.makePositionMatcher();
            this.historyService.add(
              ContentConverters.toIContent(content, idGen, matcher, turnKey),
              currentModel,
            );
          }
        } else {
          // Regular case: Add user content first
          // Handle both single Content and Content[] from normalizeToolInteractionInput
          if (Array.isArray(userContent)) {
            for (const content of userContent) {
              const turnKey = this.historyService.generateTurnKey();
              const idGen = this.historyService.getIdGeneratorCallback(turnKey);
              const matcher = this.makePositionMatcher();
              this.historyService.add(
                ContentConverters.toIContent(content, idGen, matcher, turnKey),
                currentModel,
              );
            }
          } else {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            const matcher = this.makePositionMatcher();
            this.historyService.add(
              ContentConverters.toIContent(
                userContent,
                idGen,
                matcher,
                turnKey,
              ),
              currentModel,
            );
          }
        }

        // Add model response if we have one (but filter out pure thinking responses)
        if (outputContent) {
          const includeThoughtsInHistory =
            this.runtimeContext.ephemerals.reasoning.includeInContext();

          const contentForHistory = includeThoughtsInHistory
            ? outputContent
            : {
                ...outputContent,
                parts: (outputContent.parts ?? []).filter(
                  (part) => !isThoughtPart(part),
                ),
              };

          if ((contentForHistory.parts?.length ?? 0) > 0) {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            this.historyService.add(
              ContentConverters.toIContent(
                contentForHistory,
                idGen,
                undefined,
                turnKey,
              ),
              currentModel,
            );
          }
          // If it's pure thinking content and includeInContext is false, don't add it to history
        } else if (response.candidates && response.candidates.length > 0) {
          // We have candidates but no content - add empty model response
          // This handles the case where the model returns empty content
          if (
            !fullAutomaticFunctionCallingHistory ||
            fullAutomaticFunctionCallingHistory.length === 0
          ) {
            const emptyModelContent: Content = { role: 'model', parts: [] };
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            this.historyService.add(
              ContentConverters.toIContent(
                emptyModelContent,
                idGen,
                undefined,
                turnKey,
              ),
              currentModel,
            );
          }
        }
        // If no candidates at all, don't add anything (error case)

        // Sync token counts AFTER recording history to replace estimated tokens with actual API counts
        await this.historyService.waitForTokenUpdates();
        const usageMetadata = response.usageMetadata as
          | UsageMetadataWithCache
          | undefined;
        if (usageMetadata?.promptTokenCount !== undefined) {
          const cacheReads = usageMetadata.cache_read_input_tokens || 0;
          const cacheWrites = usageMetadata.cache_creation_input_tokens || 0;
          const combinedTokenCount =
            usageMetadata.promptTokenCount + cacheReads + cacheWrites;
          if (combinedTokenCount > 0) {
            this.historyService.syncTotalTokens(combinedTokenCount);
            await this.historyService.waitForTokenUpdates();
          }
        } else {
          const usage = (
            response.data as { metadata?: { usage?: unknown } } | undefined
          )?.metadata?.usage as
            | {
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              }
            | undefined;
          const cacheReads = usage?.cache_read_input_tokens || 0;
          const cacheWrites = usage?.cache_creation_input_tokens || 0;
          const combinedTokenCount =
            (this.lastPromptTokenCount ?? 0) + cacheReads + cacheWrites;
          if (combinedTokenCount > 0) {
            this.historyService.syncTotalTokens(combinedTokenCount);
            await this.historyService.waitForTokenUpdates();
          }
        }
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
    // @plan PLAN-20251027-STATELESS5.P10
    // @requirement REQ-STAT5-004.1
    this.logger.debug(
      () => `DEBUG [geminiChat]: Model from config: ${this.runtimeState.model}`,
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

    // Reset lastPromptTokenCount at the start of each stream call to avoid leaking
    // previous values across different API calls
    this.lastPromptTokenCount = null;

    // Normalize tool interaction input - handles flattened arrays from UI
    const userContent: Content | Content[] = normalizeToolInteractionInput(
      params.message,
    );
    const userIContents: IContent[] = Array.isArray(userContent)
      ? userContent.map((content) => {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          return ContentConverters.toIContent(content, idGen, matcher, turnKey);
        })
      : [
          (() => {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            const matcher = this.makePositionMatcher();
            return ContentConverters.toIContent(
              userContent,
              idGen,
              matcher,
              turnKey,
            );
          })(),
        ];
    const pendingTokens = await this.estimatePendingTokens(userIContents);
    await this.ensureCompressionBeforeSend(prompt_id, pendingTokens, 'stream');

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
          attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;
          attempt++
        ) {
          try {
            if (attempt > 0) {
              yield { type: StreamEventType.RETRY };
            }

            // If this is a retry, adjust temperature to encourage different output.
            // Use temperature 1 as baseline (or the original temperature if it's higher than 1) and add increasing variation to avoid repetition.
            const currentParams = { ...params };
            if (attempt > 0) {
              // Use 1 as the baseline temperature for retries, or the original if it's higher
              const baselineTemperature = Math.max(
                params.config?.temperature ?? 1,
                1,
              );
              // Add increasing variation for each retry attempt to encourage different output
              const variation = attempt * 0.1;
              let newTemperature = baselineTemperature + variation;
              // Ensure temperature stays within valid range [0, 2] for Gemini models
              newTemperature = Math.min(Math.max(newTemperature, 0), 2);

              // Ensure config exists
              currentParams.config = currentParams.config || {};
              currentParams.config = {
                ...currentParams.config,
                temperature: newTemperature,
              };
            }

            const stream = await instance.makeApiCallAndProcessStream(
              currentParams, // Use the modified params with temperature
              prompt_id,
              pendingTokens,
              userContent,
            );

            for await (const chunk of stream) {
              yield { type: StreamEventType.CHUNK, value: chunk };
            }

            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const isContentError =
              error instanceof InvalidStreamError ||
              error instanceof EmptyStreamError;

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
          // so there's nothing to remove on failure. This is the approach upstream
          // moved to in e705f45c - we were already doing this correctly.
          throw lastError;
        }
      } finally {
        streamDoneResolver!();
      }
    })(this);
  }

  async generateDirectMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    const userContent = normalizeToolInteractionInput(params.message);
    const userIContents: IContent[] = Array.isArray(userContent)
      ? userContent.map((content) => {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          return ContentConverters.toIContent(content, idGen, matcher, turnKey);
        })
      : [
          (() => {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            const matcher = this.makePositionMatcher();
            return ContentConverters.toIContent(
              userContent,
              idGen,
              matcher,
              turnKey,
            );
          })(),
        ];

    const requestContents = ContentConverters.toGeminiContents(userIContents);
    // @plan PLAN-20251027-STATELESS5.P10
    // @requirement REQ-STAT5-004.1
    await this._logApiRequest(
      requestContents,
      this.runtimeState.model,
      prompt_id,
    );

    const startTime = Date.now();
    let aggregatedText = '';

    try {
      const response = await retryWithBackoff(
        async () => {
          const toolsFromConfig =
            params.config?.tools && Array.isArray(params.config.tools)
              ? (params.config.tools as Array<{
                  functionDeclarations: Array<{
                    name: string;
                    description?: string;
                    parametersJsonSchema?: unknown;
                  }>;
                }>)
              : undefined;
          const directOverrides = this.extractDirectGeminiOverrides(
            params.config as GenerateContentConfig | undefined,
          );

          const baseUrlForCall = this.resolveProviderBaseUrl(provider);

          // @plan PLAN-20251027-STATELESS5.P10
          // @requirement REQ-STAT5-004.1
          this.logger.debug(
            () =>
              '[GeminiChat] Calling provider.generateChatCompletion (non-stream retry path)',
            {
              providerName: provider.name,
              model: this.runtimeState.model,
              toolCount: toolsFromConfig?.length ?? 0,
              baseUrl: baseUrlForCall,
            },
          );

          const runtimeContext = this.buildProviderRuntime(
            'GeminiChat.streamGeneration',
            {
              toolCount: toolsFromConfig?.length ?? 0,
              ...(directOverrides
                ? { geminiDirectOverrides: directOverrides }
                : {}),
            },
          );

          const streamResponse = provider.generateChatCompletion({
            contents: userIContents,
            tools:
              toolsFromConfig && toolsFromConfig.length > 0
                ? (toolsFromConfig as ProviderToolset)
                : undefined,
            config: runtimeContext.config,
            runtime: runtimeContext,
            settings: runtimeContext.settingsService,
            metadata: runtimeContext.metadata,
            userMemory: runtimeContext.config?.getUserMemory?.(),
          });

          let lastResponse: IContent | undefined;
          let lastBlockWasNonText = false;
          for await (const iContent of streamResponse) {
            lastResponse = iContent;
            const result = aggregateTextWithSpacing(
              iContent.blocks ?? [],
              aggregatedText,
              lastBlockWasNonText,
            );
            aggregatedText = result.text;
            lastBlockWasNonText = result.lastBlockWasNonText;
          }

          if (!lastResponse) {
            throw new Error('No response from provider');
          }

          const directResponse = this.convertIContentToResponse(lastResponse);

          if (aggregatedText.trim()) {
            const candidate = directResponse.candidates?.[0];
            if (candidate) {
              const parts = candidate.content?.parts ?? [];
              const hasText = parts.some(
                (part) => 'text' in part && part.text?.trim(),
              );
              if (!hasText) {
                candidate.content = candidate.content || {
                  role: 'model',
                  parts: [],
                };
                candidate.content.parts = [
                  ...(candidate.content.parts || []),
                  { text: aggregatedText },
                ];
              }
            }
            Object.defineProperty(directResponse, 'text', {
              configurable: true,
              get() {
                return aggregatedText;
              },
            });
          }

          return directResponse;
        },
        {
          shouldRetryOnError: (error: unknown) => {
            if (error instanceof ApiError && error.message) {
              if (error.status === 400) return false;
              if (isSchemaDepthError(error.message)) return false;
              if (error.status === 429) return true;
              if (error.status >= 500 && error.status < 600) return true;
            }
            return false;
          },
        },
      );

      const durationMs = Date.now() - startTime;
      await this._logApiResponse(
        durationMs,
        prompt_id,
        response.usageMetadata,
        JSON.stringify(response),
      );

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      throw error;
    }
  }

  private async makeApiCallAndProcessStream(
    params: SendMessageParameters,
    promptId: string,
    pendingTokens: number,
    userContent: Content | Content[],
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const provider = this.resolveProviderForRuntime('stream');

    const providerBaseUrl = this.resolveProviderBaseUrl(provider);

    this.logger.debug(
      () => '[GeminiChat] Active provider snapshot before stream request',
      {
        providerName: provider.name,
        providerDefaultModel: provider.getDefaultModel?.(),
        configModel: this.runtimeState.model,
        baseUrl: providerBaseUrl,
      },
    );

    // Enforce context window limits before proceeding
    await this.enforceContextWindow(pendingTokens, promptId, provider);

    // Check if provider supports IContent interface
    if (!this.providerSupportsIContent(provider)) {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    const apiCall = async () => {
      // Convert user content to IContent first so we can check if it's a tool response
      let requestContents: IContent[];
      if (Array.isArray(userContent)) {
        // This is a paired tool call/response - convert each separately
        const userIContents = userContent.map((content) => {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          return ContentConverters.toIContent(content, idGen, matcher, turnKey);
        });
        // Build a provider-safe request transcript that includes the new message(s)
        // without committing them to history yet.
        const strictToolAdjacency = provider.name.includes('anthropic');
        requestContents = this.historyService.getCuratedForProvider(
          userIContents,
          {
            strictToolAdjacency,
          },
        );
      } else {
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        const matcher = this.makePositionMatcher();
        const userIContent = ContentConverters.toIContent(
          userContent,
          idGen,
          matcher,
          turnKey,
        );
        // Build a provider-safe request transcript that includes the new message
        // without committing it to history yet.
        const strictToolAdjacency = provider.name.includes('anthropic');
        requestContents = this.historyService.getCuratedForProvider(
          [userIContent],
          { strictToolAdjacency },
        );
      }

      // DEBUG: Check for malformed entries
      this.logger.debug(
        () =>
          `[DEBUG] geminiChat IContent request (history + new message): ${JSON.stringify(requestContents, null, 2)}`,
      );

      // Get tools in the format the provider expects
      const tools = this.generationConfig.tools;

      // Call the provider directly with IContent
      this.logger.debug(
        () =>
          '[GeminiChat] Calling provider.generateChatCompletion (generatorRequest)',
        {
          providerName: provider.name,
          model: this.runtimeState.model,
          historyLength: requestContents.length,
          toolCount: tools?.length ?? 0,
          baseUrl: providerBaseUrl,
        },
      );

      // Create a runtime context that incorporates the config from params
      const baseRuntimeContext = this.buildProviderRuntime(
        'GeminiChat.generateRequest',
        { historyLength: requestContents.length },
      );

      // If params has config, merge it with the runtime context config
      const runtimeContext = params.config
        ? {
            ...baseRuntimeContext,
            config: {
              ...baseRuntimeContext.config,
              ...params.config,
            },
          }
        : baseRuntimeContext;

      const streamResponse = provider.generateChatCompletion!({
        contents: requestContents,
        tools: tools as ProviderToolset | undefined,
        config: runtimeContext.config,
        runtime: runtimeContext,
        settings: runtimeContext.settingsService,
        metadata: runtimeContext.metadata,
        userMemory: baseRuntimeContext.config?.getUserMemory?.(),
      } as GenerateChatOptions);

      // Convert the IContent stream to GenerateContentResponse stream
      // Also track usage metadata from IContent format for token sync
      return (async function* (instance) {
        for await (const iContent of streamResponse) {
          // Track token counts from IContent metadata (Anthropic/OpenAI format)
          // before conversion to Gemini format
          // Include cached prompt tokens to reflect full context size
          const promptTokens = iContent.metadata?.usage?.promptTokens;
          if (promptTokens !== undefined) {
            const cacheReads =
              iContent.metadata?.usage?.cache_read_input_tokens || 0;
            const cacheWrites =
              iContent.metadata?.usage?.cache_creation_input_tokens || 0;
            const combinedPromptTokens =
              promptTokens + cacheReads + cacheWrites;
            instance.logger.debug(
              () =>
                `[GeminiChat] Tracking promptTokens from IContent: ${combinedPromptTokens}`,
            );
            instance.lastPromptTokenCount = combinedPromptTokens;
          }
          yield instance.convertIContentToResponse(iContent);
        }
      })(this);
    };

    // Bucket failover callback for 429 errors
    // @plan PLAN-20251213issue490 Bucket failover integration
    const onPersistent429Callback = async (): Promise<boolean | null> => {
      // Try to get the bucket failover handler from runtime context config
      const failoverHandler =
        this.runtimeContext.providerRuntime.config?.getBucketFailoverHandler();

      if (failoverHandler && failoverHandler.isEnabled()) {
        this.logger.debug(() => 'Attempting bucket failover on persistent 429');
        const success = await failoverHandler.tryFailover();
        if (success) {
          const runtimeId =
            this.runtimeContext.providerRuntime.runtimeId ??
            this.runtimeState.runtimeId;
          if (typeof runtimeId === 'string' && runtimeId.trim() !== '') {
            flushRuntimeAuthScope(runtimeId);
          }

          this.logger.debug(
            () =>
              `Bucket failover successful, new bucket: ${failoverHandler.getCurrentBucket()}`,
          );
          return true; // Signal retry with new bucket
        }
        this.logger.debug(
          () => 'Bucket failover failed - no more buckets available',
        );
        return false; // No more buckets, stop retrying
      }

      // No bucket failover configured
      return null;
    };

    const streamResponse = await retryWithBackoff(apiCall, {
      onPersistent429: onPersistent429Callback,
      signal: params.config?.abortSignal,
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
    const turnKey = this.historyService.generateTurnKey();
    this.historyService.add(
      ContentConverters.toIContent(content, undefined, undefined, turnKey),
      this.runtimeState.model,
    );
  }
  setHistory(history: Content[]): void {
    this.historyService.clear();
    const currentModel = this.runtimeState.model;
    for (const content of history) {
      const turnKey = this.historyService.generateTurnKey();
      this.historyService.add(
        ContentConverters.toIContent(content, undefined, undefined, turnKey),
        currentModel,
      );
    }
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  clearTools(): void {
    delete this.generationConfig.tools;
  }

  /**
   * Register a callback that provides formatted active todo items.
   * Called during compression to supply todo context to the summarizer.
   */
  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.activeTodosProvider = provider;
  }

  /**
   * Calculate effective token count based on reasoning settings.
   * This accounts for whether reasoning will be included in API calls.
   *
   * @plan PLAN-20251202-THINKING.P15
   * @requirement REQ-THINK-005.1, REQ-THINK-005.2
   */
  private getEffectiveTokenCount(): number {
    const includeInContext =
      this.runtimeContext.ephemerals.reasoning.includeInContext();
    const stripPolicy =
      this.runtimeContext.ephemerals.reasoning.stripFromContext();

    // If reasoning IS included in context, all tokens count
    if (includeInContext) {
      return this.historyService.getTotalTokens();
    }

    // If reasoning is NOT included, calculate actual reduction
    const allContents = this.historyService.getCurated();
    const rawTokens = this.historyService.getTotalTokens();

    let thinkingTokensToStrip = 0;

    if (stripPolicy === 'all') {
      // Sum up all thinking tokens
      for (const content of allContents) {
        const thinkingBlocks = extractThinkingBlocks(content);
        thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
      }
    } else if (stripPolicy === 'allButLast') {
      // Find last content with thinking blocks
      let lastIndexWithThinking = -1;
      for (let i = allContents.length - 1; i >= 0; i--) {
        if (extractThinkingBlocks(allContents[i]).length > 0) {
          lastIndexWithThinking = i;
          break;
        }
      }

      // Strip thinking from all except that last one
      for (let i = 0; i < allContents.length; i++) {
        if (i !== lastIndexWithThinking) {
          const thinkingBlocks = extractThinkingBlocks(allContents[i]);
          thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
        }
      }
    } else {
      // stripPolicy === 'none': but includeInContext=false means they won't be sent
      // Strip ALL thinking for effective count
      for (const content of allContents) {
        const thinkingBlocks = extractThinkingBlocks(content);
        thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
      }
    }

    return Math.max(0, rawTokens - thinkingTokensToStrip);
  }

  /**
   * Run density optimization if the active strategy supports it and new content exists.
   * Called before the threshold check in ensureCompressionBeforeSend and enforceContextWindow.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P20
   * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4, REQ-HD-002.5, REQ-HD-002.7, REQ-HD-002.9
   * @pseudocode orchestration.md lines 50-99
   */
  private async ensureDensityOptimized(): Promise<void> {
    // REQ-HD-002.3: Skip if no new content since last optimization
    if (!this.densityDirty) {
      return;
    }

    try {
      // Step 1: Resolve the active compression strategy
      const strategyName = parseCompressionStrategyName(
        this.runtimeContext.ephemerals.compressionStrategy(),
      );
      const strategy = getCompressionStrategy(strategyName);

      // REQ-HD-002.2: If strategy has no optimize method or trigger isn't continuous, skip
      if (!strategy.optimize || strategy.trigger?.mode !== 'continuous') {
        return;
      }

      // Step 2: Build DensityConfig from ephemerals
      const config: DensityConfig = {
        readWritePruning:
          this.runtimeContext.ephemerals.densityReadWritePruning(),
        fileDedupe: this.runtimeContext.ephemerals.densityFileDedupe(),
        recencyPruning: this.runtimeContext.ephemerals.densityRecencyPruning(),
        recencyRetention:
          this.runtimeContext.ephemerals.densityRecencyRetention(),
        workspaceRoot: process.cwd(),
      };

      // Step 3: Get raw history (REQ-HD-002.9)
      const history = this.historyService.getRawHistory();

      // Step 4: Run optimization
      const result = strategy.optimize(history, config);

      // REQ-HD-002.5: Short-circuit if no changes
      if (result.removals.length === 0 && result.replacements.size === 0) {
        this.logger.debug(
          () => '[GeminiChat] Density optimization produced no changes',
        );
        return;
      }

      // Step 5: Apply result (REQ-HD-002.4)
      this.logger.debug(() => '[GeminiChat] Applying density optimization', {
        removals: result.removals.length,
        replacements: result.replacements.size,
        metadata: result.metadata,
      });

      await this.historyService.applyDensityResult(result);
      await this.historyService.waitForTokenUpdates();
    } finally {
      // REQ-HD-002.7: Always clear dirty flag, even on error or no-op
      this.densityDirty = false;
    }
  }

  /**
   * Check if compression is needed based on token count.
   *
   * Token calculation includes system prompt in both paths:
   * 1. When lastPromptTokenCount (actual API data) is available - it already includes
   *    the system prompt as part of the request sent to the API
   * 2. When falling back to getEffectiveTokenCount() - it uses historyService.getTotalTokens()
   *    which adds baseTokenOffset (system prompt tokens) to history tokens
   *
   * NOTE: System prompt is NEVER compressed - it is static and critical. Only conversation
   * history is subject to compression via the configured compression strategy.
   *
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-002.2
   * @pseudocode agent-runtime-context.md line 86 (step 006.3)
   */
  private shouldCompress(pendingTokens: number = 0): boolean {
    // Step 006.3: Replace config.getEphemeralSetting with view.ephemerals
    // Calculate fresh each time to respect runtime setting changes
    const threshold = this.runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = this.runtimeContext.ephemerals.contextLimit();
    const compressionThreshold = threshold * contextLimit;

    this.logger.debug('Compression threshold:', {
      threshold,
      contextLimit,
      compressionThreshold,
    });

    // Use lastPromptTokenCount (actual API data) when available, else fall back to estimate
    const baseTokenCount =
      this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0
        ? this.lastPromptTokenCount
        : this.getEffectiveTokenCount();

    const currentTokens = baseTokenCount + Math.max(0, pendingTokens);
    const shouldCompress = currentTokens >= compressionThreshold;

    if (shouldCompress) {
      this.logger.debug('Compression needed:', {
        currentTokens,
        threshold: compressionThreshold,
        usingActualApiCount:
          this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0,
      });
    }

    return shouldCompress;
  }

  private async ensureCompressionBeforeSend(
    prompt_id: string,
    pendingTokens: number,
    source: 'send' | 'stream',
  ): Promise<void> {
    if (this.compressionPromise) {
      this.logger.debug('Waiting for ongoing compression to complete');
      try {
        await this.compressionPromise;
      } finally {
        this.compressionPromise = null;
      }
    }

    await this.historyService.waitForTokenUpdates();

    // @plan PLAN-20260211-HIGHDENSITY.P18
    // @requirement REQ-HD-002.1
    await this.ensureDensityOptimized();

    if (this.shouldCompress(pendingTokens)) {
      const triggerMessage =
        source === 'stream'
          ? 'Triggering compression before message send in stream'
          : 'Triggering compression before message send';
      this.logger.debug(triggerMessage, {
        pendingTokens,
        historyTokens: this.historyService.getTotalTokens(),
      });
      this.compressionPromise = this.performCompression(prompt_id);
      try {
        await this.compressionPromise;
      } finally {
        this.compressionPromise = null;
      }
    }
  }

  private async estimatePendingTokens(contents: IContent[]): Promise<number> {
    if (contents.length === 0) {
      return 0;
    }

    try {
      return await this.historyService.estimateTokensForContents(
        contents,
        this.runtimeState.model,
      );
    } catch (error) {
      this.logger.debug(
        'Failed to estimate pending tokens with tokenizer, using fallback',
        error,
      );
      let fallback = 0;
      for (const content of contents) {
        try {
          const serialized = JSON.stringify(content);
          fallback += estimateTextTokens(serialized);
        } catch (stringifyError) {
          this.logger.debug(
            'Failed to stringify content for fallback token estimate',
            stringifyError,
          );
          try {
            const blockStrings = content.blocks
              ?.map((block) => {
                switch (block.type) {
                  case 'text':
                    return block.text;
                  case 'tool_call':
                    return JSON.stringify({
                      name: block.name,
                      parameters: block.parameters,
                    });
                  case 'tool_response':
                    return JSON.stringify({
                      callId: block.callId,
                      toolName: block.toolName,
                      result: block.result,
                      error: block.error,
                    });
                  case 'thinking':
                    return block.thought;
                  case 'code':
                    return block.code;
                  case 'media':
                    return block.caption ?? '';
                  default:
                    return '';
                }
              })
              .join('\n');
            if (blockStrings) {
              fallback += estimateTextTokens(blockStrings);
            }
          } catch (blockError) {
            this.logger.debug(
              'Failed to estimate tokens from blocks',
              blockError,
            );
          }
        }
      }
      return fallback;
    }
  }

  private asNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private extractCompletionBudgetFromParams(
    params: Record<string, unknown> | undefined,
  ): number | undefined {
    if (!params) {
      return undefined;
    }

    const candidateKeys = [
      'maxOutputTokens',
      'maxTokens',
      'max_output_tokens',
      'max_tokens',
    ];

    for (const key of candidateKeys) {
      if (key in params) {
        const value = this.asNumber(params[key]);
        if (value !== undefined) {
          return value;
        }
      }
    }

    return undefined;
  }

  private getCompletionBudget(provider?: IProvider): number {
    // Check global ephemeral setting for maxOutputTokens (set via /set maxOutputTokens)
    // This is a generic setting that providers should translate to their native param
    const settingsService =
      this.runtimeContext.providerRuntime?.settingsService;
    const liveMaxOutputTokens = settingsService?.get('maxOutputTokens');
    const liveBudget = this.asNumber(liveMaxOutputTokens);
    if (liveBudget !== undefined && liveBudget > 0) {
      return liveBudget;
    }

    const generationBudget = this.asNumber(
      (this.generationConfig as { maxOutputTokens?: unknown }).maxOutputTokens,
    );

    const providerParams = provider?.getModelParams?.();
    const providerBudget = this.extractCompletionBudgetFromParams(
      providerParams as Record<string, unknown> | undefined,
    );

    return (
      generationBudget ?? providerBudget ?? GeminiChat.DEFAULT_COMPLETION_BUDGET
    );
  }

  private async enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    provider?: IProvider,
  ): Promise<void> {
    await this.historyService.waitForTokenUpdates();

    const completionBudget = Math.max(0, this.getCompletionBudget(provider));
    // Merged from main: Use user context limit from ephemerals
    const userContextLimit = this.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(this.runtimeState.model, userContextLimit);
    const marginAdjustedLimit = Math.max(
      0,
      limit - GeminiChat.TOKEN_SAFETY_MARGIN,
    );

    const projected =
      this.getEffectiveTokenCount() +
      Math.max(0, pendingTokens) +
      completionBudget;

    if (projected <= marginAdjustedLimit) {
      return;
    }

    this.logger.warn(
      () =>
        `[GeminiChat] Projected token usage exceeds context limit, attempting compression`,
      {
        projected,
        marginAdjustedLimit,
        completionBudget,
        pendingTokens,
      },
    );

    // @plan PLAN-20260211-HIGHDENSITY.P18
    // @requirement REQ-HD-002.8
    await this.ensureDensityOptimized();
    await this.historyService.waitForTokenUpdates();

    // Re-check after density optimization — may have freed enough space
    const postOptProjected =
      this.getEffectiveTokenCount() +
      Math.max(0, pendingTokens) +
      completionBudget;

    if (postOptProjected <= marginAdjustedLimit) {
      this.logger.debug(
        () => '[GeminiChat] Density optimization reduced tokens below limit',
        { postOptProjected, marginAdjustedLimit },
      );
      return;
    }

    await this.performCompression(promptId);
    await this.historyService.waitForTokenUpdates();

    const recomputed =
      this.getEffectiveTokenCount() +
      Math.max(0, pendingTokens) +
      completionBudget;

    if (recomputed <= marginAdjustedLimit) {
      this.logger.debug(
        () => '[GeminiChat] Compression reduced tokens below limit',
        {
          recomputed,
          marginAdjustedLimit,
        },
      );
      return;
    }

    throw new Error(
      `Request would exceed the ${limit} token context window even after compression (projected ${recomputed} tokens including system prompt and a ${completionBudget} token completion budget). Reduce earlier history or lower maxOutputTokens.`,
    );
  }

  /**
   * Perform compression of chat history.
   * Delegates to the configured compression strategy via the strategy pattern.
   *
   * @plan PLAN-20260211-COMPRESSION.P14
   * @requirement REQ-CS-006.1, REQ-CS-002.9
   */
  async performCompression(prompt_id: string): Promise<void> {
    this.logger.debug('Starting compression');
    this.historyService.startCompression();
    // @plan PLAN-20260211-HIGHDENSITY.P20
    // @requirement REQ-HD-002.6
    // Suppress densityDirty during compression rebuild (clear+add loop)
    this._suppressDensityDirty = true;
    try {
      const strategyName = parseCompressionStrategyName(
        this.runtimeContext.ephemerals.compressionStrategy(),
      );
      const strategy = getCompressionStrategy(strategyName);
      const context = await this.buildCompressionContext(prompt_id);
      const result = await strategy.compress(context);

      // Apply result: clear history, add each entry from newHistory
      this.historyService.clear();
      for (const content of result.newHistory) {
        this.historyService.add(content, this.runtimeState.model);
      }

      this.logger.debug('Compression completed', result.metadata);
    } catch (error) {
      this.logger.error('Compression failed:', error);
      throw error;
    } finally {
      this._suppressDensityDirty = false;
      this.historyService.endCompression();
    }

    await this.historyService.waitForTokenUpdates();
  }

  /**
   * Build the {@link CompressionContext} that strategies receive.
   * Keeps historyService out of the strategy boundary.
   *
   * @plan PLAN-20260211-COMPRESSION.P14
   * @requirement REQ-CS-001.6
   */
  private async buildCompressionContext(
    promptId: string,
  ): Promise<CompressionContext> {
    const promptResolver = new PromptResolver();
    const promptBaseDir = path.join(os.homedir(), '.llxprt', 'prompts');

    let activeTodos: string | undefined;
    if (this.activeTodosProvider) {
      try {
        activeTodos = await this.activeTodosProvider();
      } catch (error) {
        this.logger.debug(
          'Failed to fetch active todos for compression',
          error,
        );
      }
    }

    return {
      history: this.historyService.getCurated(),
      runtimeContext: this.runtimeContext,
      runtimeState: this.runtimeState,
      estimateTokens: (contents) =>
        this.historyService.estimateTokensForContents(contents as IContent[]),
      currentTokenCount: this.historyService.getTotalTokens(),
      logger: this.logger,
      resolveProvider: (profileName?) =>
        this.resolveProviderForRuntime(profileName ?? 'compression'),
      promptResolver,
      promptBaseDir,
      promptContext: {
        provider: this.runtimeState.provider,
        model: this.runtimeState.model,
      },
      promptId,
      ...(activeTodos ? { activeTodos } : {}),
    };
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
    let hasToolCall = false;
    let finishReason: FinishReason | undefined;
    let hasTextResponse = false;
    const allChunks: GenerateContentResponse[] = [];

    for await (const chunk of streamResponse) {
      // Capture the finishReason if present - we track the actual reason for MALFORMED_FUNCTION_CALL handling
      // Once we see a finishReason, it stays set
      // @plan PLAN-20251202-THINKING.P16
      const candidateWithReason = chunk?.candidates?.find(
        (candidate) => candidate.finishReason,
      );
      if (candidateWithReason) {
        finishReason = candidateWithReason.finishReason as FinishReason;
      }
      if (isValidResponse(chunk)) {
        const content = chunk.candidates?.[0]?.content;
        if (content?.parts) {
          if (content.parts.some((part) => part.functionCall)) {
            hasToolCall = true;
          }

          // Check if any part has text content (not just thoughts)
          if (
            content.parts.some(
              (part) =>
                part.text &&
                typeof part.text === 'string' &&
                part.text.trim() !== '',
            )
          ) {
            hasTextResponse = true;
          }

          const includeThoughtsInHistory =
            this.runtimeContext.ephemerals.reasoning.includeInContext();

          if (includeThoughtsInHistory) {
            modelResponseParts.push(...content.parts);
          } else {
            modelResponseParts.push(
              ...content.parts.filter((part) => !part.thought),
            );
          }
        }
      }

      // Record token usage if this chunk has usageMetadata
      // Prefer promptTokenCount to align history counts with context size
      if (chunk.usageMetadata) {
        // Use explicit check for undefined to allow 0 values
        if (chunk.usageMetadata.promptTokenCount !== undefined) {
          this.lastPromptTokenCount = chunk.usageMetadata.promptTokenCount;
        }
      }

      allChunks.push(chunk);
      yield chunk; // Yield every chunk to the UI immediately.
    }

    // String thoughts and consolidate text parts.
    const consolidatedParts: Part[] = [];
    for (const part of modelResponseParts) {
      const lastPart = consolidatedParts[consolidatedParts.length - 1];
      if (
        lastPart?.text &&
        isValidNonThoughtTextPart(lastPart) &&
        isValidNonThoughtTextPart(part)
      ) {
        lastPart.text += part.text;
      } else {
        consolidatedParts.push(part);
      }
    }

    const responseText = consolidatedParts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join('')
      .trim();

    const isToolContinuationInput = Array.isArray(userInput)
      ? userInput.some(isFunctionResponse)
      : isFunctionResponse(userInput);

    // Enhanced stream validation logic: A stream is considered successful if:
    // 1. There's a tool call (tool calls can end without explicit finish reasons), OR
    // 2. There's a finish reason AND we have non-empty response text, OR
    // 3. We detected text content during streaming (hasTextResponse = true)
    //
    // We throw an error only when there's no tool call AND we're not in a
    // tool-result continuation AND:
    // - No finish reason AND no text response during streaming, OR
    // - Empty response text after consolidation (e.g., only thoughts with no actual content)
    // - MALFORMED_FUNCTION_CALL finish reason (should trigger retry)
    if (
      !hasToolCall &&
      !isToolContinuationInput &&
      ((!finishReason && !hasTextResponse) || !responseText)
    ) {
      if (!finishReason && !hasTextResponse) {
        throw new InvalidStreamError(
          'Model stream ended without a finish reason and no text response.',
          'NO_FINISH_REASON_NO_TEXT',
        );
      } else {
        throw new InvalidStreamError(
          'Model stream ended with empty response text.',
          'NO_RESPONSE_TEXT',
        );
      }
    }

    // Handle MALFORMED_FUNCTION_CALL finish reason - should trigger retry
    if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
      throw new InvalidStreamError(
        'Model stream ended with malformed function call.',
        'MALFORMED_FUNCTION_CALL',
      );
    }

    // Use recordHistory to correctly save the conversation turn.
    const modelOutput: Content[] = [
      { role: 'model', parts: consolidatedParts },
    ];

    // Capture usage metadata from the stream
    let streamingUsageMetadata: UsageStats | null = null;
    let actualPromptTokens: number | null = null;
    // Find the last chunk that has usage metadata (similar to getLastChunkWithMetadata logic)
    const lastChunkWithMetadata = allChunks
      .slice()
      .reverse()
      .find((chunk) => chunk.usageMetadata);
    if (lastChunkWithMetadata && lastChunkWithMetadata.usageMetadata) {
      streamingUsageMetadata = {
        promptTokens: lastChunkWithMetadata.usageMetadata.promptTokenCount || 0,
        completionTokens:
          lastChunkWithMetadata.usageMetadata.candidatesTokenCount || 0,
        totalTokens: lastChunkWithMetadata.usageMetadata.totalTokenCount || 0,
      };
      const usageMetadata =
        lastChunkWithMetadata.usageMetadata as UsageMetadataWithCache;
      const cacheReads = usageMetadata.cache_read_input_tokens || 0;
      const cacheWrites = usageMetadata.cache_creation_input_tokens || 0;
      actualPromptTokens =
        streamingUsageMetadata.promptTokens + cacheReads + cacheWrites;
    }

    // Record history first (adds estimated tokens)
    this.recordHistory(
      userInput,
      modelOutput,
      undefined,
      streamingUsageMetadata,
    );

    // Ensure token estimation updates are complete before syncing to actual API prompt tokens.
    await this.historyService.waitForTokenUpdates();

    // Sync token counts AFTER recording history to replace estimated tokens with actual API prompt tokens
    // Use explicit check for undefined to allow 0 values
    if (actualPromptTokens !== null && actualPromptTokens !== undefined) {
      if (actualPromptTokens > 0) {
        this.logger.debug(
          () =>
            `[GeminiChat] Syncing prompt token count to HistoryService: ${actualPromptTokens}`,
        );
        this.historyService.syncTotalTokens(actualPromptTokens);
        await this.historyService.waitForTokenUpdates();
      }
    } else if (this.lastPromptTokenCount !== null) {
      if (this.lastPromptTokenCount > 0) {
        this.logger.debug(
          () =>
            `[GeminiChat] Syncing prompt token count to HistoryService: ${this.lastPromptTokenCount}`,
        );
        this.historyService.syncTotalTokens(this.lastPromptTokenCount);
        await this.historyService.waitForTokenUpdates();
      }
    } else {
      this.logger.debug(
        () =>
          `[GeminiChat] No token count to sync (lastPromptTokenCount: ${this.lastPromptTokenCount})`,
      );
    }
  }

  /**
   * Records completed tool calls with full metadata.
   * This is called by external components when tool calls complete, before sending responses to Gemini.
   * NOTE: llxprt does not use ChatRecordingService, so this is a no-op stub for compatibility.
   */
  recordCompletedToolCalls(
    _model: string,
    _toolCalls: CompletedToolCall[],
  ): void {
    // No-op: llxprt does not record chat sessions like gemini-cli
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
        const turnKey = this.historyService.generateTurnKey();
        newHistoryEntries.push(
          ContentConverters.toIContent(content, undefined, undefined, turnKey),
        );
      }
    } else {
      // Handle both single Content and Content[] (for paired tool call/response)
      if (Array.isArray(userInput)) {
        // This is a paired tool call/response from the executor
        // Add each part to history
        for (const content of userInput) {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          const matcher = this.makePositionMatcher();
          const userIContent = ContentConverters.toIContent(
            content,
            idGen,
            matcher,
            turnKey,
          );
          newHistoryEntries.push(userIContent);
        }
      } else {
        // Normal user message
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        const matcher = this.makePositionMatcher();
        const userIContent = ContentConverters.toIContent(
          userInput,
          idGen,
          matcher,
          turnKey,
        );
        newHistoryEntries.push(userIContent);
      }
    }

    // Part 2: Handle the model's part of the turn, filtering out thoughts.
    const includeThoughtsInHistory =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    const nonThoughtModelOutput = modelOutput
      .map((content) => ({
        ...content,
        parts: (content.parts ?? []).filter((part) => !isThoughtPart(part)),
      }))
      .filter((content) => (content.parts?.length ?? 0) > 0);

    const thoughtBlocks: ThinkingBlock[] = includeThoughtsInHistory
      ? modelOutput
          .flatMap((content) => content.parts ?? [])
          .filter(isThoughtPart)
          .map(
            (part): ThinkingBlock => ({
              type: 'thinking',
              thought: (part.text ?? '').trim(),
              sourceField: part.llxprtSourceField ?? 'thought',
              signature: part.thoughtSignature,
            }),
          )
          .filter((block) => block.thought.length > 0)
      : [];

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

    if (outputContents.length === 0 && thoughtBlocks.length > 0) {
      outputContents = [{ role: 'model', parts: [] } as Content];
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
    const currentModel = this.runtimeState.model;
    for (const entry of newHistoryEntries) {
      this.historyService.add(entry, currentModel);
    }

    let didAttachThoughtBlocks = false;
    for (const content of consolidatedOutputContents) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent = ContentConverters.toIContent(
        content,
        undefined,
        undefined,
        turnKey,
      );

      if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
        iContent.blocks = [...thoughtBlocks, ...iContent.blocks];
        didAttachThoughtBlocks = true;
      }

      // Add usage metadata if available from streaming
      if (usageMetadata) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }

      this.historyService.add(iContent, currentModel);
    }

    if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
      const turnKey = this.historyService.generateTurnKey();
      const iContent: IContent = {
        speaker: 'ai',
        blocks: thoughtBlocks,
        metadata: { turnId: turnKey },
      };
      if (usageMetadata) {
        iContent.metadata = {
          ...iContent.metadata,
          usage: usageMetadata,
        };
      }
      this.historyService.add(iContent, currentModel);
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

  private async maybeIncludeSchemaDepthContext(error: unknown): Promise<void> {
    // Check for potentially problematic cyclic tools with cyclic schemas
    // and include a recommendation to remove potentially problematic tools.
    // @plan PLAN-20251028-STATELESS6.P10
    // @requirement REQ-STAT6-001.2
    // @pseudocode agent-runtime-context.md line 89 (step 006.6)
    if (isStructuredError(error) && isSchemaDepthError(error.message)) {
      // Step 006.6: Replace tool registry access with view.tools
      // Note: ToolRegistryView provides read-only access; getAllTools() not available
      // For diagnostic purposes, we can list tool names
      const toolNames = this.runtimeContext.tools.listToolNames();
      const cyclicSchemaTools: string[] = [];

      // Check each tool's metadata for cyclic schemas
      for (const toolName of toolNames) {
        const metadata = this.runtimeContext.tools.getToolMetadata(toolName);
        if (metadata?.parameterSchema) {
          if (hasCycleInSchema(metadata.parameterSchema)) {
            cyclicSchemaTools.push(toolName);
          }
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

    // Mixed content or function calls - could be from AI or tool
    let hasAIContent = false;
    let hasToolContent = false;

    for (const part of parts) {
      if (typeof part === 'string') {
        blocks.push({ type: 'text', text: part });
      } else if (isThoughtPart(part)) {
        const thinkingBlock: ThinkingBlock = {
          type: 'thinking',
          thought: part.text ?? '',
          isHidden: true,
          sourceField: part.llxprtSourceField ?? 'thought',
        };
        if (part.thoughtSignature) {
          thinkingBlock.signature = part.thoughtSignature;
        }
        blocks.push(thinkingBlock);
        hasAIContent = true;
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
        hasToolContent = true; // Tool responses come from tools
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

    // Determine speaker based on content type
    // Tool responses take precedence (tool responses with text are still tool messages)
    // Function calls are AI messages
    // Pure text defaults to human
    return {
      speaker: hasToolContent ? 'tool' : hasAIContent ? 'ai' : 'human',
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
        case 'thinking': {
          const thinkingBlock = block as ThinkingBlock;
          // Include thinking blocks as thought parts
          const thoughtPart: ThoughtPart = {
            thought: true,
            text: thinkingBlock.thought,
          };
          if (thinkingBlock.signature) {
            thoughtPart.thoughtSignature = thinkingBlock.signature;
          }
          if (thinkingBlock.sourceField) {
            thoughtPart.llxprtSourceField = thinkingBlock.sourceField;
          }
          parts.push(thoughtPart);
          break;
        }
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
      const usageMetadata: UsageMetadataWithCache = {
        promptTokenCount: input.metadata.usage.promptTokens || 0,
        candidatesTokenCount: input.metadata.usage.completionTokens || 0,
        totalTokenCount: input.metadata.usage.totalTokens || 0,
        cache_read_input_tokens:
          input.metadata.usage.cache_read_input_tokens || 0,
        cache_creation_input_tokens:
          input.metadata.usage.cache_creation_input_tokens || 0,
      };
      response.usageMetadata = usageMetadata;
    }

    return response;
  }

  /**
   * Get the active provider from the ProviderManager via Config
   */
  private getActiveProvider(): IProvider | undefined {
    // @plan PLAN-20251028-STATELESS6.P10
    // @requirement REQ-STAT6-002.2
    // @pseudocode agent-runtime-context.md line 87 (step 006.4)
    // Step 006.4: Replace providerManager access with view.provider adapter
    try {
      return this.runtimeContext.provider.getActiveProvider();
    } catch {
      // No active provider set or read-only context
      return undefined;
    }
  }

  private resolveProviderForRuntime(contextLabel: string): IProvider {
    // @plan PLAN-20251028-STATELESS6.P10
    // @requirement REQ-STAT6-002.2
    // @pseudocode agent-runtime-context.md line 87 (step 006.4)
    const desiredProviderName = this.runtimeState.provider?.trim();
    const adapter = this.runtimeContext.provider;

    if (desiredProviderName) {
      try {
        const candidate =
          typeof adapter.getProviderByName === 'function'
            ? adapter.getProviderByName(desiredProviderName)
            : undefined;
        if (candidate) {
          const active = this.getActiveProvider();
          if (active && active.name !== desiredProviderName) {
            this.logger.debug(
              () =>
                `[GeminiChat] selected provider '${desiredProviderName}' via getProviderByName (active remains '${active.name}') [${contextLabel}]`,
            );
          }
          return candidate;
        }
      } catch (error) {
        this.logger.debug(
          () =>
            `[GeminiChat] provider lookup skipped (${contextLabel}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    if (desiredProviderName && provider.name !== desiredProviderName) {
      const previousProviderName = provider.name;
      try {
        adapter.setActiveProvider(desiredProviderName);
        const updatedProvider = adapter.getActiveProvider();
        if (updatedProvider) {
          provider = updatedProvider;
        }
        this.logger.debug(
          () =>
            `[GeminiChat] enforced provider switch to '${desiredProviderName}' (previous '${previousProviderName}') [${contextLabel}]`,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `[GeminiChat] provider switch skipped (${contextLabel}, read-only context): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return provider;
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

  private resolveProviderBaseUrl(_provider: IProvider): string | undefined {
    // REQ-SP4-004: ONLY read baseURL from runtime state, NEVER from provider instance.
    // This ensures each agent/subagent can have its own baseURL even when using
    // the same provider (e.g., main uses OpenRouter, subagent uses Cerebras, both via openai).
    //
    // If runtime state has baseURL → use it
    // If runtime state has no baseURL → return undefined (provider uses default endpoint)
    // NEVER read from provider instance - that violates stateless pattern and causes bugs
    return this.runtimeState.baseUrl;
  }
}

/** Visible for Testing */
export function isSchemaDepthError(errorMessage: string): boolean {
  return errorMessage.includes('maximum schema depth exceeded');
}
