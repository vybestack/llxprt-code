/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { sourceResponseArrival } from './response-transport-source.js';
import { bindProviderMediaAndFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderMediaAndFiles.js';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { StreamTerminalState } from './streamTerminalState.js';
import { cancellableResponseStream } from './cancellableResponseStream.js';
import {
  openResponseArrival,
  responseArrivalFor,
  appendResponseChunk,
  prefetchResponseArrival,
  takePrefetchedArrival,
} from './responseArrival.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import {
  isRetryableError,
  retryWithBackoff,
} from '@vybestack/llxprt-code-core/utils/retry.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { recordSourceSendSeamTelemetry } from './tokenUsageEstimateLogger.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ConversationManager } from './ConversationManager.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
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
  contentForTelemetryPreservingUsage,
  extractSystemInstructionText,
  turnSystemInstruction,
  type PreparedRequest,
} from './streamRequestHelpers.js';
import { buildAndSendStreamRequest } from './streamprocessor-request.js';
import { trackPromptTokens } from './streamResponseHelpers.js';
import { submitUserPrompt } from './prompt-submission.js';
import {
  afterModelModifiedToChunk,
  afterModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import type { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';

import { stampTurnIdentityOnInput } from './turnIdentity.js';
import { assertAdmittedRoute } from './admittedRouteSecurity.js';
import { buildStreamChatOptions } from './streamChatOptions.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import {
  admitStreamChunkForHistory,
  streamMediaAdmissions,
  type PreparedUserTurn,
} from './mediaAdmissionSeam.js';
import {
  failStreamProcessing,
  finalizeStreamResponse,
} from './streamResponseFinalizer.js';
import {
  fireSourceAfterModelHook,
  type SourceAfterModelRequest,
} from './source-after-model-hook.js';

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

  async submitUserPrompt(
    userInput: IContent | IContent[],
    promptId: string,
    origin?: object,
  ): Promise<void> {
    await submitUserPrompt(
      this.runtimeContext,
      userInput,
      promptId,
      this.eagerlyRecordedToolResponseCallIds,
      origin,
    );
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

    await this.submitUserPrompt(
      stampedUserContent,
      promptId,
      params.recordingExecution?.historyOrigin,
    );
    const streamResponse = await this._executeStreamApiCall(
      params,
      promptId,
      stampedUserContent,
      provider,
      semanticMediaPurge,
    );

    return this._createCancellableStream(
      streamResponse,
      stampTurnIdentityOnInput(historyUserContent, { promptId, turnId }),
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
    return cancellableResponseStream(streamResponse, () =>
      this.processStreamResponse(
        streamResponse,
        userContent,
        semanticMediaPurge,
        turnId,
        prepared,
        origin,
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
    return buildAndSendStreamRequest({
      runtime: this.runtimeContext,
      compression: this.compressionHandler,
      history: this.historyService,
      params,
      promptId,
      userContent,
      provider: this._bindProviderMediaAndFiles(
        provider,
        this.providerRuntimeBuilder('StreamProcessor.bindProvider', {}),
      ),
      semanticMediaPurge,
      fallbackTools: this.generationConfig.tools,
      buildRuntime: (extras) =>
        this.providerRuntimeBuilder('StreamProcessor.generateRequest', extras),
      buildOptions: (contents, tools, runtime, base) =>
        this._buildStreamChatOptions(
          promptId,
          { contents, tools },
          runtime,
          base,
          params,
          provider.name,
        ),
      consumeSource: (stream, startTime, allowedTools, afterModel) =>
        this._consumeFirstChunkAndReturn(
          stream,
          undefined,
          promptId,
          startTime,
          allowedTools,
          this.currentRawTokenDeltaBridge,
          afterModel,
          params.hookOwner ?? params.recordingExecution?.hookOwner,
          params.recordingExecution?.historyOrigin,
        ),
      setEstimate: (estimate) => {
        this.currentPromptEnvelopeEstimate = estimate;
      },
      recordSourceSeam: (prepared, tools, signal) =>
        recordSourceSendSeamTelemetry({
          usageLogger: this.compressionHandler.tokenUsageLogger,
          promptId,
          estimate: prepared.estimate,
          runtimeState: this.runtimeContext.state,
          historyService: this.historyService,
          requestRows: prepared.source,
          tools,
          systemInstruction: turnSystemInstruction(
            params,
            this.generationConfig,
          ),
          turnId: this.turnIdByPromptId.get(promptId) ?? null,
          signal,
        }),
      log: (message) => this.logger.debug(() => message),
    });
  }

  private _buildStreamChatOptions(
    promptId: string,
    requestPayload: {
      contents: Iterable<IContent> | AsyncIterable<IContent>;
      tools: PreparedRequest['requestPayload']['tools'];
    },
    runtimeContext: ProviderRequestCollaborators,
    baseRuntimeContext: ProviderRequestCollaborators,
    params: SendMessageParams,
    providerName: string,
  ): GenerateChatOptions {
    // The shared builder owns invocation, route, retry wiring and the fresh
    // pass per consumer; the source route resolves the system prompt for this
    // turn (not the session default).
    const options = buildStreamChatOptions(
      this.runtimeContext.prepareProviderInvocation,
      providerName,
      promptId,
      requestPayload,
      runtimeContext.metadata,
      baseRuntimeContext,
      params,
      this.generationConfig,
      this.currentRawTokenDeltaBridge,
    );
    return {
      ...options,
      systemInstruction: extractSystemInstructionText(
        turnSystemInstruction(params, this.generationConfig),
      ),
      requestDiagnostics: this.runtimeContext.requestDiagnostics,
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
    sourceRequest?: SourceAfterModelRequest,
    owner?: HookExecutionOwner,
    origin?: object,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const arrival =
      sourceResponseArrival(streamResponse) ??
      (await openResponseArrival(
        this.historyService,
        this.runtimeContext,
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
      sourceRequest,
      owner,
    );

    return prefetchResponseArrival(
      convertedStream,
      arrival,
      this.runtimeContext.ephemerals.reasoning.includeInContext(),
      async (chunk) => {
        const turnId = this.turnIdByPromptId.get(promptId) ?? promptId;
        const historyChunk = await admitStreamChunkForHistory(
          this.runtimeContext,
          chunk,
          {
            ...chunk.content,
            blocks: filterHookRestrictedBlocks(
              chunk.content.blocks,
              chunk.hookRestrictions?.allowedToolNames,
            ),
          },
          turnId,
        );
        return {
          historyChunk,
          release: async () => {
            await this.runtimeContext.mediaAdmission?.releaseAdmissions(
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
    sourceRequest?: SourceAfterModelRequest,
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
            sourceRequest,
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
    sourceRequest: SourceAfterModelRequest | undefined,
    owner?: HookExecutionOwner,
  ): Promise<ModelStreamChunk | undefined> {
    if (owner === undefined) return undefined;
    if (requestPayload !== undefined && owner.afterModel === undefined)
      return undefined;

    // Build the hook-visible IContent with restricted tool blocks filtered.
    const filteredBlocks = filterHookRestrictedBlocks(
      iContent.blocks,
      hookRestrictedAllowedTools,
    );
    const hookIContent = iContentFromBlocks(filteredBlocks, iContent.speaker);

    const response = {
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
    };
    const requestTools = requestPayload?.tools ?? sourceRequest?.tools;
    // A restricted selection that emptied the tool list is hidden from hooks.
    const omitTools =
      requestTools === undefined ||
      (requestTools.length === 0 && hookRestrictedAllowedTools !== undefined);
    const model = this.runtimeContext.state.model;
    const afterModelResult =
      requestPayload !== undefined
        ? await owner.afterModel?.(
            {
              model,
              contents: requestPayload.contents,
              ...(omitTools ? {} : { tools: requestTools }),
            },
            response,
            owner.signal,
          )
        : await fireSourceAfterModelHook({
            owner,
            request: sourceRequest,
            model,
            response,
            omitTools,
            log: (message) => this.logger.debug(() => message),
          });

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

  /** Journal each arrival before yielding or pulling the next provider chunk. */
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

    const arrival =
      responseArrivalFor(streamResponse) ??
      (await openResponseArrival(
        this.historyService,
        this.runtimeContext,
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
        const allowedToolNames = chunk.hookRestrictions?.allowedToolNames;
        const filteredContent: IContent = {
          ...chunk.content,
          blocks: filterHookRestrictedBlocks(
            chunk.content.blocks,
            allowedToolNames,
          ),
        };
        const prefetchedChunk = takePrefetchedArrival(chunk);
        const historyChunk =
          prefetchedChunk ??
          (await admitStreamChunkForHistory(
            this.runtimeContext,
            chunk,
            filteredContent,
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
        yield { ...chunk, content: filteredContent };
      }
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
      finalized = true;
    } catch (error: unknown) {
      failureCleanupStarted = true;
      await failStreamProcessing(error, admissions, this.runtimeContext);
    } finally {
      if (!finalized)
        await arrival.interrupt(failureCleanupStarted ? 'error' : 'cancelled');
      if (!finalized && !failureCleanupStarted) {
        await this.runtimeContext.mediaAdmission?.releaseAdmissions(admissions);
      }
    }
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
      runtimeContext: this.runtimeContext,
      terminal,
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
