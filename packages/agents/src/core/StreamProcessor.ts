import {
  type DumpAttemptContext,
  type ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ModelOutput,
  ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { bindProviderMediaAndFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderMediaAndFiles.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import { StreamOutputAccumulator } from './streamOutputAccumulator.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import { fireBeforeModelHook } from './beforeModelHookFire.js';
import type { ConversationManager } from './ConversationManager.js';
import {
  admitRefusalAuditChunk,
  recordToolResponses,
  releasePromptTurnIdentity,
} from './streamRefusalAuditBoundary.js';
import { processAfterModelHook } from './streamAfterModelHook.js';
import { RefusalDumpPairing } from './refusalDumpPairing.js';
import { prepareAtSendSeam } from './promptEnvelopeSendSeam.js';
import { prepareStreamEnvelope } from './streamEnvelopePreparation.js';
import {
  applyToolSelectionHook,
  buildRequestContentsResult,
  buildRuntimeContext,
  contentForTelemetryPreservingUsage,
  preserveProviderDiagnosticsAfterHook,
  logOutgoingRequest,
  prepareRequestPayload,
  selectRequestTools,
  type PreparedRequest,
  type ToolSelectionHookResult,
} from './streamRequestHelpers.js';
import {
  consumeFirstChunkAndReturn,
  createDumpIdChunk,
  stripProviderAttemptDiagnostics,
  trackPromptTokens,
} from './streamResponseHelpers.js';
import type {
  ProviderReadyRequest,
  SendRequestState,
} from './sendRequestState.js';
import {
  accumulateStreamFinishInfo,
  attachStreamTiming,
  beginTokenUsageAttempt,
  logStreamTelemetry,
  startAttemptTiming,
  type RawTokenDeltaBridge,
  type StreamFinishInfo,
} from './streamTelemetryLogger.js';
import { captureSendBoundaryAudit } from './sendBoundaryAudit.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';
import { logApiError, turnTelemetryPorts } from './turnLogging.js';

import { assertAdmittedRoute } from './admittedRouteSecurity.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import { createCancellableStream } from './cancellableStream.js';
import { replayOptions, snapshotSentOptions } from './requestReplay.js';
import { buildStreamChatOptions } from './streamChatOptions.js';
import { withCompressionCallbackCleanup } from './streamCleanup.js';
import {
  failStreamProcessing,
  finalizeStreamResponse,
} from './streamResponseFinalizer.js';
import {
  mediaAdmissionPort,
  reasoningInclusionPolicy,
} from './runtimePorts.js';
import { stampTurnIdentityOnInput } from './turnIdentity.js';
import { resolveStreamUserInput } from './streamUserInput.js';
import { throwIfRefused } from '../refusal/refusalDetection.js';
import { RefusalStreamAudit } from '../refusal/refusalStreamAudit.js';
import type { RefusalContextFingerprint } from '../refusal/refusalAudit.js';

export class StreamProcessor {
  private logger = new DebugLogger('llxprt:gemini:stream-processor');

  private turnTelemetryPorts() {
    return turnTelemetryPorts(this.ports.state, this.ports.telemetry);
  }
  private eagerlyRecordedToolResponseCallIds = new Set<string>();
  private currentPromptEnvelopeEstimate: PromptEnvelopeEstimate | null = null;
  private readonly refusalStreamAudit: RefusalStreamAudit;
  private readonly releaseCompressionAuditListener: () => void;
  private currentContextFingerprint: RefusalContextFingerprint | undefined;

  /** Canonical turn identity retained across retries for each logical prompt. */
  private readonly turnIdByPromptId = new Map<string, string>();
  private readonly refusalDumpPairing = new RefusalDumpPairing(
    () => this.currentAttemptIndex,
  );
  private currentAttemptIndex = 0;
  /** Whether the attempt in flight resends an earlier attempt of its send. */
  private currentIsResend = false;

  /**
   * Raw token-delta bridge for the attempt in flight (#3493). Null when no
   * attempt is in flight or the attempt's token-usage level is `off`
   * (#4068); minted fresh per attempt at the retry boundary in
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

  rebindHistory(
    ports: StreamProcessorRuntime,
    providerFileBindings: ProviderFileBindingStore,
  ): void {
    this.ports = ports;
    this.historyService = ports.history;
    this.providerFileBindings = providerFileBindings;
    this.refusalStreamAudit.rebind();
  }

  constructor(
    private ports: StreamProcessorRuntime,
    private readonly config: Config | undefined,
    private readonly mediaResolver: RequestMediaResolutionService | undefined,
    private readonly requestMediaBudgetBytes: number | undefined,
    private providerFileBindings: ProviderFileBindingStore | undefined,
    private readonly providerFileLifecycle: ProviderFileLifecycle | undefined,
    private readonly tryBucketFailover: ProviderRetryOperations['tryBucketFailover'],
    private readonly readCurrentBucket: ProviderRetryOperations['readCurrentBucket'],
    private readonly conversationManager: ConversationManager,
    private readonly compressionHandler: CompressionHandler,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRequestCollaborators,
    private historyService: HistoryService,
    private readonly generationConfig: ChatSessionConfig,
  ) {
    this.refusalStreamAudit = new RefusalStreamAudit();
    this.releaseCompressionAuditListener =
      this.compressionHandler.setCompressionAuditListener((provenance) =>
        this.refusalStreamAudit.recordCompression(provenance),
      );
  }

  /** Tracks tool responses already recorded during eager client streaming. */
  private _finalizeStreamProcessing(
    accumulated: ModelOutput,
    options: Omit<Parameters<typeof finalizeStreamResponse>[0], 'accumulated'>,
  ): Promise<void> {
    return finalizeStreamResponse({ ...options, accumulated });
  }

  markToolResponsesRecorded(callIds: readonly string[]): void {
    recordToolResponses(this.eagerlyRecordedToolResponseCallIds, callIds);
  }

  releasePromptTurnIdentity(promptId: string): void {
    releasePromptTurnIdentity(this.turnIdByPromptId, promptId);
  }

  resetRefusalContextBaseline(): void {
    this.refusalStreamAudit.resetBaseline();
  }

  dispose(): void {
    this.releaseCompressionAuditListener();
    this.refusalStreamAudit.dispose();
  }

  /** Resolves the provider, sends the request with retry, and returns a response stream. */
  async makeApiCallAndProcessStream(
    params: SendMessageParams,
    promptId: string,
    userInput: IContent | IContent[] | PreparedUserTurn,
    attemptIndex?: number,
    semanticMediaPurge?: SemanticMediaPurgeAttempt,
    sendState?: SendRequestState,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    this.currentPromptEnvelopeEstimate = null;
    this.currentAttemptIndex = attemptIndex ?? 0;
    this.currentIsResend = sendState?.begin() ?? this.currentAttemptIndex > 0;
    const provider =
      params.modelParameters?.route?.provider ??
      this.providerResolver('stream');

    const providerBaseUrl =
      params.modelParameters?.route?.baseURL ?? this.ports.state.baseUrl;
    const {
      prepared,
      providerUserContent,
      historyUserContent,
      establishedTurnId,
    } = resolveStreamUserInput(userInput);
    const turnId =
      establishedTurnId ??
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
        configModel: this.ports.state.model,
        baseUrl: providerBaseUrl,
      },
    );

    // Check if provider supports IContent interface
    if (typeof provider.generateChatCompletion !== 'function') {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }

    this.currentContextFingerprint = undefined;
    const streamResponse = await this._executeStreamApiCall(
      params,
      promptId,
      stampedUserContent,
      provider,
      semanticMediaPurge,
      sendState,
    );

    const origin = params.recordingExecution?.historyOrigin;
    const sentAttemptIndex = this.currentAttemptIndex;
    const contextFingerprint = this.currentContextFingerprint;
    return createCancellableStream(streamResponse, () =>
      this.processStreamResponse(
        streamResponse,
        historyUserContent,
        semanticMediaPurge,
        turnId,
        prepared,
        origin,
        contextFingerprint,
        promptId,
        sentAttemptIndex,
        params.config?.abortSignal,
        sendState,
      ),
    );
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
    sendState: SendRequestState | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    let requestAttempt = 0;
    // retryWithBackoff re-invokes this closure once per attempt, so the
    // bridge is minted here: each attempt's sink closure stays pointed at
    // its own tracker even after a later attempt attaches its own (#3493).
    // This is also the attempt's request boundary for the live token-usage
    // level (#4068); an unlogged attempt gets no bridge.
    const apiCall = () => {
      if (requestAttempt++ > 0) semanticMediaPurge?.markRetryHandoff();
      this.currentRawTokenDeltaBridge = beginTokenUsageAttempt(
        this.compressionHandler.tokenUsageLogger,
      );
      const kept = sendState?.replayable();
      if (kept !== undefined) {
        return this._resendKeptRequest(
          provider,
          kept,
          params,
          promptId,
          sendState,
        );
      }
      return this._buildAndSendStreamRequest(
        params,
        promptId,
        userContent,
        provider,
        semanticMediaPurge,
        sendState,
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
  ): Promise<ToolSelectionHookResult> {
    return this._applyToolSelectionHook(
      selectRequestTools(params, this.generationConfig.tools),
      params.hookOwner ?? params.recordingExecution?.hookOwner,
    );
  }

  private _bindProviderMediaAndFiles(provider: IProvider): IProvider {
    return bindProviderMediaAndFiles(
      provider,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      this.config?.getTargetDir(),
    );
  }

  private async _buildAndSendStreamRequest(
    params: SendMessageParams,
    promptId: string,
    userContent: IContent | IContent[],
    provider: IProvider,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
    sendState: SendRequestState | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const dumpAttemptContext = this.refusalDumpPairing.createAttempt(promptId);
    const requestDraft = this._buildContents(userContent, semanticMediaPurge);
    const toolSelection = await this._selectHookRequestTools(params);
    const { requestPayload, runtimeContext } = this._prepareRequestPayload(
      requestDraft.contents,
      toolSelection,
      params,
    );

    provider = this._bindProviderMediaAndFiles(provider);

    try {
      const { contents: finalContents, ...pendingRegion } =
        await this._fireBeforeModel(
          params,
          requestPayload.contents,
          requestDraft.pending,
          toolSelection,
        );

      const streamPreparation = await prepareStreamEnvelope(
        provider,
        finalContents,
        pendingRegion,
        (contents) =>
          buildStreamChatOptions(
            this.ports.prepareProviderInvocation,
            provider.name,
            promptId,
            { contents, tools: toolSelection.tools },
            runtimeContext.metadata,
            params,
            this.generationConfig,
            this.currentRawTokenDeltaBridge,
            dumpAttemptContext,
          ),
        this.compressionHandler,
        promptId,
        params.recordingExecution,
        params.modelParameters,
        this.ports.promptEstimator,
      );

      // What a resend replays is what was sent: an attempt abandoned while it
      // was prepared leaves nothing behind for the attempt that replaced it.
      params.config?.abortSignal?.throwIfAborted();
      logOutgoingRequest(
        this.turnTelemetryPorts(),
        { ...requestPayload, contents: streamPreparation.contents },
        this.ports.state.model,
        promptId,
      );
      sendState?.keep({
        contents: streamPreparation.contents,
        toolSelection,
        systemInstruction: this.generationConfig.systemInstruction,
      });

      const stream = await this._sendProviderRequest(
        provider,
        { ...requestPayload, contents: streamPreparation.contents },
        runtimeContext,
        params,
        promptId,
        toolSelection.allowedFunctionNames,
        streamPreparation.prepared,
        sendState,
        dumpAttemptContext,
      );
      return this._withCompressionCleanup(stream, provider, params);
    } catch (error) {
      this.compressionHandler.clearProviderCompressionCallback(provider);
      throw error;
    }
  }
  private _withCompressionCleanup(
    stream: AsyncGenerator<ModelStreamChunk>,
    provider: IProvider,
    params: SendMessageParams,
  ): AsyncGenerator<ModelStreamChunk> {
    return withCompressionCallbackCleanup(
      stream,
      provider,
      this.compressionHandler,
      params.config?.abortSignal,
    );
  }

  private async _fireBeforeModel(
    params: SendMessageParams,
    requestContents: IContent[],
    pendingUserIContents: IContent[],
    toolSelection: ToolSelectionHookResult,
  ): ReturnType<typeof fireBeforeModelHook> {
    const fired = await fireBeforeModelHook({
      owner: params.hookOwner ?? params.recordingExecution?.hookOwner,
      requestContents,
      pendingUserIContents,
      tools: toolSelection.tools ?? [],
      hookRestrictedAllowedTools: toolSelection.allowedFunctionNames,
      model: this.ports.state.model,
      log: (msg) => this.logger.debug(() => msg),
    });
    // An attempt abandoned while its hook ran must not go on to enforce the
    // context limit for a request that will not be sent.
    params.config?.abortSignal?.throwIfAborted();
    return fired;
  }

  /**
   * Sends a request that was already built, hooked and enforced, exactly as it
   * was (issue #4036): the BeforeModel hook does not run again and the live
   * history is not read.
   */
  private async _resendKeptRequest(
    provider: IProvider,
    kept: ProviderReadyRequest,
    params: SendMessageParams,
    promptId: string,
    sendState: SendRequestState | undefined,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    assertAdmittedRoute(params.modelParameters?.route);
    const { requestPayload, runtimeContext } = this._prepareRequestPayload(
      kept.contents,
      kept.toolSelection,
      params,
    );
    const bound = this._bindProviderMediaAndFiles(provider);
    try {
      logOutgoingRequest(
        this.turnTelemetryPorts(),
        requestPayload,
        this.ports.state.model,
        promptId,
      );
      const stream = await this._sendProviderRequest(
        bound,
        requestPayload,
        runtimeContext,
        params,
        promptId,
        kept.toolSelection.allowedFunctionNames,
        undefined,
        sendState,
        this.refusalDumpPairing.createAttempt(promptId),
        { ...this.generationConfig, systemInstruction: kept.systemInstruction },
      );
      return this._withCompressionCleanup(stream, bound, params);
    } catch (error) {
      this.compressionHandler.clearProviderCompressionCallback(bound);
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
      modelName: params.modelParameters?.route?.model ?? this.ports.state.model,
      baseUrl:
        params.modelParameters?.route?.baseURL ?? this.ports.state.baseUrl,
    });

    const runtimeContext = buildRuntimeContext(baseRuntimeContext, params);

    return { requestPayload, baseRuntimeContext, runtimeContext };
  }

  /**
   * The options this attempt sends: built from the live request for a first
   * send, or the options of the kept request bound to this attempt's own
   * signal and observers for an identical resend (issue #4093).
   */
  private _chatOptionsForSend(
    provider: IProvider,
    requestPayload: PreparedRequest['requestPayload'],
    runtimeContext: ProviderRequestCollaborators,
    params: SendMessageParams,
    promptId: string,
    generation: ChatSessionConfig,
    sendState: SendRequestState | undefined,
    dumpAttemptContext: DumpAttemptContext,
  ): ReturnType<typeof buildStreamChatOptions> {
    const keptOptions = sendState?.replayable()?.options;
    if (keptOptions !== undefined) {
      return replayOptions(keptOptions, {
        signal: params.config?.abortSignal,
        onProviderError: params.config?.onProviderError,
        onStreamLiveness: params.config?.onStreamLiveness,
        requestContext: params.config?.providerRequestContext,
        rawTokenDeltaSink: this.currentRawTokenDeltaBridge?.notify,
        dumpAttemptContext,
      });
    }
    return buildStreamChatOptions(
      this.ports.prepareProviderInvocation,
      provider.name,
      promptId,
      requestPayload,
      runtimeContext.metadata,
      params,
      generation,
      this.currentRawTokenDeltaBridge,
      dumpAttemptContext,
    );
  }

  // @plan:PLAN-20260617-COREAPI.P15
  // @requirement:REQ-001
  private async _sendProviderRequest(
    provider: IProvider,
    requestPayload: PreparedRequest['requestPayload'],
    runtimeContext: ProviderRequestCollaborators,
    params: SendMessageParams,
    promptId: string,
    hookRestrictedAllowedTools: string[] | undefined,
    preparedAtEnforcement:
      | Awaited<ReturnType<typeof prepareAtSendSeam>>
      | undefined,
    sendState: SendRequestState | undefined,
    dumpAttemptContext: DumpAttemptContext,
    generation: ChatSessionConfig = this.generationConfig,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const startTime = Date.now();
    let dispatching = false;
    try {
      const chatOptions = this._chatOptionsForSend(
        provider,
        requestPayload,
        runtimeContext,
        params,
        promptId,
        generation,
        sendState,
        dumpAttemptContext,
      );
      const prepared =
        preparedAtEnforcement ??
        (await prepareAtSendSeam(
          provider,
          chatOptions,
          this.ports.promptEstimator,
        ));
      assertAdmittedRoute(params.modelParameters?.route);
      // The dispatch boundary: an attempt abandoned while it was prepared (a
      // slow hook, a purge lease) publishes nothing and sends nothing when it
      // resumes. Everything below, up to the provider call, is synchronous.
      params.config?.abortSignal?.throwIfAborted();
      dispatching = true;
      sendState?.keepOptions(snapshotSentOptions(prepared.options));
      this.currentPromptEnvelopeEstimate = prepared.estimate;
      this.currentContextFingerprint = this._captureSendAudit(
        prepared,
        requestPayload,
        generation,
        promptId,
        params,
      );
      const streamResponse = provider.generateChatCompletion({
        ...prepared.options,
        requestDiagnostics: this.ports.requestDiagnostics,
      });
      // Captured explicitly (not read inside the generator below): a later
      // attempt replaces the instance field, and the explicit parameter is
      // what keeps this attempt's stream wired to this attempt's tracker.
      const rawTokenDeltaBridge = this.currentRawTokenDeltaBridge;

      return await consumeFirstChunkAndReturn(
        streamResponse,
        requestPayload,
        promptId,
        startTime,
        this.currentAttemptIndex,
        hookRestrictedAllowedTools,
        rawTokenDeltaBridge,
        params.hookOwner ?? params.recordingExecution?.hookOwner,
        dumpAttemptContext,
        params.config?.abortSignal,
        this._convertIContentStream.bind(this),
      );
    } catch (error) {
      logApiError(
        this.turnTelemetryPorts(),
        this.ports.state.model,
        promptId,
        Date.now() - startTime,
        error,
      );
      // An attempt that never dispatched did not set the estimate, so it must
      // not clear the one belonging to the attempt that replaced it.
      if (dispatching) this.currentPromptEnvelopeEstimate = null;
      throw error;
    }
  }

  private _captureSendAudit(
    prepared: Awaited<ReturnType<typeof prepareAtSendSeam>>,
    requestPayload: PreparedRequest['requestPayload'],
    generation: ChatSessionConfig,
    promptId: string,
    params: SendMessageParams,
  ): RefusalContextFingerprint | undefined {
    return captureSendBoundaryAudit(
      this.refusalStreamAudit,
      this.compressionHandler,
      this.ports,
      this.historyService,
      prepared,
      requestPayload,
      generation,
      promptId,
      params.logicalSend?.turnId ?? this.turnIdByPromptId.get(promptId) ?? null,
    );
  }

  private async _applyToolSelectionHook(
    tools: AgentClientGenerateConfig['tools'],
    owner?: HookExecutionOwner,
  ): Promise<ToolSelectionHookResult> {
    return applyToolSelectionHook(tools, this.ports.state.model, owner);
  }

  private _buildContents(
    userContent: IContent | IContent[],
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  ): ReturnType<typeof buildRequestContentsResult> {
    return buildRequestContentsResult(
      userContent,
      this.historyService,
      semanticMediaPurge?.requestHistory,
    );
  }

  private async _handleBucketFailover(
    signal: AbortSignal | undefined,
  ): Promise<boolean | null> {
    const failoverHandler = this.tryBucketFailover;
    if (!failoverHandler) return null;

    this.logger.debug(() => 'Attempting bucket failover on persistent 429');
    const success = await failoverHandler({ signal });
    if (success) {
      this.logger.debug(
        () =>
          `Bucket failover successful, new bucket: ${this.readCurrentBucket?.()}`,
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
    requestPayload: PreparedRequest['requestPayload'],
    telemetryContext: {
      promptId: string;
      startTime: number;
      attemptIndex?: number;
    },
    hookRestrictedAllowedTools: string[] | undefined,
    rawTokenDeltaBridge: RawTokenDeltaBridge | null | undefined,
    owner: HookExecutionOwner | undefined,
    dumpAttemptContext: DumpAttemptContext,
    attemptSignal?: AbortSignal,
  ): AsyncGenerator<ModelStreamChunk> {
    let lastIContent: IContent | undefined;
    let finish: StreamFinishInfo = {};
    // Starts on first pull (provider-call boundary), excluding send-seam time (#3257).
    // Attach precedes raw deltas; a null bridge means no token-usage tracker (#4068).
    const timing = startAttemptTiming(rawTokenDeltaBridge);

    // The caller iterates this generator after _sendProviderRequest returned,
    // so a mid-stream failure never re-enters its try/catch; clear the failed
    // attempt's estimate here so only a successful one stays observable.
    try {
      for await (const iContent of streamResponse) {
        // Data from an abandoned attempt is neither processed nor published.
        attemptSignal?.throwIfAborted();
        timing?.recordChunk(iContent);
        trackPromptTokens(iContent, this.compressionHandler, this.logger);
        const chunk = toModelStreamChunk(iContent);
        if (hookRestrictedAllowedTools !== undefined) {
          chunk.hookRestrictions = {
            allowedToolNames: [...hookRestrictedAllowedTools],
          };
        }
        const hookChunk =
          (await processAfterModelHook({
            model: this.ports.state.model,
            iContent,
            requestPayload,
            chunk,
            hookRestrictedAllowedTools,
            owner,
          })) ?? chunk;
        const yieldedChunk = preserveProviderDiagnosticsAfterHook(
          chunk,
          hookChunk,
        );
        lastIContent = contentForTelemetryPreservingUsage(
          yieldedChunk,
          lastIContent,
        );
        finish = accumulateStreamFinishInfo(finish, yieldedChunk);
        yield yieldedChunk;
      }
      // An EOF that arrives after the attempt was abandoned is not a success.
      attemptSignal?.throwIfAborted();
    } catch (error) {
      this.currentPromptEnvelopeEstimate = null;
      attachStreamTiming(
        this.compressionHandler.tokenUsageLogger,
        telemetryContext,
        timing?.measure(),
      );
      throw error;
    }

    if (dumpAttemptContext.dumpBaseId !== undefined) {
      const dumpIdChunk = createDumpIdChunk(dumpAttemptContext.dumpBaseId);
      lastIContent = contentForTelemetryPreservingUsage(
        dumpIdChunk,
        lastIContent,
      );
      finish = accumulateStreamFinishInfo(finish, dumpIdChunk);
      yield dumpIdChunk;
    }
    await logStreamTelemetry(
      this.turnTelemetryPorts(),
      telemetryContext,
      lastIContent,
      this.compressionHandler.tokenUsageLogger,
      timing?.measure(),
      finish,
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
    contextFingerprint?: RefusalContextFingerprint,
    promptId = 'unknown',
    attemptIndex = 0,
    attemptSignal?: AbortSignal,
    sendState?: SendRequestState,
  ): AsyncGenerator<ModelStreamChunk> {
    const includeThoughts = this.ports.ephemerals.reasoning.includeInContext();
    const turnId = capturedTurnId ?? this.historyService.generateTurnKey();

    const accumulator = new StreamOutputAccumulator();
    const admissions: MediaAdmissionRelease[] = [];
    let finalized = false;
    let failureCleanupStarted = false;
    try {
      for await (const chunk of streamResponse) {
        const admitted = await admitRefusalAuditChunk(
          this.ports,
          {
            ...chunk,
            content: stripProviderAttemptDiagnostics(chunk.content),
          },
          turnId,
        );
        attemptSignal?.throwIfAborted();
        admissions.push(...admitted.admissions);
        accumulator.add({ ...chunk, content: admitted.historyContent });
        yield { ...chunk, content: admitted.filteredContent };
      }
      attemptSignal?.throwIfAborted();
      const accumulated = accumulator.materialize();
      // Classified before validation, history commit and success accounting:
      // a refused attempt's output never reaches any of them (issue #4036).
      throwIfRefused(accumulated, turnId, contextFingerprint);
      await this._finalizeStreamProcessing(accumulated, {
        origin,
        logger: this.logger,
        conversationManager: this.conversationManager,
        historyService: this.historyService,
        compressionHandler: this.compressionHandler,
        mediaAdmission: mediaAdmissionPort(this.ports),
        reasoningInclusion: reasoningInclusionPolicy(this.ports),
        userInput,
        includeThoughts,
        semanticMediaPurge,
        retryHandoff: this.currentIsResend,
        eagerlyRecordedToolResponseCallIds:
          this.eagerlyRecordedToolResponseCallIds,
        preparedUserTurn,
        mediaAdmissions: admissions,
        attemptSignal,
        sendState,
      });
      this.refusalStreamAudit.commit(
        this.historyService.getAll(),
        promptId,
        attemptIndex,
      );
      finalized = true;
    } catch (error: unknown) {
      failureCleanupStarted = true;
      await failStreamProcessing(
        error,
        admissions,
        mediaAdmissionPort(this.ports),
      );
    } finally {
      if (!finalized && !failureCleanupStarted) {
        await this.ports.mediaAdmission?.releaseAdmissions(admissions);
      }
    }
  }
}
