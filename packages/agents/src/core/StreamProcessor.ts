/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindProviderMediaAndFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderMediaAndFiles.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { StreamOutputAccumulator } from './streamOutputAccumulator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { prependAsyncGenerator } from '@vybestack/llxprt-code-core/utils/asyncIterator.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { recordSendSeamTelemetry } from './tokenUsageEstimateLogger.js';
import { prepareAtSendSeam } from './promptEnvelopeSendSeam.js';
import { prepareStreamEnvelope } from './streamEnvelopePreparation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { logApiError } from './turnLogging.js';
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import {
  attachStreamTiming,
  logStreamTelemetry,
  RawTokenDeltaBridge,
  StreamTimingTracker,
} from './streamTelemetryLogger.js';
import {
  applyToolSelectionHook,
  buildRequestContentsResult,
  contentForTelemetryPreservingUsage,
  selectRequestTools,
  prepareRequestPayload,
  buildRuntimeContext,
  logOutgoingRequest,
  type ToolSelectionHookResult,
  type PreparedRequest,
} from './streamRequestHelpers.js';
import { fireBeforeModelHook } from './beforeModelHookFire.js';
import { trackPromptTokens } from './streamResponseHelpers.js';
import {
  afterModelModifiedToChunk,
  afterModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import type { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';

import { withCompressionCallbackCleanup } from './streamCleanup.js';
import { stampTurnIdentityOnInput } from './turnIdentity.js';
import { assertAdmittedRoute } from './admittedRouteSecurity.js';
import { buildStreamChatOptions } from './streamChatOptions.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import {
  admitStreamChunkForHistory,
  turnMediaAdmissionContext,
  type PreparedUserTurn,
} from './mediaAdmissionSeam.js';
import {
  failStreamProcessing,
  finalizeStreamResponse,
} from './streamResponseFinalizer.js';

function isPreparedUserTurn(
  value: IContent | IContent[] | PreparedUserTurn,
): value is PreparedUserTurn {
  return !Array.isArray(value) && 'userContents' in value;
}
export class StreamProcessor {
  private logger = new DebugLogger('llxprt:gemini:stream-processor');
  private eagerlyRecordedToolResponseCallIds = new Set<string>();
  private currentPromptEnvelopeEstimate: PromptEnvelopeEstimate | null = null;

  /** Canonical turn identity retained across retries for each logical prompt. */
  private readonly turnIdByPromptId = new Map<string, string>();
  private currentAttemptIndex = 0;

  /**
   * Raw token-delta bridge for the attempt in flight (#3493). Null when no
   * attempt is in flight; minted fresh per attempt at the retry boundary in
   * _executeStreamApiCall — where retryWithBackoff re-invokes the apiCall
   * closure — so an abandoned attempt's stream cannot feed the next
   * attempt's tracker. The sink rides request metadata, which the
   * providers layer treats as optional — an absent sink simply means "no raw
   * signal" and visible-chunk timing applies.
   */
  private currentRawTokenDeltaBridge: RawTokenDeltaBridge | null = null;

  getPromptEnvelopeEstimate(): PromptEnvelopeEstimate | null {
    return this.currentPromptEnvelopeEstimate;
  }

  rebindHistory(runtimeContext: AgentRuntimeContext): void {
    this.runtimeContext = runtimeContext;
    this.historyService = runtimeContext.history;
  }

  constructor(
    private runtimeContext: AgentRuntimeContext,
    private readonly conversationManager: ConversationManager,
    private readonly compressionHandler: CompressionHandler,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRequestCollaborators,
    private historyService: HistoryService,
    private readonly generationConfig: ChatSessionConfig,
  ) {}

  /** Tracks tool responses already recorded during eager client streaming. */
  markToolResponsesRecorded(callIds: readonly string[]): void {
    for (const callId of callIds) {
      if (typeof callId === 'string' && callId.length > 0) {
        this.eagerlyRecordedToolResponseCallIds.add(callId);
      }
    }
  }

  releasePromptTurnIdentity(promptId: string): void {
    this.turnIdByPromptId.delete(promptId);
  }

  /** Resolves the provider, sends the request with retry, and returns a response stream. */
  async makeApiCallAndProcessStream(
    params: SendMessageParams,
    promptId: string,
    userInput: IContent | IContent[] | PreparedUserTurn,
    attemptIndex?: number,
    semanticMediaPurge?: SemanticMediaPurgeAttempt,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    this.currentPromptEnvelopeEstimate = null;
    this.currentAttemptIndex = attemptIndex ?? 0;
    const provider =
      params.modelParameters?.route?.provider ??
      this.providerResolver('stream');

    const providerBaseUrl =
      params.modelParameters?.route?.baseURL ??
      this.runtimeContext.state.baseUrl;
    let prepared: PreparedUserTurn | undefined;
    let providerUserContent: IContent | IContent[];
    let historyUserContent: IContent | IContent[];
    if (isPreparedUserTurn(userInput)) {
      prepared = userInput;
      providerUserContent = userInput.userIContents;
      historyUserContent = userInput.userContents;
    } else {
      prepared = undefined;
      providerUserContent = userInput;
      historyUserContent = userInput;
    }
    const existingTurnId = (
      Array.isArray(providerUserContent)
        ? providerUserContent
        : [providerUserContent]
    ).find((content) => content.metadata?.turnId !== undefined)?.metadata
      ?.turnId;
    const turnId =
      prepared?.turnId ??
      existingTurnId ??
      this.turnIdByPromptId.get(promptId) ??
      this.historyService.generateTurnKey();
    this.turnIdByPromptId.set(promptId, turnId);
    const stampedUserContent = stampTurnIdentityOnInput(providerUserContent, {
      promptId,
      turnId,
    });

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
      stampedUserContent,
      provider,
      semanticMediaPurge,
    );

    return this._createCancellableStream(
      streamResponse,
      historyUserContent,
      prepared,
      semanticMediaPurge,
      turnId,
      params.recordingExecution?.historyOrigin,
    );
  }

  private _createCancellableStream(
    streamResponse: AsyncGenerator<ModelStreamChunk>,
    userContent: IContent | IContent[],
    prepared: PreparedUserTurn | undefined,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
    turnId: string,
    origin?: object,
  ): AsyncGenerator<ModelStreamChunk> {
    let processedStream: AsyncGenerator<ModelStreamChunk> | undefined;
    const ensureProcessedStream = (): AsyncGenerator<ModelStreamChunk> => {
      processedStream ??= this.processStreamResponse(
        streamResponse,
        userContent,
        semanticMediaPurge,
        turnId,
        prepared,
        origin,
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
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    let requestAttempt = 0;
    // retryWithBackoff re-invokes this closure once per attempt, so the
    // bridge is minted here: each attempt's sink closure stays pointed at
    // its own tracker even after a later attempt attaches its own (#3493).
    const apiCall = () => {
      if (requestAttempt > 0) semanticMediaPurge?.markRetryHandoff();
      requestAttempt += 1;
      this.currentRawTokenDeltaBridge = new RawTokenDeltaBridge();
      return this._buildAndSendStreamRequest(
        params,
        promptId,
        userContent,
        provider,
        semanticMediaPurge,
      );
    };

    return retryWithBackoff(apiCall, {
      onPersistent429: () =>
        this._handleBucketFailover(params.config?.abortSignal),
      signal: params.config?.abortSignal,
      shouldRetryOnError: (error) =>
        error instanceof EmptyStreamError ||
        (!isTerminalRetryError(error) && isRetryableError(error)),
    });
  }

  private _selectHookRequestTools(
    params: SendMessageParams,
  ): ReturnType<StreamProcessor['_applyToolSelectionHook']> {
    return this._applyToolSelectionHook(
      this._selectRequestTools(params),
      params.hookOwner ?? params.recordingExecution?.hookOwner,
    );
  }

  private _bindProviderMediaAndFiles(
    provider: IProvider,
    runtimeContext: ProviderRequestCollaborators,
  ): IProvider {
    return bindProviderMediaAndFiles(
      provider,
      runtimeContext.mediaResolver,
      runtimeContext.requestMediaBudgetBytes,
      runtimeContext.providerFileBindings,
      runtimeContext.providerFileLifecycle,
      runtimeContext.config?.getTargetDir(),
    );
  }

  private async _buildAndSendStreamRequest(
    params: SendMessageParams,
    promptId: string,
    userContent: IContent | IContent[],
    provider: IProvider,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    assertAdmittedRoute(params.modelParameters?.route);
    const { contents: requestContents, pending: pendingUserIContents } =
      this._buildRequestContents(userContent, semanticMediaPurge);

    const toolSelection = await this._selectHookRequestTools(params);
    const { requestPayload, baseRuntimeContext, runtimeContext } =
      this._prepareRequestPayload(requestContents, toolSelection, params);

    provider = this._bindProviderMediaAndFiles(provider, runtimeContext);

    try {
      const { contents: finalContents, pendingContents } =
        await fireBeforeModelHook({
          owner: params.hookOwner ?? params.recordingExecution?.hookOwner,
          requestContents: requestPayload.contents,
          pendingUserIContents,
          tools: toolSelection.tools ?? [],
          hookRestrictedAllowedTools: toolSelection.allowedFunctionNames,
          model: this.runtimeContext.state.model,
          log: (msg) => this.logger.debug(() => msg),
        });

      const streamPreparation = await prepareStreamEnvelope(
        provider,
        finalContents,
        pendingContents,
        (contents) =>
          buildStreamChatOptions(
            this.runtimeContext.prepareProviderInvocation,
            provider.name,
            promptId,
            { contents, tools: toolSelection.tools },
            runtimeContext.metadata,
            baseRuntimeContext,
            params,
            this.generationConfig,
            this.currentRawTokenDeltaBridge,
          ),
        this.compressionHandler,
        promptId,
        params.recordingExecution,
        params.modelParameters,
        this.runtimeContext.promptEstimator,
      );

      logOutgoingRequest(
        this.runtimeContext,
        { ...requestPayload, contents: streamPreparation.contents },
        this.runtimeContext.state.model,
        promptId,
      );

      const stream = await this._sendProviderRequest(
        provider,
        { ...requestPayload, contents: streamPreparation.contents },
        runtimeContext,
        baseRuntimeContext,
        params,
        promptId,
        toolSelection.allowedFunctionNames,
        streamPreparation.prepared,
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
  private _prepareRequestPayload(
    requestContents: IContent[],
    toolSelection: ToolSelectionHookResult,
    params: SendMessageParams,
  ): {
    requestPayload: PreparedRequest['requestPayload'];
    baseRuntimeContext: ProviderRequestCollaborators;
    runtimeContext: ProviderRequestCollaborators;
  } {
    const { requestPayload, baseRuntimeContext } = prepareRequestPayload({
      requestContents,
      tools: toolSelection.tools,
      logger: this.logger,
      providerRuntimeBuilder: (source, extras) =>
        this.providerRuntimeBuilder(source, {
          ...extras,
          conversationLogEmptyTools: toolSelection.conversationLogEmptyTools,
        }),
      providerName:
        params.modelParameters?.route?.provider.name ??
        this.providerResolver('stream').name,
      modelName:
        params.modelParameters?.route?.model ?? this.runtimeContext.state.model,
      baseUrl:
        params.modelParameters?.route?.baseURL ??
        this.runtimeContext.state.baseUrl,
    });

    const runtimeContext = buildRuntimeContext(baseRuntimeContext, params);

    return { requestPayload, baseRuntimeContext, runtimeContext };
  }

  // @plan:PLAN-20260617-COREAPI.P15
  // @requirement:REQ-001
  private async _sendProviderRequest(
    provider: IProvider,
    requestPayload: PreparedRequest['requestPayload'],
    runtimeContext: ProviderRequestCollaborators,
    baseRuntimeContext: ProviderRequestCollaborators,
    params: SendMessageParams,
    promptId: string,
    hookRestrictedAllowedTools: string[] | undefined,
    preparedAtEnforcement?: Awaited<ReturnType<typeof prepareAtSendSeam>>,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const startTime = Date.now();
    try {
      const chatOptions = buildStreamChatOptions(
        this.runtimeContext.prepareProviderInvocation,
        provider.name,
        promptId,
        requestPayload,
        runtimeContext.metadata,
        baseRuntimeContext,
        params,
        this.generationConfig,
        this.currentRawTokenDeltaBridge,
      );
      const prepared =
        preparedAtEnforcement ??
        (await prepareAtSendSeam(
          provider,
          chatOptions,
          this.runtimeContext.promptEstimator,
        ));
      this.currentPromptEnvelopeEstimate = prepared.estimate;
      recordSendSeamTelemetry({
        usageLogger: this.compressionHandler.tokenUsageLogger,
        promptId,
        estimate: prepared.estimate,
        runtimeState: this.runtimeContext.state,
        historyService: this.historyService,
        requestContents: requestPayload.contents,
        tools: requestPayload.tools,
        systemInstruction: this.generationConfig.systemInstruction,
        turnId: this.turnIdByPromptId.get(promptId) ?? null,
      });

      assertAdmittedRoute(params.modelParameters?.route);
      const streamResponse = provider.generateChatCompletion({
        ...prepared.options,
        requestDiagnostics: this.runtimeContext.requestDiagnostics,
      });
      // Captured explicitly (not read inside the generator below): a later
      // attempt replaces the instance field, and the explicit parameter is
      // what keeps this attempt's stream wired to this attempt's tracker.
      const rawTokenDeltaBridge = this.currentRawTokenDeltaBridge;

      return await this._consumeFirstChunkAndReturn(
        streamResponse,
        requestPayload,
        promptId,
        startTime,
        hookRestrictedAllowedTools,
        rawTokenDeltaBridge,
        params.hookOwner ?? params.recordingExecution?.hookOwner,
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
      this.currentPromptEnvelopeEstimate = null;
      throw error;
    }
  }

  /**
   * Eagerly consume first chunk within retry boundary (#1750).
   */
  private async _consumeFirstChunkAndReturn(
    streamResponse: AsyncIterable<IContent>,
    requestPayload: PreparedRequest['requestPayload'],
    promptId: string,
    startTime: number,
    hookRestrictedAllowedTools: string[] | undefined,
    rawTokenDeltaBridge: RawTokenDeltaBridge | null,
    owner?: HookExecutionOwner,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const convertedStream = this._convertIContentStream(
      streamResponse,
      requestPayload,
      { promptId, startTime, attemptIndex: this.currentAttemptIndex },
      hookRestrictedAllowedTools,
      rawTokenDeltaBridge,
      owner,
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
    tools: AgentClientGenerateConfig['tools'],
    owner?: HookExecutionOwner,
  ): Promise<ToolSelectionHookResult> {
    return applyToolSelectionHook(
      tools,
      this.runtimeContext.state.model,
      owner,
    );
  }

  private _buildRequestContents(
    userContent: IContent | IContent[],
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  ): {
    contents: IContent[];
    pending: IContent[];
  } {
    return buildRequestContentsResult(
      userContent,
      this.historyService,
      semanticMediaPurge?.requestHistory,
    );
  }

  private async _handleBucketFailover(
    signal: AbortSignal | undefined,
  ): Promise<boolean | null> {
    const failoverHandler =
      this.runtimeContext.providerRuntime.tryBucketFailover;
    if (!failoverHandler) return null;

    this.logger.debug(() => 'Attempting bucket failover on persistent 429');
    const success = await failoverHandler({ signal });
    if (success) {
      this.logger.debug(
        () =>
          `Bucket failover successful, new bucket: ${this.runtimeContext.providerRuntime.readCurrentBucket?.()}`,
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
    requestPayload?: PreparedRequest['requestPayload'],
    telemetryContext?: {
      promptId: string;
      startTime: number;
      attemptIndex?: number;
    },
    hookRestrictedAllowedTools?: string[],
    rawTokenDeltaBridge?: RawTokenDeltaBridge | null,
    owner?: HookExecutionOwner,
  ): AsyncGenerator<ModelStreamChunk> {
    let lastIContent: IContent | undefined;
    // Constructed at generator-body start (first pull — the provider call
    // boundary), so provider_request_ms covers the stream lifecycle alone
    // and excludes send-seam estimation (#3257).
    const timing = new StreamTimingTracker();
    // The provider stream is only iterated inside this generator body, so
    // attach always happens before any provider code can fire a raw delta.
    // A null bridge means no attempt context threaded a sink (#3493): the
    // tracker then runs on visible-chunk timing alone.
    rawTokenDeltaBridge?.attach(timing);

    // The caller iterates this generator after _sendProviderRequest returned,
    // so a mid-stream failure never re-enters its try/catch; clear the failed
    // attempt's estimate here so only a successful one stays observable.
    try {
      for await (const iContent of streamResponse) {
        timing.recordChunk(iContent);
        this._trackPromptTokens(iContent);
        const chunk = toModelStreamChunk(iContent);
        if (hookRestrictedAllowedTools !== undefined) {
          chunk.hookRestrictions = {
            allowedToolNames: [...hookRestrictedAllowedTools],
          };
        }
        const yieldedChunk =
          (await this._processAfterModelHook(
            iContent,
            requestPayload,
            chunk,
            hookRestrictedAllowedTools,
            owner,
          )) ?? chunk;
        lastIContent = contentForTelemetryPreservingUsage(
          yieldedChunk,
          lastIContent,
        );
        yield yieldedChunk;
      }
    } catch (error) {
      this.currentPromptEnvelopeEstimate = null;
      attachStreamTiming(
        this.compressionHandler.tokenUsageLogger,
        telemetryContext,
        timing.measure(),
      );
      throw error;
    }

    await logStreamTelemetry(
      this.runtimeContext,
      telemetryContext,
      lastIContent,
      this.compressionHandler.tokenUsageLogger,
      timing.measure(),
    );
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
    requestPayload: PreparedRequest['requestPayload'] | undefined,
    chunk: ModelStreamChunk,
    hookRestrictedAllowedTools: string[] | undefined,
    owner?: HookExecutionOwner,
  ): Promise<ModelStreamChunk | undefined> {
    if (owner?.afterModel === undefined) return undefined;

    // Build the hook-visible IContent with restricted tool blocks filtered.
    const filteredBlocks = filterHookRestrictedBlocks(
      iContent.blocks,
      hookRestrictedAllowedTools,
    );
    const hookIContent = iContentFromBlocks(filteredBlocks, iContent.speaker);

    const afterModelResult = await owner.afterModel(
      {
        model: this.runtimeContext.state.model,
        contents: requestPayload?.contents ?? [],
        ...(requestPayload?.tools !== undefined &&
        (requestPayload.tools.length > 0 ||
          hookRestrictedAllowedTools === undefined)
          ? {
              tools: requestPayload.tools,
            }
          : {}),
      },
      {
        content: hookIContent,
        // finishReason/rawStopReason live only on terminal chunks; toModelStreamChunk
        // already lifted them onto the chunk when the provider emitted them.
        ...(chunk.finishReason !== undefined
          ? { finishReason: chunk.finishReason }
          : {}),
        ...(chunk.rawStopReason !== undefined
          ? { rawStopReason: chunk.rawStopReason }
          : {}),
        ...(chunk.usage !== undefined ? { usage: chunk.usage } : {}),
      },
      owner.signal,
    );

    if (afterModelResult?.shouldStopExecution() === true) {
      throw new AgentExecutionStoppedError(
        afterModelResult.getEffectiveReason(),
        afterModelResult.systemMessage,
      );
    }

    if (afterModelResult?.isBlockingDecision() === true) {
      this._throwAfterModelBlocked(afterModelResult, chunk);
    }

    // MODIFY branch: convert hook's response to neutral chunk.
    const modifiedResponse = afterModelResult?.getModifiedResponse();
    if (modifiedResponse) {
      return afterModelModifiedToChunk(modifiedResponse, chunk);
    }

    return undefined;
  }

  /**
   * BLOCK branch of the AfterModel hook: build a ModelOutput from the
   * hook-modified response or the current chunk, carry the block reason
   * text, and throw AgentExecutionBlockedError.
   *
   * P13: neutral — no synthetic GenerateContentResponse is built here.
   */
  private _throwAfterModelBlocked(
    afterModelResult: AfterModelHookOutput,
    chunk: ModelStreamChunk,
  ): never {
    const effectiveReason = afterModelResult.getEffectiveReason();
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
      effectiveReason,
      finalBlockedOutput,
      afterModelResult.systemMessage,
    );
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
    semanticMediaPurge?: SemanticMediaPurgeAttempt,
    capturedTurnId?: string,
    preparedUserTurn?: PreparedUserTurn,
    origin?: object,
  ): AsyncGenerator<ModelStreamChunk> {
    const includeThoughts =
      this.runtimeContext.ephemerals.reasoning.includeInContext();
    const turnId = capturedTurnId ?? this.historyService.generateTurnKey();

    const accumulator = new StreamOutputAccumulator();
    const admissions: MediaAdmissionRelease[] = [];
    let finalized = false;
    let failureCleanupStarted = false;
    try {
      for await (const chunk of streamResponse) {
        const allowedToolNames = chunk.hookRestrictions?.allowedToolNames;
        const filteredContent: IContent = {
          ...chunk.content,
          blocks: filterHookRestrictedBlocks(
            chunk.content.blocks,
            allowedToolNames,
          ),
        };
        const historyChunk = await admitStreamChunkForHistory(
          this.runtimeContext,
          chunk,
          filteredContent,
          turnId,
        );
        admissions.push({
          contents: [historyChunk.content],
          context: turnMediaAdmissionContext(turnId, 'provider-stream-output'),
          mode: 'content',
        });
        if (historyChunk.afcHistory !== undefined) {
          admissions.push({
            contents: historyChunk.afcHistory,
            context: turnMediaAdmissionContext(
              turnId,
              'provider-stream-afc-history',
            ),
            mode: 'contents',
          });
        }
        accumulator.add(historyChunk);
        yield { ...chunk, content: filteredContent };
      }
      await this._finalizeStreamProcessing(
        accumulator.materialize(),
        userInput,
        includeThoughts,
        semanticMediaPurge,
        preparedUserTurn,
        admissions,
        origin,
      );
      finalized = true;
    } catch (error: unknown) {
      failureCleanupStarted = true;
      await failStreamProcessing(error, admissions, this.runtimeContext);
    } finally {
      if (!finalized && !failureCleanupStarted) {
        await this.runtimeContext.mediaAdmission?.releaseAdmissions(admissions);
      }
    }
  }

  private _finalizeStreamProcessing(
    acc: ModelOutput,
    userInput: IContent | IContent[],
    includeThoughts: boolean,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
    preparedUserTurn: PreparedUserTurn | undefined,
    mediaAdmissions: readonly MediaAdmissionRelease[],
    origin?: object,
  ): Promise<void> {
    return finalizeStreamResponse({
      origin,
      logger: this.logger,
      conversationManager: this.conversationManager,
      historyService: this.historyService,
      compressionHandler: this.compressionHandler,
      runtimeContext: this.runtimeContext,
      accumulated: acc,
      userInput,
      includeThoughts,
      semanticMediaPurge,
      retryHandoff: this.currentAttemptIndex > 0,
      eagerlyRecordedToolResponseCallIds:
        this.eagerlyRecordedToolResponseCallIds,
      preparedUserTurn,
      mediaAdmissions,
    });
  }
}
