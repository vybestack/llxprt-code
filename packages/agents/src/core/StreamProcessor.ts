/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * StreamProcessor - Handles API stream requests and response processing.
 * Extracted from chatSession.ts Phase 05.
 * These are the core streaming methods that make API calls and process responses.
 */

import type { GenerateContentResponse } from '@google/genai';
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  type Content,
  type SendMessageParameters,
  type Part,
  type FinishReason,
  type GenerateContentConfig,
} from '@google/genai';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { prependAsyncGenerator } from '@vybestack/llxprt-code-core/utils/asyncIterator.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset as ProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import { convertIContentToResponse } from './MessageConverter.js';
import { logApiResponse, logApiError } from './turnLogging.js';
import {
  EmptyStreamError,
  isSchemaDepthError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { hasCycleInSchema } from '@vybestack/llxprt-code-tools';
import { isStructuredError } from '@vybestack/llxprt-code-core/utils/quotaErrorDetection.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import {
  attachHookRestrictedAllowedTools,
  filterHookRestrictedContent,
  getHookRestrictedAllowedTools,
} from './hookToolRestrictions.js';
import { canonicalizeToolName } from './toolGovernance.js';
import {
  buildRequestContents,
  selectRequestTools,
  prepareRequestPayload,
  buildRuntimeContext,
  patchMissingFinishReason,
  applyRequestModifications,
  resolveUserMemory,
  logOutgoingRequest,
  type ToolGroupArray,
  type ToolSelectionHookResult,
} from './streamRequestHelpers.js';
import {
  createStreamAccumulator,
  accumulateChunkMetadata,
  consolidateTextParts,
  extractResponseText,
  validateStreamCompletion,
  recordHistoryWithUsage,
  trackPromptTokens,
  isMissingFinishReason,
  type StreamAccumulator,
} from './streamResponseHelpers.js';

/**
 * StreamProcessor handles making API calls and processing streaming responses.
 * Extracted from ChatSession to isolate streaming concerns.
 */

/**
 * Extract the allowedFunctionNames array from a tool-config object.
 *
 * Returns `undefined` when the config is absent or does not carry an
 * `allowedFunctionNames` string array, otherwise returns the typed array.
 */
function extractAllowedFunctionNames(
  toolConfig: unknown,
): string[] | undefined {
  if (toolConfig === null || toolConfig === undefined) return undefined;
  if (typeof toolConfig !== 'object') return undefined;
  if (!('allowedFunctionNames' in toolConfig)) return undefined;
  if (!Array.isArray(toolConfig.allowedFunctionNames)) return undefined;
  return toolConfig.allowedFunctionNames;
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
   * This outer method resolves the provider, makes the API call with retry,
   * and returns processStreamResponse.
   */
  async makeApiCallAndProcessStream(
    params: SendMessageParameters,
    promptId: string,
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

    const cancellableStream = {
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
        return this as AsyncGenerator<GenerateContentResponse>;
      },
    };

    return cancellableStream as AsyncGenerator<GenerateContentResponse>;
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

    return retryWithBackoff(apiCall, {
      onPersistent429: () => this._handleBucketFailover(),
      signal: params.config?.abortSignal,
      shouldRetryOnError: (error) =>
        error instanceof EmptyStreamError || isRetryableError(error),
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
    const requestTools = this._selectRequestTools(params);
    const toolSelection = await this._applyToolSelectionHook(
      configForHooks,
      requestTools,
    );
    const tools = toolSelection.tools;

    const { requestPayload, baseRuntimeContext, runtimeContext } =
      this._prepareRequestPayload(requestContents, tools, params);

    try {
      const finalContents = await this._fireBeforeModelHook(
        configForHooks,
        requestPayload.contents,
        tools as ProviderToolset | undefined,
        toolSelection.allowedFunctionNames,
      );
      requestPayload.contents =
        await this.compressionHandler.enforceProviderContents(
          finalContents,
          promptId,
          provider,
        );

      logOutgoingRequest(
        this.runtimeContext,
        requestPayload,
        this.runtimeContext.state.model,
        promptId,
      );

      const stream = await this._sendProviderRequest(
        provider,
        requestPayload,
        runtimeContext,
        baseRuntimeContext,
        params,
        promptId,
        toolSelection.allowedFunctionNames,
      );
      return this._withCompressionCallbackCleanup(stream, provider);
    } catch (error) {
      this.compressionHandler.clearProviderCompressionCallback(provider);
      throw error;
    }
  }

  private _withCompressionCallbackCleanup(
    stream: AsyncGenerator<GenerateContentResponse>,
    provider: IProvider,
  ): AsyncGenerator<GenerateContentResponse> {
    let cleanupDone = false;
    const cleanup = () => {
      if (!cleanupDone) {
        cleanupDone = true;
        this.compressionHandler.clearProviderCompressionCallback(provider);
      }
    };

    return {
      next: async (value?: unknown) => {
        const result = await stream.next(value);
        if (result.done === true) cleanup();
        return result;
      },
      return: async (value?: unknown) => {
        try {
          return await stream.return(value);
        } finally {
          cleanup();
        }
      },
      throw: async (error?: unknown) => {
        try {
          return await stream.throw(error);
        } finally {
          cleanup();
        }
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    } as unknown as AsyncGenerator<GenerateContentResponse>;
  }

  /**
   * Fire BeforeModel hook and return possibly-modified requestContents.
   * Throws if the hook requests execution stop or blocking.
   */
  private async _fireBeforeModelHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    requestContents: IContent[],
    tools: ProviderToolset | undefined,
    hookRestrictedAllowedTools: string[] | undefined,
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
        syntheticResponse === undefined
          ? undefined
          : attachHookRestrictedAllowedTools(
              syntheticResponse,
              hookRestrictedAllowedTools,
            ),
      );
    }

    return this._applyRequestModifications(beforeModelResult, requestContents);
  }

  private _patchMissingFinishReason(
    syntheticResponse: GenerateContentResponse,
    candidate: NonNullable<GenerateContentResponse['candidates']>[0],
  ): GenerateContentResponse {
    return patchMissingFinishReason(syntheticResponse, candidate);
  }

  private _applyRequestModifications(
    beforeModelResult: BeforeModelHookOutput | undefined,
    requestContents: IContent[],
  ): IContent[] {
    return applyRequestModifications(
      beforeModelResult,
      requestContents,
      this.runtimeContext.state.model,
    );
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
    const { requestPayload, baseRuntimeContext } = prepareRequestPayload({
      requestContents,
      tools,
      logger: this.logger,
      providerRuntimeBuilder: this.providerRuntimeBuilder,
      providerName: this.providerResolver('stream').name,
      modelName: this.runtimeContext.state.model,
      baseUrl: this.runtimeContext.state.baseUrl,
    });

    const runtimeContext = this._buildRuntimeContext(
      baseRuntimeContext,
      params,
    );

    return { requestPayload, baseRuntimeContext, runtimeContext };
  }

  // @plan:PLAN-20260617-COREAPI.P15
  // @requirement:REQ-001
  private _buildRuntimeContext(
    baseRuntimeContext: ProviderRuntimeContext,
    params: SendMessageParameters,
  ): ProviderRuntimeContext {
    // The runtime context's `config` MUST stay the live llxprt `Config`
    // class instance so provider-side resolution (ProviderManager
    // .resolveModelField -> config.getModel()) keeps working. buildRuntimeContext
    // only layers the per-request abortSignal onto metadata, leaving the Config
    // slot untouched (genai config and tools reach the provider via dedicated
    // channels: requestPayload.tools, metadata.abortSignal, params.config reads).
    return buildRuntimeContext(baseRuntimeContext, params);
  }

  private async _sendProviderRequest(
    provider: IProvider,
    requestPayload: { contents: IContent[]; tools: unknown },
    runtimeContext: ProviderRuntimeContext,
    baseRuntimeContext: ProviderRuntimeContext,
    params: SendMessageParameters,
    promptId: string,
    hookRestrictedAllowedTools: string[] | undefined,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    try {
      const userMemory = resolveUserMemory(baseRuntimeContext.config);
      const streamResponse = provider.generateChatCompletion({
        contents: requestPayload.contents,
        tools: requestPayload.tools as ProviderToolset | undefined,
        config: runtimeContext.config,
        runtime: runtimeContext,
        settings:
          runtimeContext.settingsService as GenerateChatOptions['settings'],
        metadata: {
          ...runtimeContext.metadata,
          abortSignal: params.config?.abortSignal,
        },
        userMemory,
      } as GenerateChatOptions);

      return await this._consumeFirstChunkAndReturn(
        streamResponse,
        requestPayload,
        promptId,
        startTime,
        hookRestrictedAllowedTools,
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
    hookRestrictedAllowedTools: string[] | undefined,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const convertedStream = this._convertIContentStream(
      streamResponse,
      requestPayload,
      { promptId, startTime },
      hookRestrictedAllowedTools,
    );

    const firstChunk = await convertedStream.next();

    if (firstChunk.done === true) {
      throw new EmptyStreamError(
        'Model stream ended immediately with no content.',
      );
    }

    return prependAsyncGenerator(firstChunk.value, convertedStream);
  }
  private _selectRequestTools(
    params: SendMessageParameters,
  ): GenerateContentConfig['tools'] {
    return selectRequestTools(params, this.generationConfig.tools);
  }

  private async _applyToolSelectionHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    tools: GenerateContentConfig['tools'],
  ): Promise<ToolSelectionHookResult> {
    if (configForHooks === undefined) {
      return { tools, allowedFunctionNames: undefined };
    }

    const getToolSelectionHooksEnabled = configForHooks.getEnableHooks;
    if (
      typeof getToolSelectionHooksEnabled !== 'function' ||
      getToolSelectionHooksEnabled.call(configForHooks) !== true
    ) {
      return { tools, allowedFunctionNames: undefined };
    }

    const getToolSelectionHookSystem = configForHooks.getHookSystem;
    const hookSystem =
      typeof getToolSelectionHookSystem === 'function'
        ? getToolSelectionHookSystem.call(configForHooks)
        : undefined;
    if (hookSystem === undefined) {
      return { tools, allowedFunctionNames: undefined };
    }

    await hookSystem.initialize();
    const toolsFromConfig = Array.isArray(tools)
      ? (tools as ToolGroupArray)
      : [];

    const toolSelectionResult =
      await hookSystem.fireBeforeToolSelectionEvent(toolsFromConfig);
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });

    const toolConfig = modifiedConfig?.toolConfig as unknown;
    const allowedFunctions = extractAllowedFunctionNames(toolConfig);
    if (allowedFunctions !== undefined) {
      const allowedNames = new Set(allowedFunctions.map(canonicalizeToolName));
      const filteredTools = toolsFromConfig
        .map((toolGroup) => ({
          ...toolGroup,
          functionDeclarations: Array.isArray(toolGroup.functionDeclarations)
            ? toolGroup.functionDeclarations.filter(
                (fn) =>
                  typeof fn.name === 'string' &&
                  allowedNames.has(canonicalizeToolName(fn.name)),
              )
            : [],
        }))
        .filter((g) => g.functionDeclarations.length > 0) as ToolGroupArray;
      return { tools: filteredTools, allowedFunctionNames: allowedFunctions };
    }

    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  }

  private _buildRequestContents(userContent: Content | Content[]): IContent[] {
    return buildRequestContents(
      userContent,
      this.conversationManager,
      this.historyService,
    );
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
    hookRestrictedAllowedTools?: string[],
  ): AsyncGenerator<GenerateContentResponse> {
    let lastConvertedChunk: GenerateContentResponse | undefined;

    for await (const iContent of streamResponse) {
      this._trackPromptTokens(iContent);

      const convertedChunk = attachHookRestrictedAllowedTools(
        convertIContentToResponse(iContent),
        hookRestrictedAllowedTools,
      );
      lastConvertedChunk = convertedChunk;

      const hookResult = await this._processAfterModelHook(
        iContent,
        llmRequest,
        convertedChunk,
        hookRestrictedAllowedTools,
      );

      if (hookResult.type === 'modified') {
        const restrictedResponse = attachHookRestrictedAllowedTools(
          hookResult.response,
          hookRestrictedAllowedTools,
        );
        lastConvertedChunk = restrictedResponse;
        yield restrictedResponse;
        continue;
      }

      yield convertedChunk;
    }

    this._logTelemetry(telemetryContext, lastConvertedChunk);
  }

  private _trackPromptTokens(iContent: IContent): void {
    trackPromptTokens(iContent, this.compressionHandler, this.logger);
  }

  private async _processAfterModelHook(
    iContent: IContent,
    llmRequest: Record<string, unknown> | undefined,
    convertedChunk: GenerateContentResponse,
    hookRestrictedAllowedTools: string[] | undefined,
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

    if (!hookSystem.isInitialized()) {
      await hookSystem.initialize();
    }
    const filteredContent = filterHookRestrictedContent(
      convertIContentToResponse(iContent).candidates?.[0]?.content ?? {
        role: 'model',
        parts: [],
      },
      hookRestrictedAllowedTools,
    );
    const afterModelResult = await hookSystem.fireAfterModelEvent(
      llmRequest ?? {},
      ContentConverters.toIContent(filteredContent),
    );

    if (afterModelResult?.shouldStopExecution() === true) {
      const effectiveReason = afterModelResult.getEffectiveReason() as
        | string
        | undefined;
      throw new AgentExecutionStoppedError(
        effectiveReason ?? 'Execution stopped by AfterModel hook',
        afterModelResult.systemMessage,
      );
    }

    if (afterModelResult?.isBlockingDecision() === true) {
      const modifiedResponse = afterModelResult.getModifiedResponse();
      const syntheticResponse = attachHookRestrictedAllowedTools(
        modifiedResponse ?? convertedChunk,
        hookRestrictedAllowedTools,
      );
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
      const filteredChunk = attachHookRestrictedAllowedTools(
        chunk,
        getHookRestrictedAllowedTools(chunk),
      );
      this._accumulateChunkMetadata(filteredChunk, acc, includeThoughts);
      yield filteredChunk;
    }

    await this._finalizeStreamProcessing(acc, userInput);
  }

  private _createStreamAccumulator(): StreamAccumulator {
    return createStreamAccumulator();
  }

  private _accumulateChunkMetadata(
    chunk: GenerateContentResponse,
    acc: StreamAccumulator,
    includeThoughts: boolean,
  ): void {
    accumulateChunkMetadata(
      chunk,
      acc,
      includeThoughts,
      this.logger,
      this.compressionHandler,
    );
  }

  private async _finalizeStreamProcessing(
    acc: {
      modelResponseParts: Part[];
      outcome: ResponseOutcome;
      finishReason: FinishReason | undefined;
      allChunks: GenerateContentResponse[];
    },
    userInput: Content | Content[],
  ): Promise<void> {
    const consolidatedParts = this._consolidateTextParts(
      acc.modelResponseParts,
    );
    const responseText = this._extractResponseText(consolidatedParts);

    if (isMissingFinishReason(acc.finishReason)) {
      this.logger.debug(
        () =>
          `[stream:terminal] stream ended without finishReason (hasToolCall=${String(acc.outcome.hasToolCalls)}, hasTextResponse=${String(acc.outcome.hasVisibleText)}, hasThinkingResponse=${String(acc.outcome.hasThinking)}, responseTextLength=${responseText.length})`,
      );
    } else {
      this.logger.debug(
        () => `[stream:terminal] finalized stream with finishReason`,
        {
          finishReason: acc.finishReason,
          hasToolCall: acc.outcome.hasToolCalls,
          hasTextResponse: acc.outcome.hasVisibleText,
          hasThinkingResponse: acc.outcome.hasThinking,
          responseTextLength: responseText.length,
          chunkCount: acc.allChunks.length,
        },
      );
    }

    this._validateStreamCompletion(
      userInput,
      acc.outcome,
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
    return consolidateTextParts(modelResponseParts);
  }

  /**
   * Extract response text from consolidated parts.
   */
  private _extractResponseText(consolidatedParts: Part[]): string {
    return extractResponseText(consolidatedParts);
  }

  /**
   * Validate stream completion and throw appropriate errors.
   */
  private _validateStreamCompletion(
    userInput: Content | Content[],
    outcome: ResponseOutcome,
    finishReason: FinishReason | undefined,
    responseText: string,
  ): void {
    validateStreamCompletion(
      userInput,
      outcome,
      finishReason,
      responseText,
      this.logger,
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
    await recordHistoryWithUsage({
      userInput,
      consolidatedParts,
      allChunks,
      conversationManager: this.conversationManager,
      historyService: this.historyService,
      compressionHandler: this.compressionHandler,
      logger: this.logger,
    });
  }

  /**
   * Enrich schema depth errors with diagnostic information.
   * Adapted from maybeIncludeSchemaDepthContext in chatSession.ts.
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
