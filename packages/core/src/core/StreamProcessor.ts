/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

/**
 * StreamProcessor - Handles API stream requests and response processing.
 * Extracted from geminiChat.ts Phase 05.
 * These are the core streaming methods that make API calls and process responses.
 */

import type { GenerateContentResponse } from '@google/genai';
import type { BeforeModelHookOutput } from '../hooks/types.js';
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
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

function isMissingFinishReason(
  finishReason: FinishReason | null | undefined | '',
): boolean {
  return finishReason == null || finishReason === '';
}

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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
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

    return this._createCancellableStream(streamResponse, userContent);
  }

  private _createCancellableStream(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    userContent: Content | Content[],
  ): AsyncGenerator<GenerateContentResponse> {
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
          return typeof processedStream.return === 'function'
            ? processedStream.return(value)
            : { done: true, value: undefined };
        }

        if (typeof streamResponse.return === 'function') {
          await streamResponse.return(value);
        }

        return { done: true, value: undefined };
      },
      async throw(
        error?: unknown,
      ): Promise<IteratorResult<GenerateContentResponse>> {
        if (processedStream) {
          if (typeof processedStream.throw === 'function') {
            return processedStream.throw(error);
          }
          throw error;
        }

        if (typeof streamResponse.throw === 'function') {
          return streamResponse.throw(error);
        }

        if (typeof streamResponse.return === 'function') {
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
    const requestContents = this._buildRequestContents(userContent);

    const configForHooks = this.runtimeContext.providerRuntime.config;
    const tools = await this._applyToolSelectionHook(
      configForHooks,
      this.generationConfig.tools,
    );

    const { requestPayload, baseRuntimeContext, runtimeContext } =
      this._prepareRequestPayload(
        requestContents,
        tools,
        params,
      );

    const finalContents = await this._fireBeforeModelHook(
      configForHooks,
      requestPayload.contents,
      tools as ProviderToolset | undefined,
    );
    requestPayload.contents = finalContents;

    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      ContentConverters.toGeminiContents(requestPayload.contents),
      this.runtimeContext.state.model,
      promptId,
    );

    return this._sendProviderRequest(
      provider,
      requestPayload,
      runtimeContext,
      baseRuntimeContext,
      params,
      promptId,
    );
  }

  /**
   * Fire BeforeModel hook and return possibly-modified requestContents.
   * Throws if the hook requests execution stop or blocking.
   */
  private async _fireBeforeModelHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    requestContents: IContent[],
    tools: ProviderToolset | undefined,
  ): Promise<IContent[]> {
    if (
      configForHooks === undefined ||
      typeof configForHooks.getEnableHooks !== 'function' ||
      configForHooks.getEnableHooks() !== true
    ) {
      return requestContents;
    }

    const hookSystem =
      typeof configForHooks.getHookSystem === 'function'
        ? configForHooks.getHookSystem()
        : undefined;
    if (hookSystem === undefined) return requestContents;

    await hookSystem.initialize();
    const beforeModelResult = await hookSystem.fireBeforeModelEvent({
      contents: requestContents,
      tools,
    });

    if (beforeModelResult?.shouldStopExecution() === true) {
      const reason = beforeModelResult.getEffectiveReason() as
        | string
        | null
        | undefined;
      throw new AgentExecutionStoppedError(
        reason !== undefined && reason !== null && reason !== ''
          ? reason
          : 'Execution stopped by BeforeModel hook',
        beforeModelResult.systemMessage,
      );
    }

    if (beforeModelResult?.isBlockingDecision() === true) {
      let syntheticResponse = beforeModelResult.getSyntheticResponse();
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (syntheticResponse) {
        const candidate = syntheticResponse.candidates?.[0];
        const candidateFinishReason = candidate?.finishReason as
          | FinishReason
          | ''
          | null
          | undefined;
        if (candidate && isMissingFinishReason(candidateFinishReason)) {
          syntheticResponse = this._patchMissingFinishReason(
            syntheticResponse,
            candidate,
          );
        }
      }
      const reason = beforeModelResult.getEffectiveReason() as
        | string
        | null
        | undefined;
      throw new AgentExecutionBlockedError(
        reason !== undefined && reason !== null && reason !== ''
          ? reason
          : 'Request blocked by BeforeModel hook',
        syntheticResponse,
      );
    }

    return this._applyRequestModifications(
      beforeModelResult,
      requestContents,
    );
  }

  private _patchMissingFinishReason(
    syntheticResponse: GenerateContentResponse,
    candidate: NonNullable<GenerateContentResponse['candidates']>[0],
  ): GenerateContentResponse {
    return {
      ...syntheticResponse,
      candidates: [{ ...candidate, finishReason: FinishReason.STOP }],
    } as GenerateContentResponse;
  }

  private _applyRequestModifications(
    beforeModelResult: BeforeModelHookOutput | undefined,
    requestContents: IContent[],
  ): IContent[] {
    if (!beforeModelResult) return requestContents;

    const modifiedRequest = beforeModelResult.applyLLMRequestModifications({
      model: this.runtimeContext.state.model || '',
      contents: ContentConverters.toGeminiContents(requestContents),
    });
    const modifiedContents = (modifiedRequest as { contents?: Content[] | null })
      .contents;
    if (modifiedContents !== undefined && modifiedContents !== null) {
      return ContentConverters.toIContents(modifiedContents);
    }
    return requestContents;
  }

  private _prepareRequestPayload(
    requestContents: IContent[],
    tools: GenerateContentConfig['tools'],
    params: SendMessageParameters,
  ): {
    requestPayload: { contents: IContent[]; tools: unknown };
    baseRuntimeContext: ProviderRuntimeContext;
    runtimeContext: ProviderRuntimeContext;
  } {
    this.logger.debug(
      () => '[StreamProcessor] Calling provider.generateChatCompletion',
      {
        providerName: this.providerResolver('stream').name,
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

    const requestPayload = { contents: requestContents, tools };

    const runtimeContext = this._buildRuntimeContext(
      baseRuntimeContext,
      params,
    );

    return { requestPayload, baseRuntimeContext, runtimeContext };
  }

  private _buildRuntimeContext(
    baseRuntimeContext: ProviderRuntimeContext,
    params: SendMessageParameters,
  ): ProviderRuntimeContext {
    if (!params.config) return baseRuntimeContext;
    return {
      ...baseRuntimeContext,
      config: { ...baseRuntimeContext.config, ...params.config },
    } as ProviderRuntimeContext;
  }

  private async _sendProviderRequest(
    provider: IProvider,
    requestPayload: { contents: IContent[]; tools: unknown },
    runtimeContext: ProviderRuntimeContext,
    baseRuntimeContext: ProviderRuntimeContext,
    params: SendMessageParameters,
    promptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
        userMemory: baseRuntimeContext.config?.getUserMemory?.(),
      } as GenerateChatOptions);

      return await this._consumeFirstChunkAndReturn(
        streamResponse,
        requestPayload,
        promptId,
        startTime,
      );
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

  /**
   * Eagerly consume first chunk within retry boundary (#1750).
   */
  private async _consumeFirstChunkAndReturn(
    streamResponse: AsyncIterable<IContent>,
    requestPayload: { contents: IContent[]; tools: unknown },
    promptId: string,
    startTime: number,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const convertedStream = this._convertIContentStream(
      streamResponse,
      requestPayload,
      { promptId, startTime },
    );

    const firstChunk = await convertedStream.next();

    if (firstChunk.done === true) {
      throw new EmptyStreamError(
        'Model stream ended immediately with no content.',
      );
    }

    return prependAsyncGenerator(firstChunk.value, convertedStream);
  }

  private async _applyToolSelectionHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    tools: GenerateContentConfig['tools'],
  ): Promise<GenerateContentConfig['tools']> {
    const toolsFromConfig = tools as ToolGroupArray | undefined;
    if (toolsFromConfig === undefined || configForHooks === undefined) {
      return tools;
    }

    const getToolSelectionHooksEnabled = configForHooks.getEnableHooks;
    if (
      typeof getToolSelectionHooksEnabled !== 'function' ||
      getToolSelectionHooksEnabled.call(configForHooks) !== true
    ) {
      return tools;
    }

    const getToolSelectionHookSystem = configForHooks.getHookSystem;
    const hookSystem =
      typeof getToolSelectionHookSystem === 'function'
        ? getToolSelectionHookSystem.call(configForHooks)
        : undefined;
    if (hookSystem === undefined) {
      return tools;
    }

    await hookSystem.initialize();
    const toolSelectionResult =
      await hookSystem.fireBeforeToolSelectionEvent(toolsFromConfig);
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });

    const toolConfig = modifiedConfig?.toolConfig as unknown;
    if (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      toolConfig !== undefined &&
      toolConfig !== null &&
      typeof toolConfig === 'object' &&
      'allowedFunctionNames' in toolConfig &&
      Array.isArray(toolConfig.allowedFunctionNames) &&
      toolConfig.allowedFunctionNames.length > 0
    ) {
      const allowedFunctions = toolConfig.allowedFunctionNames;
      return toolsFromConfig
        .map((toolGroup) => ({
          ...toolGroup,
          functionDeclarations: Array.isArray(toolGroup.functionDeclarations)
            ? toolGroup.functionDeclarations.filter(
                (fn) =>
                  typeof fn.name === 'string' &&
                  allowedFunctions.includes(fn.name),
              )
            : [],
        }))
        .filter((g) => g.functionDeclarations.length > 0) as ToolGroupArray;
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
      this._trackPromptTokens(iContent);

      const convertedChunk = convertIContentToResponse(iContent);
      lastConvertedChunk = convertedChunk;

      const hookResult = await this._processAfterModelHook(
        iContent,
        llmRequest,
        convertedChunk,
      );

      if (hookResult.type === 'modified') {
        lastConvertedChunk = hookResult.response;
        yield hookResult.response;
        continue;
      }

      yield convertedChunk;
    }

    this._logTelemetry(telemetryContext, lastConvertedChunk);
  }

  private _trackPromptTokens(iContent: IContent): void {
    const promptTokens = iContent.metadata?.usage?.promptTokens;
    if (promptTokens === undefined) return;

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

  private async _processAfterModelHook(
    iContent: IContent,
    llmRequest: Record<string, unknown> | undefined,
    convertedChunk: GenerateContentResponse,
  ): Promise<
    | { type: 'modified'; response: GenerateContentResponse }
    | { type: 'passthrough' }
  > {
    const hookConfig = this.runtimeContext.providerRuntime.config;
    if (
      hookConfig === undefined ||
      typeof hookConfig.getEnableHooks !== 'function' ||
      hookConfig.getEnableHooks() !== true
    ) {
      return { type: 'passthrough' };
    }

    const hookSystem =
      typeof hookConfig.getHookSystem === 'function'
        ? hookConfig.getHookSystem()
        : undefined;
    if (hookSystem === undefined) return { type: 'passthrough' };

    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (!hookSystem.isInitialized()) {
      await hookSystem.initialize();
    }
    const afterModelResult = await hookSystem.fireAfterModelEvent(
      llmRequest ?? {},
      iContent,
    );

    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (afterModelResult?.shouldStopExecution() === true) {
      const effectiveReason = afterModelResult.getEffectiveReason() as
        | string
        | undefined;
      throw new AgentExecutionStoppedError(
        effectiveReason ?? 'Execution stopped by AfterModel hook',
        afterModelResult.systemMessage,
      );
    }

    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (afterModelResult?.isBlockingDecision() === true) {
      const modifiedResponse = afterModelResult.getModifiedResponse();
      const syntheticResponse = modifiedResponse ?? convertedChunk;
      const effectiveReason = afterModelResult.getEffectiveReason() as
        | string
        | undefined;
      throw new AgentExecutionBlockedError(
        effectiveReason ?? 'Execution blocked by AfterModel hook',
        syntheticResponse,
        afterModelResult.systemMessage,
      );
    }

    const modifiedResponse = afterModelResult?.getModifiedResponse();
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (modifiedResponse) {
      return { type: 'modified', response: modifiedResponse };
    }

    return { type: 'passthrough' };
  }

  private _logTelemetry(
    telemetryContext: { promptId: string; startTime: number } | undefined,
    lastConvertedChunk: GenerateContentResponse | undefined,
  ): void {
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
    const acc = this._createStreamAccumulator();
    const includeThoughts =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    for await (const chunk of streamResponse) {
      this._accumulateChunkMetadata(chunk, acc, includeThoughts);
      yield chunk;
    }

    await this._finalizeStreamProcessing(acc, userInput);
  }

  private _createStreamAccumulator(): {
    modelResponseParts: Part[];
    hasToolCall: boolean;
    finishReason: FinishReason | undefined;
    hasTextResponse: boolean;
    hasThinkingResponse: boolean;
    allChunks: GenerateContentResponse[];
  } {
    return {
      modelResponseParts: [],
      hasToolCall: false,
      finishReason: undefined,
      hasTextResponse: false,
      hasThinkingResponse: false,
      allChunks: [],
    };
  }

  private _accumulateChunkMetadata(
    chunk: GenerateContentResponse,
    acc: {
      modelResponseParts: Part[];
      hasToolCall: boolean;
      finishReason: FinishReason | undefined;
      hasTextResponse: boolean;
      hasThinkingResponse: boolean;
      allChunks: GenerateContentResponse[];
    },
    includeThoughts: boolean,
  ): void {
    const candidateWithReason = chunk.candidates?.find(
      (c) => c.finishReason !== undefined,
    );
    if (candidateWithReason !== undefined)
      acc.finishReason = candidateWithReason.finishReason as FinishReason;

    if (isValidResponse(chunk)) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts !== undefined) {
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (parts.some((p) => p.functionCall !== undefined))
          acc.hasToolCall = true;
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (
          parts.some(
            (p) =>
              p.text !== undefined &&
              typeof p.text === 'string' &&
              p.text.trim() !== '' &&
              !isThoughtPart(p),
          )
        )
          acc.hasTextResponse = true;
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (parts.some((p) => isThoughtPart(p)))
          acc.hasThinkingResponse = true;
        acc.modelResponseParts.push(
          ...(includeThoughts
            ? parts
            : parts.filter((p) => p.thought !== true)),
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

    if (chunk.usageMetadata?.promptTokenCount !== undefined) {
      const chunkUsage = chunk.usageMetadata as UsageMetadataWithCache;
      this.compressionHandler.lastPromptTokenCount =
        chunk.usageMetadata.promptTokenCount +
        (chunkUsage.cache_read_input_tokens ?? 0) +
        (chunkUsage.cache_creation_input_tokens ?? 0);
    }
    acc.allChunks.push(chunk);
  }

  private async _finalizeStreamProcessing(
    acc: {
      modelResponseParts: Part[];
      hasToolCall: boolean;
      finishReason: FinishReason | undefined;
      hasTextResponse: boolean;
      hasThinkingResponse: boolean;
      allChunks: GenerateContentResponse[];
    },
    userInput: Content | Content[],
  ): Promise<void> {
    const consolidatedParts = this._consolidateTextParts(acc.modelResponseParts);
    const responseText = this._extractResponseText(consolidatedParts);

    if (isMissingFinishReason(acc.finishReason)) {
      this.logger.debug(
        () =>
          `[stream:terminal] stream ended without finishReason (hasToolCall=${String(acc.hasToolCall)}, hasTextResponse=${String(acc.hasTextResponse)}, hasThinkingResponse=${String(acc.hasThinkingResponse)}, responseTextLength=${responseText.length})`,
      );
    } else {
      this.logger.debug(
        () => `[stream:terminal] finalized stream with finishReason`,
        {
          finishReason: acc.finishReason,
          hasToolCall: acc.hasToolCall,
          hasTextResponse: acc.hasTextResponse,
          hasThinkingResponse: acc.hasThinkingResponse,
          responseTextLength: responseText.length,
          chunkCount: acc.allChunks.length,
        },
      );
    }

    this._validateStreamCompletion(
      userInput,
      acc.hasToolCall,
      acc.hasTextResponse,
      acc.hasThinkingResponse,
      acc.finishReason,
      responseText,
    );

    await this._recordHistoryWithUsage(
      userInput,
      consolidatedParts,
      acc.allChunks,
    );
  }

  /**
   * Consolidate adjacent text parts.
   */
  private _consolidateTextParts(modelResponseParts: Part[]): Part[] {
    const consolidatedParts: Part[] = [];
    for (const part of modelResponseParts) {
      const lastPart = consolidatedParts[consolidatedParts.length - 1];
      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
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

    const validationContext = {
      hasToolCall,
      hasTextResponse,
      hasThinkingResponse,
      finishReason,
      responseTextLength: responseText.length,
      isToolContinuationInput,
    };

    this.logger.debug(
      () => `[stream:terminal] validating converted stream completion`,
      validationContext,
    );

    const hasMissingFinishAndNoText =
      isMissingFinishReason(finishReason) && !hasTextResponse;
    const isEmptyResponse = responseText === '';
    const noRelevantContent = !hasToolCall && !isToolContinuationInput && !hasThinkingResponse;
    const isInvalidResponse =
      noRelevantContent && (hasMissingFinishAndNoText || isEmptyResponse);

    if (isInvalidResponse) {
      this._throwMissingResponseError(
        finishReason,
        hasTextResponse,
        validationContext,
      );
    }

    if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
      this.logger.warn(
        () =>
          `[stream:terminal] validation failed: malformed function call finishReason`,
        validationContext,
      );
      throw new InvalidStreamError(
        'Model stream ended with malformed function call.',
        'MALFORMED_FUNCTION_CALL',
      );
    }
  }

  private _throwMissingResponseError(
    finishReason: FinishReason | undefined,
    hasTextResponse: boolean,
    validationContext: Record<string, unknown>,
  ): void {
    if (isMissingFinishReason(finishReason) && !hasTextResponse) {
      this.logger.warn(
        () =>
          `[stream:terminal] validation failed: missing finishReason and text`,
        validationContext,
      );
      throw new InvalidStreamError(
        'Model stream ended without a finish reason and no text response.',
        'NO_FINISH_REASON_NO_TEXT',
      );
    }
    this.logger.warn(
      () => `[stream:terminal] validation failed: empty response text`,
      validationContext,
    );
    throw new InvalidStreamError(
      'Model stream ended with empty response text.',
      'NO_RESPONSE_TEXT',
    );
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison -- preserve defensive runtime boundary guard despite current static types.
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
        if (
          metadata?.parameterSchema &&
          hasCycleInSchema(metadata.parameterSchema)
        ) {
          cyclicSchemaTools.push(toolName);
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
