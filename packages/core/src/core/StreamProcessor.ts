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
import { isRetryableError, retryWithBackoff } from '../utils/retry.js';
import { prependAsyncGenerator } from '../utils/asyncIterator.js';
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
import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
import {
  InvalidStreamError,
  EmptyStreamError,
  isSchemaDepthError,
  isThoughtPart,
  type UsageMetadataWithCache,
} from './geminiChatTypes.js';
import { hasCycleInSchema } from '../tools/tools.js';
import { isStructuredError } from '../utils/quotaErrorDetection.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './geminiChat.js';

/**
 * StreamProcessor handles making API calls and processing streaming responses.
 * Extracted from GeminiChat to isolate streaming concerns.
 */

type ToolGroupArray = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

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
      promptId,
      userContent,
      provider,
    );

    let processedStream: AsyncGenerator<GenerateContentResponse> | undefined;
    const ensureProcessedStream =
      (): AsyncGenerator<GenerateContentResponse> => {
        processedStream ??= this.processStreamResponse(
          streamResponse,
          userContent,
        );
        return processedStream;
      };

    const cancellableStream: AsyncGenerator<GenerateContentResponse> = {
      async next(
        value?: unknown,
      ): Promise<IteratorResult<GenerateContentResponse>> {
        return ensureProcessedStream().next(value);
      },
      async return(
        value?: unknown,
      ): Promise<IteratorResult<GenerateContentResponse>> {
        if (processedStream) {
          return processedStream.return
            ? processedStream.return(value)
            : { done: true, value: undefined };
        }

        if (streamResponse.return) {
          await streamResponse.return(value);
        }

        return { done: true, value: undefined };
      },
      async throw(
        error?: unknown,
      ): Promise<IteratorResult<GenerateContentResponse>> {
        if (processedStream) {
          if (processedStream.throw) {
            return processedStream.throw(error);
          }
          throw error;
        }

        if (streamResponse.throw) {
          return streamResponse.throw(error);
        }

        if (streamResponse.return) {
          await streamResponse.return(undefined);
        }

        throw error;
      },
      [Symbol.asyncIterator](): AsyncGenerator<GenerateContentResponse> {
        return this;
      },
      async [Symbol.asyncDispose](): Promise<void> {
        await this.return(undefined);
      },
    };

    return cancellableStream;
  }

  /**
   * Execute the stream API call with retry and bucket failover.
   * Split from makeApiCallAndProcessStream to keep methods under 80 lines.
   */
  private async _executeStreamApiCall(
    params: SendMessageParameters,
    promptId: string,
    userContent: Content | Content[],
    provider: IProvider,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const apiCall = () =>
      this._buildAndSendStreamRequest(params, promptId, userContent, provider);
    const retryFetchErrors = (
      params.config as { retryFetchErrors?: boolean } | undefined
    )?.retryFetchErrors;

    return retryWithBackoff(apiCall, {
      onPersistent429: () => this._handleBucketFailover(),
      signal: params.config?.abortSignal,
      retryFetchErrors,
      shouldRetryOnError: (error, currentRetryFetchErrors) =>
        error instanceof EmptyStreamError ||
        isRetryableError(error, currentRetryFetchErrors),
    });
  }

  private async _buildAndSendStreamRequest(
    params: SendMessageParameters,
    promptId: string,
    userContent: Content | Content[],
    provider: IProvider,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    let requestContents = this._buildRequestContents(userContent);

    const configForHooks = this.runtimeContext.providerRuntime.config;
    const tools = await this._applyToolSelectionHook(
      configForHooks,
      this.generationConfig.tools,
    );

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

    // Trigger BeforeModel hook for streaming path
    if (configForHooks?.getEnableHooks?.()) {
      const hookSystem = configForHooks.getHookSystem?.();
      if (hookSystem) {
        await hookSystem.initialize();
        const beforeModelResult = await hookSystem.fireBeforeModelEvent({
          contents: requestContents,
          tools: tools as ProviderToolset | undefined,
        });

        if (beforeModelResult?.shouldStopExecution()) {
          throw new AgentExecutionStoppedError(
            beforeModelResult.getEffectiveReason() ||
              'Execution stopped by BeforeModel hook',
            beforeModelResult.systemMessage,
          );
        }

        if (beforeModelResult?.isBlockingDecision()) {
          let syntheticResponse = beforeModelResult.getSyntheticResponse();
          if (syntheticResponse) {
            const candidate = syntheticResponse.candidates?.[0];
            if (candidate && !candidate.finishReason) {
              syntheticResponse = {
                ...syntheticResponse,
                candidates: [
                  {
                    ...candidate,
                    finishReason: FinishReason.STOP,
                  },
                ],
              } as GenerateContentResponse;
            }
          }
          throw new AgentExecutionBlockedError(
            beforeModelResult.getEffectiveReason() ||
              'Request blocked by BeforeModel hook',
            syntheticResponse,
          );
        }

        if (beforeModelResult) {
          const modifiedRequest =
            beforeModelResult.applyLLMRequestModifications({
              model: this.runtimeContext.state.model || '',
              contents: ContentConverters.toGeminiContents(requestContents),
            });
          if (modifiedRequest?.contents) {
            requestContents = ContentConverters.toIContents(
              modifiedRequest.contents as Content[],
            );
          }
        }
      }
    }

    const requestPayload = {
      contents: requestContents,
      tools,
    };

    const runtimeContext = params.config
      ? {
          ...baseRuntimeContext,
          config: { ...baseRuntimeContext.config, ...params.config },
        }
      : baseRuntimeContext;

    const requestContentsForTelemetry = ContentConverters.toGeminiContents(
      requestPayload.contents,
    );
    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      requestContentsForTelemetry,
      this.runtimeContext.state.model,
      promptId,
    );

    const startTime = Date.now();
    try {
      const streamResponse = provider.generateChatCompletion({
        contents: requestPayload.contents,
        tools: requestPayload.tools as ProviderToolset | undefined,
        config: runtimeContext.config,
        runtime: runtimeContext,
        settings: runtimeContext.settingsService,
        metadata: {
          ...runtimeContext.metadata,
          abortSignal: params.config?.abortSignal,
        },
        userMemory: baseRuntimeContext.config?.getUserMemory?.(),
      } as GenerateChatOptions);

      // Convert IContent stream to GenerateContentResponse stream
      const convertedStream = this._convertIContentStream(
        streamResponse,
        requestPayload,
        {
          promptId,
          startTime,
        },
      );

      /**
       * CRITICAL FIX (#1750): Eagerly consume the first chunk within the retry boundary.
       *
       * The problem: provider.generateChatCompletion() returns a lazy async generator.
       * The actual API call and HTTP connection establishment happens when the iterator
       * is consumed, not when the generator is created. This means errors during the
       * actual API call occur OUTSIDE the retryWithBackoff boundary.
       *
       * The fix: Call .next() on the converted stream BEFORE returning. This ensures:
       * 1. The HTTP connection is established inside the retryWithBackoff boundary
       * 2. Connection errors (429, 500, etc.) trigger retry logic and bucket failover
       * 3. Empty stream detection happens within the retry boundary
       *
       * We then use prependAsyncGenerator to reconstruct a generator that yields
       * the preloaded first chunk followed by the remaining iterator.
       */
      const firstChunk = await convertedStream.next();

      if (firstChunk.done === true) {
        throw new EmptyStreamError(
          'Model stream ended immediately with no content.',
        );
      }

      // Use prependAsyncGenerator to wrap the preloaded first chunk
      // with the remaining iterator from convertedStream
      return prependAsyncGenerator(firstChunk.value, convertedStream);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logApiError(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        promptId,
        durationMs,
        error,
      );
      throw error;
    }
  }

  private async _applyToolSelectionHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    tools: GenerateContentConfig['tools'],
  ): Promise<GenerateContentConfig['tools']> {
    const toolsFromConfig = tools as ToolGroupArray | undefined;
    if (!toolsFromConfig || !configForHooks?.getEnableHooks?.()) {
      return tools;
    }

    const hookSystem = configForHooks.getHookSystem?.();
    if (!hookSystem) {
      return tools;
    }

    await hookSystem.initialize();
    const toolSelectionResult =
      await hookSystem.fireBeforeToolSelectionEvent(toolsFromConfig);
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });

    if (
      modifiedConfig?.toolConfig &&
      'allowedFunctionNames' in modifiedConfig.toolConfig
    ) {
      const allowedFunctions = modifiedConfig.toolConfig.allowedFunctionNames;
      if (allowedFunctions?.length) {
        return toolsFromConfig
          .map((toolGroup) => ({
            ...toolGroup,
            functionDeclarations: toolGroup.functionDeclarations?.filter((fn) =>
              allowedFunctions.includes(fn.name),
            ),
          }))
          .filter((g) => g.functionDeclarations?.length) as ToolGroupArray;
      }
    }

    return toolsFromConfig;
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
    if (!failoverHandler) return null;

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
   * Triggers AfterModel hook per streamed chunk.
   */
  private async *_convertIContentStream(
    streamResponse: AsyncIterable<IContent>,
    llmRequest?: Record<string, unknown>,
    telemetryContext?: { promptId: string; startTime: number },
  ): AsyncGenerator<GenerateContentResponse> {
    let lastConvertedChunk: GenerateContentResponse | undefined;

    for await (const iContent of streamResponse) {
      // Track token counts from IContent metadata (Anthropic/OpenAI format)
      // before conversion to Gemini format
      // Include cached prompt tokens to reflect full context size
      const promptTokens = iContent.metadata?.usage?.promptTokens;
      if (promptTokens !== undefined) {
        const cacheReads =
          iContent.metadata?.usage?.cache_read_input_tokens ?? 0;
        const cacheWrites =
          iContent.metadata?.usage?.cache_creation_input_tokens ?? 0;
        const combinedPromptTokens = promptTokens + cacheReads + cacheWrites;
        this.logger.debug(
          () =>
            `[StreamProcessor] Tracking promptTokens from IContent: ${combinedPromptTokens}`,
        );
        this.compressionHandler.lastPromptTokenCount = combinedPromptTokens;
      }

      // Convert current chunk to GenerateContentResponse
      const convertedChunk = convertIContentToResponse(iContent);
      lastConvertedChunk = convertedChunk;

      // Trigger AfterModel hook per streamed chunk
      const hookConfig = this.runtimeContext.providerRuntime.config;
      if (hookConfig?.getEnableHooks?.()) {
        const hookSystem = hookConfig.getHookSystem?.();
        if (hookSystem) {
          if (!hookSystem.isInitialized()) {
            await hookSystem.initialize();
          }
          const afterModelResult = await hookSystem.fireAfterModelEvent(
            llmRequest ?? {},
            iContent,
          );

          if (afterModelResult?.shouldStopExecution()) {
            throw new AgentExecutionStoppedError(
              afterModelResult.getEffectiveReason() ??
                'Execution stopped by AfterModel hook',
              afterModelResult.systemMessage,
            );
          }

          if (afterModelResult?.isBlockingDecision()) {
            const modifiedResponse = afterModelResult.getModifiedResponse();
            const syntheticResponse = modifiedResponse ?? convertedChunk;
            throw new AgentExecutionBlockedError(
              afterModelResult.getEffectiveReason() ??
                'Execution blocked by AfterModel hook',
              syntheticResponse,
              afterModelResult.systemMessage,
            );
          }

          const modifiedResponse = afterModelResult?.getModifiedResponse();
          if (modifiedResponse) {
            lastConvertedChunk = modifiedResponse;
            yield modifiedResponse;
            continue;
          }
        }
      }

      yield convertedChunk;
    }

    if (telemetryContext && lastConvertedChunk) {
      const durationMs = Date.now() - telemetryContext.startTime;
      logApiResponse(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        telemetryContext.promptId,
        durationMs,
        lastConvertedChunk.usageMetadata,
        JSON.stringify(lastConvertedChunk),
      );
    }
  }

  /**
   * Process streaming response chunks into a complete conversation turn.
   * Yields each chunk immediately as it arrives from the provider stream,
   * while simultaneously tracking metadata for validation and history.
   *
   * CRITICAL: This method must yield chunks inline during the for-await loop.
   * Collecting all chunks first (as was done in a prior refactoring) blocks
   * the entire pipeline — no output reaches the user, no abort signal checks
   * run, and stalled provider streams hang indefinitely. See #1846.
   */
  async *processStreamResponse(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    userInput: Content | Content[],
  ): AsyncGenerator<GenerateContentResponse> {
    // Aggregate metadata inline while yielding each chunk immediately
    const modelResponseParts: Part[] = [];
    let hasToolCall = false;
    let finishReason: FinishReason | undefined;
    let hasTextResponse = false;
    let hasThinkingResponse = false;
    const allChunks: GenerateContentResponse[] = [];
    const includeThoughts =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    for await (const chunk of streamResponse) {
      // Track finish reason
      const candidateWithReason = chunk?.candidates?.find(
        (c) => c.finishReason,
      );
      if (candidateWithReason)
        finishReason = candidateWithReason.finishReason as FinishReason;

      // Track response content flags for later validation
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

      const chunkText = typeof chunk.text === 'string' ? chunk.text : '';
      this.logger.debug(() => `[stream:terminal] observed converted chunk`, {
        chunkFinishReason: candidateWithReason?.finishReason,
        partCount: chunk.candidates?.[0]?.content?.parts?.length ?? 0,
        toolCallCount: chunk.functionCalls?.length ?? 0,
        textLength: chunkText.length,
        hasUsageMetadata: Boolean(chunk.usageMetadata),
      });

      // Track token usage
      if (chunk.usageMetadata?.promptTokenCount !== undefined) {
        const chunkUsage = chunk.usageMetadata as UsageMetadataWithCache;
        this.compressionHandler.lastPromptTokenCount =
          chunk.usageMetadata.promptTokenCount +
          (chunkUsage.cache_read_input_tokens ?? 0) +
          (chunkUsage.cache_creation_input_tokens ?? 0);
      }
      allChunks.push(chunk);

      // Yield immediately — this is the critical fix for #1846
      yield chunk;
    }

    // Post-stream: validate and record history
    const consolidatedParts = this._consolidateTextParts(modelResponseParts);
    const responseText = this._extractResponseText(consolidatedParts);

    if (!finishReason) {
      this.logger.debug(
        () =>
          `[stream:terminal] stream ended without finishReason (hasToolCall=${String(hasToolCall)}, hasTextResponse=${String(hasTextResponse)}, hasThinkingResponse=${String(hasThinkingResponse)}, responseTextLength=${responseText.length})`,
      );
    } else {
      this.logger.debug(
        () => `[stream:terminal] finalized stream with finishReason`,
        {
          finishReason,
          hasToolCall,
          hasTextResponse,
          hasThinkingResponse,
          responseTextLength: responseText.length,
          chunkCount: allChunks.length,
        },
      );
    }

    this._validateStreamCompletion(
      userInput,
      hasToolCall,
      hasTextResponse,
      hasThinkingResponse,
      finishReason,
      responseText,
    );

    await this._recordHistoryWithUsage(userInput, consolidatedParts, allChunks);
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

    this.logger.debug(
      () => `[stream:terminal] validating converted stream completion`,
      {
        hasToolCall,
        hasTextResponse,
        hasThinkingResponse,
        finishReason,
        responseTextLength: responseText.length,
        isToolContinuationInput,
      },
    );

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
        this.logger.warn(
          () =>
            `[stream:terminal] validation failed: missing finishReason and text`,
          {
            hasToolCall,
            hasTextResponse,
            hasThinkingResponse,
            finishReason,
            responseTextLength: responseText.length,
            isToolContinuationInput,
          },
        );
        throw new InvalidStreamError(
          'Model stream ended without a finish reason and no text response.',
          'NO_FINISH_REASON_NO_TEXT',
        );
      } else {
        this.logger.warn(
          () => `[stream:terminal] validation failed: empty response text`,
          {
            hasToolCall,
            hasTextResponse,
            hasThinkingResponse,
            finishReason,
            responseTextLength: responseText.length,
            isToolContinuationInput,
          },
        );
        throw new InvalidStreamError(
          'Model stream ended with empty response text.',
          'NO_RESPONSE_TEXT',
        );
      }
    }

    // Handle MALFORMED_FUNCTION_CALL finish reason - should trigger retry
    if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
      this.logger.warn(
        () =>
          `[stream:terminal] validation failed: malformed function call finishReason`,
        {
          hasToolCall,
          hasTextResponse,
          hasThinkingResponse,
          finishReason,
          responseTextLength: responseText.length,
          isToolContinuationInput,
        },
      );
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
        promptTokens: lastChunkWithMetadata.usageMetadata.promptTokenCount ?? 0,
        completionTokens:
          lastChunkWithMetadata.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: lastChunkWithMetadata.usageMetadata.totalTokenCount ?? 0,
      };
      const usageMetadata =
        lastChunkWithMetadata.usageMetadata as UsageMetadataWithCache;
      const cacheReads = usageMetadata.cache_read_input_tokens ?? 0;
      const cacheWrites = usageMetadata.cache_creation_input_tokens ?? 0;
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
