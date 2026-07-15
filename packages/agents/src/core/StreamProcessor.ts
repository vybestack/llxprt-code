/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SendMessageParams } from './chatSession.js';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  emptyModelOutput,
  accumulateModelStreamChunk,
  toModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { prependAsyncGenerator } from '@vybestack/llxprt-code-core/utils/asyncIterator.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset as ProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { logApiResponse, logApiError } from './turnLogging.js';
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';
import {
  extractResponseTextFromBlocks,
  analyzeBlocksOutcome,
  validateStreamCompletion,
  recordHistoryWithUsage,
} from './streamValidationHelpers.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import { canonicalizeToolName } from './toolGovernance.js';
import {
  buildRequestContentsResult,
  selectRequestTools,
  prepareRequestPayload,
  buildRuntimeContext,
  applyRequestModifications,
  resolveUserMemory,
  logOutgoingRequest,
  extractSystemInstructionText,
  type ToolGroupArray,
  type ToolSelectionHookResult,
} from './streamRequestHelpers.js';
import {
  resolvePendingBoundaryFromHook,
  snapshotContents,
  type ProjectionSnapshot,
} from './boundaryRecovery.js';
import { enforceBeforeModelHookDecision } from './beforeModelHookDecision.js';
import {
  trackPromptTokens,
  isMissingFinishReason,
  prepareHistoryUserInput,
  clearMatchedEagerToolResponseCallIds,
} from './streamResponseHelpers.js';
import {
  afterModelModifiedToChunk,
  afterModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';

import { withCompressionCallbackCleanup } from './streamCleanup.js';

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

/** Result of firing the BeforeModel hook (contents + metadata + pre-hook snapshot). */
interface BeforeModelHookFireResult {
  contents: IContent[];
  hookOutput: BeforeModelHookOutput | undefined;
  snapshot: ProjectionSnapshot | undefined;
}

export class StreamProcessor {
  private logger = new DebugLogger('llxprt:gemini:stream-processor');
  private eagerlyRecordedToolResponseCallIds = new Set<string>();

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
    private readonly generationConfig: AgentClientGenerateConfig,
    private readonly flushAuthScope: typeof flushRuntimeAuthScope = flushRuntimeAuthScope,
  ) {}

  /** Tracks tool responses already recorded during eager client streaming. */
  markToolResponsesRecorded(callIds: readonly string[]): void {
    for (const callId of callIds) {
      if (typeof callId === 'string' && callId.length > 0) {
        this.eagerlyRecordedToolResponseCallIds.add(callId);
      }
    }
  }

  /** Resolves the provider, sends the request with retry, and returns a response stream. */
  async makeApiCallAndProcessStream(
    params: SendMessageParams,
    promptId: string,
    userContent: IContent | IContent[],
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
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
    streamResponse: AsyncGenerator<ModelStreamChunk>,
    userContent: IContent | IContent[],
  ): AsyncGenerator<ModelStreamChunk> {
    let processedStream: AsyncGenerator<ModelStreamChunk> | undefined;
    const ensureProcessedStream = (): AsyncGenerator<ModelStreamChunk> => {
      processedStream ??= this.processStreamResponse(
        streamResponse,
        userContent,
      );
      return processedStream;
    };

    const cancellableStream = {
      async next(value?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
        return ensureProcessedStream().next(value);
      },
      async return(value?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
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
      async throw(error?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
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
      [Symbol.asyncIterator](): AsyncGenerator<ModelStreamChunk> {
        return this as AsyncGenerator<ModelStreamChunk>;
      },
    };

    return cancellableStream as AsyncGenerator<ModelStreamChunk>;
  }

  /**
   * Execute the stream API call with retry and bucket failover.
   * Split from makeApiCallAndProcessStream to keep methods under 80 lines.
   */
  private async _executeStreamApiCall(
    params: SendMessageParams,
    promptId: string,
    userContent: IContent | IContent[],
    provider: IProvider,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const apiCall = () =>
      this._buildAndSendStreamRequest(params, promptId, userContent, provider);

    return retryWithBackoff(apiCall, {
      onPersistent429: () =>
        this._handleBucketFailover(params.config?.abortSignal),
      signal: params.config?.abortSignal,
      shouldRetryOnError: (error) =>
        error instanceof EmptyStreamError ||
        (!isTerminalRetryError(error) && isRetryableError(error)),
    });
  }

  private async _buildAndSendStreamRequest(
    params: SendMessageParams,
    promptId: string,
    userContent: IContent | IContent[],
    provider: IProvider,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const { contents: requestContents, pending: pendingUserIContents } =
      this._buildRequestContents(userContent);

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
      const originalContents = requestPayload.contents;
      const {
        contents: finalContents,
        hookOutput,
        snapshot,
      } = await this._fireBeforeModelHook(
        configForHooks,
        originalContents,
        tools as ProviderToolset | undefined,
        toolSelection.allowedFunctionNames,
      );
      const pendingContents = resolvePendingBoundaryFromHook(
        originalContents,
        finalContents,
        pendingUserIContents,
        hookOutput,
        (msg) => this.logger.debug(() => msg),
        snapshot,
      );

      requestPayload.contents =
        await this.compressionHandler.enforceProviderContents(
          {
            contents: finalContents,
            pendingContents,
          },
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
      return withCompressionCallbackCleanup(
        stream,
        provider,
        this.compressionHandler,
        params.config?.abortSignal,
      );
    } catch (error) {
      this.compressionHandler.clearProviderCompressionCallback(provider);
      throw error;
    }
  }

  /**
   * Fire BeforeModel hook; return contents, hook output, and a pre-hook
   * snapshot (captured only when hooks fire — G1). Throws on stop/block.
   */
  private async _fireBeforeModelHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    requestContents: IContent[],
    tools: ProviderToolset | undefined,
    hookRestrictedAllowedTools: string[] | undefined,
  ): Promise<BeforeModelHookFireResult> {
    // Zero-overhead early return when hooks disabled / no hook system: no
    // snapshot (differential recovery falls back to reference equality).
    const passthrough = (): BeforeModelHookFireResult => ({
      contents: requestContents,
      hookOutput: undefined,
      snapshot: undefined,
    });
    if (
      configForHooks === undefined ||
      typeof configForHooks.getEnableHooks !== 'function' ||
      configForHooks.getEnableHooks() !== true
    ) {
      return passthrough();
    }
    const hookSystem =
      typeof configForHooks.getHookSystem === 'function'
        ? configForHooks.getHookSystem()
        : undefined;
    if (hookSystem === undefined) return passthrough();

    await hookSystem.initialize();
    // Capture a projection snapshot BEFORE firing the hook so in-place
    // mutations (hooks that mutate the live array/elements and return no
    // llm_request) are detected by differential recovery (G1, issue #2306).
    const snapshot = snapshotContents(requestContents);
    const beforeModelResult = await hookSystem.fireBeforeModelEvent({
      contents: requestContents,
      tools,
    });

    enforceBeforeModelHookDecision(
      beforeModelResult,
      hookRestrictedAllowedTools,
    );

    const contents = this._applyRequestModifications(
      beforeModelResult,
      requestContents,
    );
    return { contents, hookOutput: beforeModelResult ?? undefined, snapshot };
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
    tools: AgentClientGenerateConfig['tools'],
    params: SendMessageParams,
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
    params: SendMessageParams,
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
    params: SendMessageParams,
    promptId: string,
    hookRestrictedAllowedTools: string[] | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const startTime = Date.now();
    try {
      const userMemory = resolveUserMemory(baseRuntimeContext.config);
      const streamResponse = provider.generateChatCompletion({
        contents: requestPayload.contents,
        tools: requestPayload.tools as ProviderToolset | undefined,
        config: runtimeContext.config,
        runtime: runtimeContext,
        onProviderError: params.config?.onProviderError,
        settings:
          runtimeContext.settingsService as GenerateChatOptions['settings'],
        metadata: {
          ...runtimeContext.metadata,
          abortSignal: params.config?.abortSignal,
          _retryRequestContext: params.config?.providerRequestContext,
        },
        userMemory,
        systemInstruction: extractSystemInstructionText(
          this.generationConfig.systemInstruction,
        ),
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
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
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
    params: SendMessageParams,
  ): AgentClientGenerateConfig['tools'] {
    return selectRequestTools(params, this.generationConfig.tools);
  }

  private async _applyToolSelectionHook(
    configForHooks: AgentRuntimeContext['providerRuntime']['config'],
    tools: AgentClientGenerateConfig['tools'],
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

  private _buildRequestContents(userContent: IContent | IContent[]): {
    contents: IContent[];
    pending: IContent[];
  } {
    return buildRequestContentsResult(userContent, this.historyService);
  }

  private async _handleBucketFailover(
    signal: AbortSignal | undefined,
  ): Promise<boolean | null> {
    const failoverHandler =
      this.runtimeContext.providerRuntime.config?.getBucketFailoverHandler();
    if (!failoverHandler) return null;

    this.logger.debug(() => 'Attempting bucket failover on persistent 429');
    const success = await failoverHandler.tryFailover({ signal });
    if (success) {
      const runtimeId =
        this.runtimeContext.providerRuntime.runtimeId ??
        this.runtimeContext.state.runtimeId;
      if (typeof runtimeId === 'string' && runtimeId.trim() !== '') {
        this.flushAuthScope(runtimeId);
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
   * Convert IContent stream to ModelStreamChunk stream.
   * Tracks token usage metadata from IContent format.
   * Triggers AfterModel hook per streamed chunk.
   *
   * @plan PLAN-20260707-AGENTNEUTRAL.P07 — neutral streaming pipeline
   */
  private async *_convertIContentStream(
    streamResponse: AsyncIterable<IContent>,
    llmRequest?: Record<string, unknown>,
    telemetryContext?: { promptId: string; startTime: number },
    hookRestrictedAllowedTools?: string[],
  ): AsyncGenerator<ModelStreamChunk> {
    let lastIContent: IContent | undefined;

    for await (const iContent of streamResponse) {
      this._trackPromptTokens(iContent);

      const chunk = toModelStreamChunk(iContent);

      // Stamp hook restrictions onto the chunk so downstream consumers
      // (Turn) can filter blocks without object-identity WeakMap lookups.
      if (hookRestrictedAllowedTools !== undefined) {
        chunk.hookRestrictions = {
          allowedToolNames: [...hookRestrictedAllowedTools],
        };
      }

      const modifiedChunk = await this._processAfterModelHook(
        iContent,
        llmRequest,
        chunk,
        hookRestrictedAllowedTools,
      );
      const yieldedChunk = modifiedChunk ?? chunk;
      lastIContent = this._contentForTelemetry(yieldedChunk);
      yield yieldedChunk;
    }

    this._logTelemetry(telemetryContext, lastIContent);
  }

  private _trackPromptTokens(iContent: IContent): void {
    trackPromptTokens(iContent, this.compressionHandler, this.logger);
  }

  /**
   * Process AfterModel hook for a single streamed chunk.
   *
   * Returns a neutral ModelStreamChunk when the hook modifies the response,
   * or `undefined` for passthrough (yield the original chunk).
   *
   * Throws AgentExecutionStoppedError / AgentExecutionBlockedError on
   * stop/block decisions.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-002.6
   */
  private async _processAfterModelHook(
    iContent: IContent,
    llmRequest: Record<string, unknown> | undefined,
    chunk: ModelStreamChunk,
    hookRestrictedAllowedTools: string[] | undefined,
  ): Promise<ModelStreamChunk | undefined> {
    const hookConfig = this.runtimeContext.providerRuntime.config;
    if (
      hookConfig === undefined ||
      typeof hookConfig.getEnableHooks !== 'function' ||
      hookConfig.getEnableHooks() !== true
    ) {
      return undefined;
    }

    const hookSystem =
      typeof hookConfig.getHookSystem === 'function'
        ? hookConfig.getHookSystem()
        : undefined;
    if (hookSystem === undefined) return undefined;

    if (!hookSystem.isInitialized()) {
      await hookSystem.initialize();
    }

    // Build the hook-visible IContent with restricted tool blocks filtered.
    const filteredBlocks = filterHookRestrictedBlocks(
      iContent.blocks,
      hookRestrictedAllowedTools,
    );
    const hookIContent = iContentFromBlocks(filteredBlocks, iContent.speaker);

    const afterModelResult = await hookSystem.fireAfterModelEvent(
      llmRequest ?? {},
      hookIContent,
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
      const effectiveReason = afterModelResult.getEffectiveReason() as
        | string
        | undefined;
      // P13: BLOCK branch now neutral — build a ModelOutput from the
      // hook-modified response or the current chunk, carrying the block
      // reason text. No synthetic GenerateContentResponse.
      const modifiedResponse = afterModelResult.getModifiedResponse();
      const blockedOutput: ModelOutput = modifiedResponse
        ? (afterModelModifiedToChunk(modifiedResponse, chunk) ?? { ...chunk })
        : { ...chunk };
      // P13: Use the neutral blocking adapter for the block reason text.
      const finalBlockedOutput = afterModelBlockingToModelOutput(
        effectiveReason,
        blockedOutput,
      );
      throw new AgentExecutionBlockedError(
        effectiveReason ?? 'Execution blocked by AfterModel hook',
        finalBlockedOutput,
        afterModelResult.systemMessage,
      );
    }

    // MODIFY branch: convert hook's response to neutral chunk.
    const modifiedResponse = afterModelResult?.getModifiedResponse();
    if (modifiedResponse) {
      return afterModelModifiedToChunk(modifiedResponse, chunk);
    }

    return undefined;
  }

  private _contentForTelemetry(chunk: ModelStreamChunk): IContent {
    if (chunk.usage === undefined) {
      return chunk.content;
    }
    return {
      ...chunk.content,
      metadata: {
        ...(chunk.content.metadata ?? {}),
        usage: chunk.usage,
      },
    };
  }

  private _logTelemetry(
    telemetryContext: { promptId: string; startTime: number } | undefined,
    lastIContent: IContent | undefined,
  ): void {
    if (telemetryContext && lastIContent) {
      const durationMs = Date.now() - telemetryContext.startTime;
      const usage = lastIContent.metadata?.usage;
      logApiResponse(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        telemetryContext.promptId,
        durationMs,
        usage ? { ...usage } : undefined,
        JSON.stringify(lastIContent),
      );
    }
  }

  /**
   * Process streaming response chunks into a complete conversation turn.
   *
   * CRITICAL: yield chunks inline during the for-await loop. Collecting all
   * chunks first blocks user output, abort checks, and stalled provider streams.
   * See issue #1846.
   *
   * @plan PLAN-20260707-AGENTNEUTRAL.P07 — accumulates neutral ModelStreamChunk
   */
  async *processStreamResponse(
    streamResponse: AsyncGenerator<ModelStreamChunk>,
    userInput: IContent | IContent[],
  ): AsyncGenerator<ModelStreamChunk> {
    let acc = emptyModelOutput();
    const includeThoughts =
      this.runtimeContext.ephemerals.reasoning.includeInContext();

    for await (const chunk of streamResponse) {
      // Apply hook restrictions from the chunk's hookRestrictions field
      const allowedToolNames = chunk.hookRestrictions?.allowedToolNames;
      const filteredChunk: ModelStreamChunk = {
        ...chunk,
        content: {
          ...chunk.content,
          blocks: filterHookRestrictedBlocks(
            chunk.content.blocks,
            allowedToolNames,
          ),
        },
      };
      acc = accumulateModelStreamChunk(acc, filteredChunk);
      yield filteredChunk;
    }

    await this._finalizeStreamProcessing(acc, userInput, includeThoughts);
  }

  private async _finalizeStreamProcessing(
    acc: ModelOutput,
    userInput: IContent | IContent[],
    includeThoughts: boolean,
  ): Promise<void> {
    const finishReason = acc.finishReason;
    const responseText = extractResponseTextFromBlocks(acc.content.blocks);
    const outcome = analyzeBlocksOutcome(acc.content.blocks, includeThoughts);

    if (isMissingFinishReason(finishReason)) {
      this.logger.debug(
        () =>
          `[stream:terminal] stream ended without finishReason (hasToolCall=${String(outcome.hasToolCalls)}, hasTextResponse=${String(outcome.hasVisibleText)}, hasThinkingResponse=${String(outcome.hasThinking)}, responseTextLength=${responseText.length})`,
      );
    } else {
      this.logger.debug(
        () => `[stream:terminal] finalized stream with finishReason`,
        {
          finishReason,
          hasToolCall: outcome.hasToolCalls,
          hasTextResponse: outcome.hasVisibleText,
          hasThinkingResponse: outcome.hasThinking,
          responseTextLength: responseText.length,
        },
      );
    }

    validateStreamCompletion(
      this.logger,
      userInput,
      outcome,
      finishReason,
      responseText,
      acc.rawStopReason,
    );

    const preparedHistoryUserInput = prepareHistoryUserInput(
      userInput,
      this.eagerlyRecordedToolResponseCallIds,
    );

    if (acc.afcHistory !== undefined) {
      acc.afcHistory = acc.afcHistory.filter(
        (content: IContent) => content.blocks.length > 0,
      );
    }

    try {
      await recordHistoryWithUsage(
        this.logger,
        this.conversationManager,
        this.historyService,
        this.compressionHandler,
        this.runtimeContext,
        preparedHistoryUserInput.historyUserInput,
        acc,
        preparedHistoryUserInput.userInputFlags,
      );
    } finally {
      clearMatchedEagerToolResponseCallIds(
        preparedHistoryUserInput.filteredResults,
        this.eagerlyRecordedToolResponseCallIds,
      );
    }
  }
}
