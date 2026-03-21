/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * StreamProcessor - Handles API stream requests and response processing.
 * Extracted from geminiChat.ts Phase 05.
 * These are the core streaming methods that make API calls and process responses.
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Content,
  type SendMessageParameters,
  type Part,
  FinishReason,
  type GenerateContentConfig,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { flushRuntimeAuthScope } from '../auth/precedence.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import type { IContent, UsageStats } from '../services/history/IContent.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../providers/IProvider.js';
import { DebugLogger } from '../debug/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from './compression/CompressionHandler.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import {
  isValidResponse,
  isValidNonThoughtTextPart,
  convertIContentToResponse,
} from './MessageConverter.js';
import {
  InvalidStreamError,
  isSchemaDepthError,
  isThoughtPart,
  type UsageMetadataWithCache,
} from './geminiChatTypes.js';
import { hasCycleInSchema } from '../tools/tools.js';
import { isStructuredError } from '../utils/quotaErrorDetection.js';

/**
 * StreamProcessor handles making API calls and processing streaming responses.
 * Extracted from GeminiChat to isolate streaming concerns.
 */
export class StreamProcessor {
  private logger = new DebugLogger('llxprt:gemini:stream-processor');

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly conversationManager: ConversationManager,
    private readonly compressionHandler: CompressionHandler,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRuntimeContext,
    private readonly historyService: HistoryService,
    private readonly generationConfig: GenerateContentConfig,
  ) {}

  /**
   * Makes an API call with retry and returns a stream processor.
   * This is the outer method that resolves the provider, enforces context window,
   * makes the API call with retry, and returns processStreamResponse.
   */
  async makeApiCallAndProcessStream(
    params: SendMessageParameters,
    promptId: string,
    pendingTokens: number,
    userContent: Content | Content[],
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const provider = this.providerResolver('stream');

    const providerBaseUrl = this.runtimeContext.state.baseUrl;

    this.logger.debug(
      () => '[StreamProcessor] Active provider snapshot before stream request',
      {
        providerName: provider.name,
        providerDefaultModel: provider.getDefaultModel?.(),
        configModel: this.runtimeContext.state.model,
        baseUrl: providerBaseUrl,
      },
    );

    // Enforce context window limits before proceeding
    await this.compressionHandler.enforceContextWindow(
      pendingTokens,
      promptId,
      provider,
    );

    // Check if provider supports IContent interface
    if (typeof provider.generateChatCompletion !== 'function') {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    const streamResponse = await this._executeStreamApiCall(
      params,
      userContent,
      provider,
    );

    return this.processStreamResponse(streamResponse, userContent);
  }

  /**
   * Execute the stream API call with retry and bucket failover.
   * Split from makeApiCallAndProcessStream to keep methods under 80 lines.
   */
  private async _executeStreamApiCall(
    params: SendMessageParameters,
    userContent: Content | Content[],
    provider: IProvider,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const apiCall = () =>
      this._buildAndSendStreamRequest(params, userContent, provider);

    return retryWithBackoff(apiCall, {
      onPersistent429: () => this._handleBucketFailover(),
      signal: params.config?.abortSignal,
    });
  }

  private async _buildAndSendStreamRequest(
    params: SendMessageParameters,
    userContent: Content | Content[],
    provider: IProvider,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const requestContents = this._buildRequestContents(userContent);

    const tools = this.generationConfig.tools;
    this.logger.debug(
      () => '[StreamProcessor] Calling provider.generateChatCompletion',
      {
        providerName: provider.name,
        model: this.runtimeContext.state.model,
        historyLength: requestContents.length,
        toolCount: tools?.length ?? 0,
        baseUrl: this.runtimeContext.state.baseUrl,
      },
    );

    const baseRuntimeContext = this.providerRuntimeBuilder(
      'StreamProcessor.generateRequest',
      { historyLength: requestContents.length },
    );
    const runtimeContext = params.config
      ? {
          ...baseRuntimeContext,
          config: { ...baseRuntimeContext.config, ...params.config },
        }
      : baseRuntimeContext;

    const streamResponse = provider.generateChatCompletion({
      contents: requestContents,
      tools: tools as ProviderToolset | undefined,
      config: runtimeContext.config,
      runtime: runtimeContext,
      settings: runtimeContext.settingsService,
      metadata: runtimeContext.metadata,
      userMemory: baseRuntimeContext.config?.getUserMemory?.(),
    } as GenerateChatOptions);

    return this._convertIContentStream(streamResponse);
  }

  private _buildRequestContents(userContent: Content | Content[]): IContent[] {
    const matcher = this.conversationManager.makePositionMatcher();
    if (Array.isArray(userContent)) {
      const userIContents = userContent.map((content) => {
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        return ContentConverters.toIContent(content, idGen, matcher, turnKey);
      });
      return this.historyService.getCuratedForProvider(userIContents);
    }
    const turnKey = this.historyService.generateTurnKey();
    const idGen = this.historyService.getIdGeneratorCallback(turnKey);
    const userIContent = ContentConverters.toIContent(
      userContent,
      idGen,
      matcher,
      turnKey,
    );
    return this.historyService.getCuratedForProvider([userIContent]);
  }

  private async _handleBucketFailover(): Promise<boolean | null> {
    const failoverHandler =
      this.runtimeContext.providerRuntime.config?.getBucketFailoverHandler();
    if (!failoverHandler?.isEnabled()) return null;

    this.logger.debug(() => 'Attempting bucket failover on persistent 429');
    const success = await failoverHandler.tryFailover();
    if (success) {
      const runtimeId =
        this.runtimeContext.providerRuntime.runtimeId ??
        this.runtimeContext.state.runtimeId;
      if (typeof runtimeId === 'string' && runtimeId.trim() !== '') {
        flushRuntimeAuthScope(runtimeId);
      }
      this.logger.debug(
        () =>
          `Bucket failover successful, new bucket: ${failoverHandler.getCurrentBucket()}`,
      );
      return true;
    }
    this.logger.debug(
      () => 'Bucket failover failed - no more buckets available',
    );
    return false;
  }

  /**
   * Convert IContent stream to GenerateContentResponse stream.
   * Tracks token usage metadata from IContent format.
   */
  private async *_convertIContentStream(
    streamResponse: AsyncIterable<IContent>,
  ): AsyncGenerator<GenerateContentResponse> {
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
        const combinedPromptTokens = promptTokens + cacheReads + cacheWrites;
        this.logger.debug(
          () =>
            `[StreamProcessor] Tracking promptTokens from IContent: ${combinedPromptTokens}`,
        );
        this.compressionHandler.lastPromptTokenCount = combinedPromptTokens;
      }
      yield convertIContentToResponse(iContent);
    }
  }

  /**
   * Process streaming response chunks into a complete conversation turn.
   * This is an async generator that yields each chunk and then records history.
   */
  async *processStreamResponse(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    userInput: Content | Content[],
  ): AsyncGenerator<GenerateContentResponse> {
    const {
      modelResponseParts,
      finishReason,
      hasToolCall,
      hasTextResponse,
      hasThinkingResponse,
      allChunks,
    } = await this._aggregateStreamChunks(streamResponse);

    // Yield all chunks to the UI immediately
    for (const chunk of allChunks) {
      yield chunk;
    }

    // Validate and consolidate response
    const consolidatedParts = this._consolidateTextParts(modelResponseParts);
    const responseText = this._extractResponseText(consolidatedParts);

    // Validate stream completion using pre-computed flags from raw (unfiltered)
    // parts, since modelResponseParts may have thoughts stripped out.
    this._validateStreamCompletion(
      userInput,
      hasToolCall,
      hasTextResponse,
      hasThinkingResponse,
      finishReason,
      responseText,
    );

    // Record history with usage metadata
    await this._recordHistoryWithUsage(userInput, consolidatedParts, allChunks);
  }

  /**
   * Aggregate stream chunks and track metadata.
   * Helper to keep processStreamResponse under 80 lines.
   */
  private async _aggregateStreamChunks(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
  ): Promise<{
    modelResponseParts: Part[];
    finishReason: FinishReason | undefined;
    hasToolCall: boolean;
    hasTextResponse: boolean;
    hasThinkingResponse: boolean;
    allChunks: GenerateContentResponse[];
  }> {
    const modelResponseParts: Part[] = [];
    let hasToolCall = false;
    let finishReason: FinishReason | undefined;
    let hasTextResponse = false;
    let hasThinkingResponse = false;
    const allChunks: GenerateContentResponse[] = [];
    const includeThoughts =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    for await (const chunk of streamResponse) {
      const candidateWithReason = chunk?.candidates?.find(
        (c) => c.finishReason,
      );
      if (candidateWithReason)
        finishReason = candidateWithReason.finishReason as FinishReason;

      if (isValidResponse(chunk)) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts) {
          if (parts.some((p) => p.functionCall)) hasToolCall = true;
          if (
            parts.some(
              (p) =>
                p.text &&
                typeof p.text === 'string' &&
                p.text.trim() !== '' &&
                !isThoughtPart(p),
            )
          )
            hasTextResponse = true;
          if (parts.some((p) => isThoughtPart(p))) hasThinkingResponse = true;
          modelResponseParts.push(
            ...(includeThoughts ? parts : parts.filter((p) => !p.thought)),
          );
        }
      }

      if (chunk.usageMetadata?.promptTokenCount !== undefined) {
        this.compressionHandler.lastPromptTokenCount =
          chunk.usageMetadata.promptTokenCount;
      }
      allChunks.push(chunk);
    }

    return {
      modelResponseParts,
      finishReason,
      hasToolCall,
      hasTextResponse,
      hasThinkingResponse,
      allChunks,
    };
  }

  /**
   * Consolidate adjacent text parts.
   */
  private _consolidateTextParts(modelResponseParts: Part[]): Part[] {
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
    return consolidatedParts;
  }

  /**
   * Extract response text from consolidated parts.
   */
  private _extractResponseText(consolidatedParts: Part[]): string {
    return consolidatedParts
      .filter((part) => isValidNonThoughtTextPart(part))
      .map((part) => part.text)
      .join('')
      .trim();
  }

  /**
   * Validate stream completion and throw appropriate errors.
   */
  private _validateStreamCompletion(
    userInput: Content | Content[],
    hasToolCall: boolean,
    hasTextResponse: boolean,
    hasThinkingResponse: boolean,
    finishReason: FinishReason | undefined,
    responseText: string,
  ): void {
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
      !hasThinkingResponse &&
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
  }

  /**
   * Record history with usage metadata and sync token counts.
   */
  private async _recordHistoryWithUsage(
    userInput: Content | Content[],
    consolidatedParts: Part[],
    allChunks: GenerateContentResponse[],
  ): Promise<void> {
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
    if (lastChunkWithMetadata?.usageMetadata) {
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
    this.conversationManager.recordHistory(
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
            `[StreamProcessor] Syncing prompt token count to HistoryService: ${actualPromptTokens}`,
        );
        this.historyService.syncTotalTokens(actualPromptTokens);
        await this.historyService.waitForTokenUpdates();
      }
    } else if (this.compressionHandler.lastPromptTokenCount !== null) {
      if (this.compressionHandler.lastPromptTokenCount > 0) {
        this.logger.debug(
          () =>
            `[StreamProcessor] Syncing prompt token count to HistoryService: ${this.compressionHandler.lastPromptTokenCount}`,
        );
        this.historyService.syncTotalTokens(
          this.compressionHandler.lastPromptTokenCount,
        );
        await this.historyService.waitForTokenUpdates();
      }
    } else {
      this.logger.debug(
        () =>
          `[StreamProcessor] No token count to sync (lastPromptTokenCount: ${this.compressionHandler.lastPromptTokenCount})`,
      );
    }
  }

  /**
   * Enrich schema depth errors with diagnostic information.
   * Adapted from maybeIncludeSchemaDepthContext in geminiChat.ts.
   */
  _enrichSchemaDepthError(error: unknown): void {
    // Check for potentially problematic cyclic tools with cyclic schemas
    // and include a recommendation to remove potentially problematic tools.
    if (isStructuredError(error) && isSchemaDepthError(error.message)) {
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
}
