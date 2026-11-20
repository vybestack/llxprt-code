/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  DumpAttemptContext,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { bindProviderMediaAndFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderMediaAndFiles.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type {
  ProviderFileBindingStore,
  ProviderRequestCollaborators,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import { sourceResponseArrival } from './response-transport-source.js';
import { StreamTerminalState } from './streamTerminalState.js';
import { cancellableResponseStream } from './cancellableResponseStream.js';
import {
  openResponseArrival,
  responseArrivalFor,
  appendResponseChunk,
  prefetchResponseArrival,
  takePrefetchedArrival,
} from './responseArrival.js';
import { recordSourceSendSeamTelemetry } from './tokenUsageEstimateLogger.js';
import {
  contentForTelemetryPreservingUsage,
  extractSystemInstructionText,
  preserveProviderDiagnosticsAfterHook,
  turnSystemInstruction,
  type PreparedRequest,
} from './streamRequestHelpers.js';
import { buildAndSendStreamRequest } from './streamprocessor-request.js';
import {
  createDumpIdChunk,
  stripProviderAttemptDiagnostics,
  trackPromptTokens,
} from './streamResponseHelpers.js';
import type {
  SendRequestState,
  ProviderReadyRequest,
} from './sendRequestState.js';
import { resendKeptRequestSource } from './streamprocessor-refusal-resend.js';
import { throwIfRefused } from '../refusal/refusalDetection.js';
import { RefusalStreamAudit } from '../refusal/refusalStreamAudit.js';
import type { RefusalContextFingerprint } from '../refusal/refusalAudit.js';
import type { RefusalContextRows } from '../refusal/refusalContextTracker.js';
import { RefusalDumpPairing } from './refusalDumpPairing.js';
import {
  accumulateStreamFinishInfo,
  attachStreamTiming,
  beginTokenUsageAttempt,
  logStreamTelemetry,
  startAttemptTiming,
  type RawTokenDeltaBridge,
  type StreamFinishInfo,
} from './streamTelemetryLogger.js';
import { submitUserPrompt } from './prompt-submission.js';
import { processAfterModelHook } from './streamAfterModelHook.js';
import type { SourceAfterModelRequest } from './source-after-model-hook.js';
import { splitUserTurnInput } from './streamTurnInput.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import { stampTurnIdentityOnInput } from './turnIdentity.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';
import { turnTelemetryPorts } from './turnLogging.js';
import { assertAdmittedRoute } from './admittedRouteSecurity.js';
import {
  admitStreamChunkForHistory,
  streamMediaAdmissions,
  type PreparedUserTurn,
} from './mediaAdmissionSeam.js';
import { mediaAdmissionPort } from './runtimePorts.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import { buildStreamChatOptions } from './streamChatOptions.js';
import {
  failStreamProcessing,
  finalizeStreamResponse,
} from './streamResponseFinalizer.js';

export class StreamProcessor {
  private logger = new DebugLogger('llxprt:gemini:stream-processor');

  private turnTelemetryPorts() {
    return turnTelemetryPorts(this.ports.state, this.ports.telemetry);
  }
  private eagerlyRecordedToolResponseCallIds = new Set<string>();
  private currentPromptEnvelopeEstimate: PromptEnvelopeEstimate | null = null;

  /** Canonical turn identity retained across retries for each logical prompt. */
  private readonly turnIdByPromptId = new Map<string, string>();
  private readonly refusalDumpPairing = new RefusalDumpPairing(
    () => this.currentAttemptIndex,
  );
  private readonly refusalStreamAudit = new RefusalStreamAudit();
  private readonly releaseCompressionAuditListener: () => void;
  /** Send-boundary refusal context of the attempt in flight (#4101). */
  private currentContextFingerprint: RefusalContextFingerprint | undefined;
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
    this.releaseCompressionAuditListener =
      this.compressionHandler.setCompressionAuditListener((provenance) =>
        this.refusalStreamAudit.recordCompression(provenance),
      );
  }

  /** Tracks tool responses already recorded during eager client streaming. */
  markToolResponsesRecorded(callIds: readonly string[]): void {
    for (const callId of callIds) {
      if (typeof callId === 'string' && callId.length > 0) {
        this.eagerlyRecordedToolResponseCallIds.add(callId);
      }
    }
  }

  async submitUserPrompt(
    userInput: IContent | IContent[],
    promptId: string,
    origin?: object,
  ): Promise<void> {
    await submitUserPrompt(
      this.ports,
      userInput,
      promptId,
      this.eagerlyRecordedToolResponseCallIds,
      origin,
    );
  }

  releasePromptTurnIdentity(promptId: string): void {
    this.turnIdByPromptId.delete(promptId);
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
    const { prepared, providerUserContent, historyUserContent, inputTurnId } =
      splitUserTurnInput(userInput);
    const turnId =
      inputTurnId ??
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

    await this.submitUserPrompt(
      stampedUserContent,
      promptId,
      params.recordingExecution?.historyOrigin,
    );
    this.currentContextFingerprint = undefined;
    const streamResponse = await this._executeStreamApiCall(
      params,
      promptId,
      stampedUserContent,
      provider,
      semanticMediaPurge,
      sendState,
    );

    return this._createCancellableStream(
      streamResponse,
      stampTurnIdentityOnInput(historyUserContent, { promptId, turnId }),
      prepared,
      semanticMediaPurge,
      turnId,
      params.recordingExecution?.historyOrigin,
      promptId,
      this.currentAttemptIndex,
      this.currentContextFingerprint,
    );
  }

  private _createCancellableStream(
    streamResponse: AsyncGenerator<ModelStreamChunk>,
    userContent: IContent | IContent[],
    prepared: PreparedUserTurn | undefined,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
    turnId: string,
    origin: object | undefined,
    promptId: string,
    attemptIndex: number,
    contextFingerprint: RefusalContextFingerprint | undefined,
  ): AsyncGenerator<ModelStreamChunk> {
    return cancellableResponseStream(streamResponse, () =>
      this.processStreamResponse(
        streamResponse,
        userContent,
        semanticMediaPurge,
        turnId,
        prepared,
        origin,
        contextFingerprint,
        promptId,
        attemptIndex,
      ),
    );
  }

  /** Fingerprints the rows this attempt sends against the last successful commit. */
  private async _captureRefusalContext(
    rows: RefusalContextRows,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    this.currentContextFingerprint = await this.refusalStreamAudit.snapshot(
      rows,
      signal,
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
        return this._resendKeptRequest(provider, kept, params, promptId);
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
    assertAdmittedRoute(params.modelParameters?.route);
    const dumpAttemptContext = this.refusalDumpPairing.createAttempt(promptId);
    return buildAndSendStreamRequest({
      sendState,
      runtime: this.ports,
      compression: this.compressionHandler,
      history: this.historyService,
      params,
      promptId,
      userContent,
      provider: this._bindProviderMediaAndFiles(provider),
      semanticMediaPurge,
      requestMediaBudgetBytes: this.requestMediaBudgetBytes,
      fallbackTools: this.generationConfig.tools,
      buildRuntime: (extras) =>
        this.providerRuntimeBuilder('StreamProcessor.generateRequest', extras),
      buildOptions: (contents, tools, runtime) =>
        this._buildStreamChatOptions(
          promptId,
          { contents, tools },
          runtime,
          params,
          provider.name,
          dumpAttemptContext,
        ),
      consumeSource: (stream, startTime, allowedTools, afterModel) =>
        this._consumeFirstChunkAndReturn(
          stream,
          undefined,
          promptId,
          startTime,
          allowedTools,
          this.currentRawTokenDeltaBridge,
          dumpAttemptContext,
          afterModel,
          params.hookOwner ?? params.recordingExecution?.hookOwner,
          params.recordingExecution?.historyOrigin,
        ),
      setEstimate: (estimate) => {
        this.currentPromptEnvelopeEstimate = estimate;
      },
      recordSourceSeam: async (prepared, tools, signal) => {
        await recordSourceSendSeamTelemetry({
          usageLogger: this.compressionHandler.tokenUsageLogger,
          promptId,
          estimate: prepared.estimate,
          runtimeState: this.ports.state,
          historyService: this.historyService,
          requestRows: prepared.source,
          tools,
          systemInstruction: turnSystemInstruction(
            params,
            this.generationConfig,
          ),
          turnId: this.turnIdByPromptId.get(promptId) ?? null,
          signal,
        });
        await this._captureRefusalContext(prepared.source, signal);
      },
      log: (message) => this.logger.debug(() => message),
    });
  }

  private async _resendKeptRequest(
    provider: IProvider,
    kept: ProviderReadyRequest,
    params: SendMessageParams,
    promptId: string,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const bound = this._bindProviderMediaAndFiles(provider);
    const start = Date.now();
    const source = kept.prepared.source;
    const dumpAttemptContext = this.refusalDumpPairing.createAttempt(promptId);
    await this._captureRefusalContext(source, params.config?.abortSignal);
    const stream = await resendKeptRequestSource(
      this.ports,
      bound,
      kept,
      params,
      promptId,
      this.turnIdByPromptId.get(promptId) ?? promptId,
      this.generationConfig,
      this.currentRawTokenDeltaBridge,
      (estimate) => {
        this.currentPromptEnvelopeEstimate = estimate;
      },
      dumpAttemptContext,
    );
    return this._consumeFirstChunkAndReturn(
      stream,
      undefined,
      promptId,
      start,
      kept.toolSelection.allowedFunctionNames,
      this.currentRawTokenDeltaBridge,
      dumpAttemptContext,
      {
        rows: () => source,
        tools: kept.toolSelection.tools,
        signal: params.config?.abortSignal,
      },
      params.hookOwner ?? params.recordingExecution?.hookOwner,
      params.recordingExecution?.historyOrigin,
    );
  }

  private _buildStreamChatOptions(
    promptId: string,
    requestPayload: {
      contents: Iterable<IContent> | AsyncIterable<IContent>;
      tools: PreparedRequest['requestPayload']['tools'];
    },
    runtimeContext: ProviderRequestCollaborators,
    params: SendMessageParams,
    providerName: string,
    dumpAttemptContext: DumpAttemptContext,
  ): GenerateChatOptions {
    // The shared builder owns invocation, route, retry wiring and the fresh
    // pass per consumer; the source route resolves the system prompt for this
    // turn (not the session default).
    const options = buildStreamChatOptions(
      this.ports.prepareProviderInvocation,
      providerName,
      promptId,
      requestPayload,
      runtimeContext.metadata,
      params,
      this.generationConfig,
      this.currentRawTokenDeltaBridge,
      dumpAttemptContext,
    );
    return {
      ...options,
      systemInstruction: extractSystemInstructionText(
        turnSystemInstruction(params, this.generationConfig),
      ),
      requestDiagnostics: this.ports.requestDiagnostics,
    };
  }

  /**
   * Eagerly consume first chunk within retry boundary (#1750).
   */
  private async _consumeFirstChunkAndReturn(
    streamResponse: AsyncIterable<IContent>,
    requestPayload: PreparedRequest['requestPayload'] | undefined,
    promptId: string,
    startTime: number,
    hookRestrictedAllowedTools: string[] | undefined,
    rawTokenDeltaBridge: RawTokenDeltaBridge | null,
    dumpAttemptContext: DumpAttemptContext,
    sourceRequest?: SourceAfterModelRequest,
    owner?: HookExecutionOwner,
    origin?: object,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const arrival =
      sourceResponseArrival(streamResponse) ??
      (await openResponseArrival(
        this.historyService,
        this.ports,
        promptId,
        this.turnIdByPromptId.get(promptId) ??
          this.historyService.generateTurnKey(),
        origin,
      ));
    const convertedStream = this._convertIContentStream(
      streamResponse,
      requestPayload,
      { promptId, startTime, attemptIndex: this.currentAttemptIndex },
      hookRestrictedAllowedTools,
      rawTokenDeltaBridge,
      dumpAttemptContext,
      sourceRequest,
      owner,
    );

    return prefetchResponseArrival(
      convertedStream,
      arrival,
      this.ports.ephemerals.reasoning.includeInContext(),
      async (chunk) => {
        const turnId = this.turnIdByPromptId.get(promptId) ?? promptId;
        const content = stripProviderAttemptDiagnostics(chunk.content);
        const historyChunk = await admitStreamChunkForHistory(
          this.ports,
          { ...chunk, content },
          {
            ...content,
            blocks: filterHookRestrictedBlocks(
              content.blocks,
              chunk.hookRestrictions?.allowedToolNames,
            ),
          },
          turnId,
        );
        return {
          historyChunk,
          release: async () => {
            await this.ports.mediaAdmission?.releaseAdmissions(
              streamMediaAdmissions(historyChunk, turnId),
            );
          },
        };
      },
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
    requestPayload: PreparedRequest['requestPayload'] | undefined,
    telemetryContext: {
      promptId: string;
      startTime: number;
      attemptIndex?: number;
    },
    hookRestrictedAllowedTools: string[] | undefined,
    rawTokenDeltaBridge: RawTokenDeltaBridge | null | undefined,
    dumpAttemptContext: DumpAttemptContext,
    sourceRequest?: SourceAfterModelRequest,
    owner?: HookExecutionOwner,
  ): AsyncGenerator<ModelStreamChunk> {
    let lastIContent: IContent | undefined;
    let finish: StreamFinishInfo = {};
    // Constructed at generator-body start (first pull — the provider call
    // boundary), so provider_request_ms covers the stream lifecycle alone
    // and excludes send-seam estimation (#3257). The provider stream is only
    // iterated inside this generator body, so attach always happens before
    // any provider code can fire a raw delta. A null bridge means the attempt
    // is not logged (#4068), so no tracker is created.
    const timing = startAttemptTiming(rawTokenDeltaBridge);

    // The caller iterates this generator after _sendProviderRequest returned,
    // so a mid-stream failure never re-enters its try/catch; clear the failed
    // attempt's estimate here so only a successful one stays observable.
    try {
      for await (const iContent of streamResponse) {
        timing?.recordChunk(iContent);
        this._trackPromptTokens(iContent);
        const chunk = toModelStreamChunk(iContent);
        if (hookRestrictedAllowedTools !== undefined) {
          chunk.hookRestrictions = {
            allowedToolNames: [...hookRestrictedAllowedTools],
          };
        }
        const hookChunk =
          (await processAfterModelHook(
            iContent,
            requestPayload,
            chunk,
            hookRestrictedAllowedTools,
            sourceRequest,
            owner,
            this.ports.state.model,
            this.logger,
          )) ?? chunk;
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

  private _trackPromptTokens(iContent: IContent): void {
    trackPromptTokens(iContent, this.compressionHandler, this.logger);
  }

  /** Journal each arrival before yielding or pulling the next provider chunk. */
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
  ): AsyncGenerator<ModelStreamChunk> {
    const includeThoughts = this.ports.ephemerals.reasoning.includeInContext();
    const turnId = capturedTurnId ?? this.historyService.generateTurnKey();

    const arrival =
      responseArrivalFor(streamResponse) ??
      (await openResponseArrival(
        this.historyService,
        this.ports,
        turnId,
        turnId,
        origin,
      ));
    const terminal = new StreamTerminalState();
    const admissions: MediaAdmissionRelease[] = [];
    let finalized = false;
    let failureCleanupStarted = false;
    try {
      for await (const chunk of streamResponse) {
        const filteredContent = await this._journalStreamChunk(
          chunk,
          streamResponse,
          turnId,
          arrival,
          includeThoughts,
          admissions,
          terminal,
        );
        yield { ...chunk, content: filteredContent };
      }
      // Classified before validation, history commit and success accounting:
      // a refused attempt's output never reaches any of them (issue #4036).
      throwIfRefused(terminal, turnId, contextFingerprint);
      await this._finalizeStreamProcessing(
        terminal,
        userInput,
        includeThoughts,
        semanticMediaPurge,
        preparedUserTurn,
        admissions,
        origin,
        arrival,
      );
      this.refusalStreamAudit.commit(
        this.historyService.getChronologyWatermark(),
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
      if (!finalized)
        await arrival.interrupt(failureCleanupStarted ? 'error' : 'cancelled');
      if (!finalized && !failureCleanupStarted) {
        await this.ports.mediaAdmission?.releaseAdmissions(admissions);
      }
    }
  }

  /** Admits one chunk to history and journals it; returns the hook-filtered content. */
  private async _journalStreamChunk(
    chunk: ModelStreamChunk,
    streamResponse: AsyncGenerator<ModelStreamChunk>,
    turnId: string,
    arrival: ResponseArrival,
    includeThoughts: boolean,
    admissions: MediaAdmissionRelease[],
    terminal: StreamTerminalState,
  ): Promise<IContent> {
    const filteredContent: IContent = {
      ...chunk.content,
      blocks: filterHookRestrictedBlocks(
        chunk.content.blocks,
        chunk.hookRestrictions?.allowedToolNames,
      ),
    };
    const prefetchedChunk = takePrefetchedArrival(streamResponse, chunk);
    const historyContent = stripProviderAttemptDiagnostics(filteredContent);
    const historyChunk =
      prefetchedChunk ??
      (await admitStreamChunkForHistory(
        this.ports,
        { ...chunk, content: historyContent },
        historyContent,
        turnId,
      ));
    admissions.push(...streamMediaAdmissions(historyChunk, turnId));
    const pendingArrival =
      prefetchedChunk === undefined
        ? appendResponseChunk(arrival, historyChunk, includeThoughts)
        : undefined;
    if (pendingArrival !== undefined) await pendingArrival;
    terminal.add(historyChunk, includeThoughts);
    await this._recordStreamAfc(historyChunk, arrival);
    return filteredContent;
  }

  private async _recordStreamAfc(
    chunk: ModelStreamChunk,
    arrival: ResponseArrival,
  ): Promise<void> {
    const afc = chunk.afcHistory;
    if (afc === undefined) return;
    const start = await this.historyService.matchingCuratedPrefix(afc);
    await arrival.replaceAfcHistory(
      (async function* () {
        for (let index = start; index < afc.length; index++) yield afc[index];
      })(),
    );
  }

  private _finalizeStreamProcessing(
    terminal: StreamTerminalState,
    userInput: IContent | IContent[],
    includeThoughts: boolean,
    semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
    preparedUserTurn: PreparedUserTurn | undefined,
    mediaAdmissions: readonly MediaAdmissionRelease[],
    origin?: object,
    arrival?: ResponseArrival,
  ): Promise<void> {
    return finalizeStreamResponse({
      arrival,
      origin,
      logger: this.logger,
      conversationManager: this.conversationManager,
      historyService: this.historyService,
      compressionHandler: this.compressionHandler,
      mediaAdmission: mediaAdmissionPort(this.ports),
      terminal,
      userInput,
      includeThoughts,
      semanticMediaPurge,
      retryHandoff: this.currentIsResend,
      eagerlyRecordedToolResponseCallIds:
        this.eagerlyRecordedToolResponseCallIds,
      preparedUserTurn,
      mediaAdmissions,
    });
  }
}
