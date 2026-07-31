/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SendMessageParams } from './chatSession.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { resolveStreamIdleTimeoutMs } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stampAiTurnModel } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { recordFinalizedPromptEnvelopeEstimate } from './tokenUsageEstimateLogger.js';
import {
  bindPreparedTransportSignal,
  buildProviderChatOptions,
  enforceAndSendWithPromptEnvelopeRetries,
  prepareAtSendSeam,
} from './promptEnvelopeSendSeam.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { StreamProcessor } from './StreamProcessor.js';
import { normalizeToolInteractionInput } from './MessageConverter.js';
import {
  StreamEventType,
  type StreamEvent,
  INVALID_CONTENT_RETRY_OPTIONS,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  filterHookRestrictedBlocks,
  filterAfcByHookRestrictions,
} from './hookToolRestrictions.js';
import { canonicalizeToolName } from './toolGovernance.js';
import { shouldRetryStreamAttempt } from './turnAbortHelpers.js';

import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import {
  createProviderSendTiming,
  logApiRequest,
  logModelOutputResponse,
  readProviderStreamResponse,
  validateProviderForSend,
  type ProviderSendTiming,
} from './turnLogging.js';
import { throwTurnSendError } from './turnSendError.js';

import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  toModelStreamChunk,
  emptyModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  recordActualTokenUsage,
  type ActualTokenUsageInput,
} from './tokenUsageActualLogger.js';
import { shouldRetryDirectProviderError } from './turnRetryPolicy.js';
type ToolGroupArray = Array<{
  functionDeclarations: Array<{ name: string }>;
}>;

interface ToolSelectionHookResult {
  tools: ToolGroupArray | undefined;
  allowedFunctionNames: string[] | undefined;
}

/**
 * Wraps a neutral ModelStreamChunk into a CHUNK StreamEvent.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P08
 * @requirement:REQ-002.2
 */
function wrapChunk(chunk: ModelStreamChunk): StreamEvent {
  return {
    type: StreamEventType.CHUNK,
    value: chunk,
  };
}

/**
 * Handles turn-level operations: sendMessage, sendMessageStream, waitForIdle.
 * Orchestrates non-streaming sends and delegates streaming to StreamProcessor.
 */
export class TurnProcessor {
  private logger = new DebugLogger('llxprt:turn-processor');
  private sendPromise: Promise<void> = Promise.resolve();
  private lastPromptTokenCount: number | null = null;
  private eagerlyRecordedToolResponseCallIds = new Set<string>();
  private currentPromptEnvelopeEstimate: PromptEnvelopeEstimate | null = null;

  getPromptEnvelopeEstimate(): PromptEnvelopeEstimate | null {
    return this.currentPromptEnvelopeEstimate;
  }

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly compressionHandler: CompressionHandler,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRuntimeContext,
    private readonly generationConfig: AgentClientGenerateConfig,
    private readonly historyService: HistoryService,
    private readonly streamProcessor: StreamProcessor,
    private readonly resolveProviderBaseUrl: (
      provider: IProvider,
    ) => string | undefined,
  ) {}

  /**
   * Sends a non-streaming message to the provider.
   * Waits for previous send, prepares message, calls provider, commits result to history.
   */
  async sendMessage(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput> {
    await this.sendPromise;

    this.lastPromptTokenCount = null;
    this.currentPromptEnvelopeEstimate = null;

    const prepared = this._prepareSendMessage(params);

    // #2410: when the user message converts to zero IContent turns (e.g.
    // empty array after hook-restriction filtering), skip the provider call
    // entirely — never submit a fabricated placeholder to the provider.
    if (prepared.userIContents.length === 0) {
      return emptyModelOutput();
    }

    const provider = this.providerResolver('sendMessage');
    const response = await this._executeSendWithRetry(
      params,
      prepared.userIContents,
      provider,
      prompt_id,
    );

    this.sendPromise = this._commitSendResult(
      response,
      prepared.userContents,
      params,
      prompt_id,
    );

    await this.sendPromise.catch(() => {
      this.sendPromise = Promise.resolve();
    });

    return response;
  }

  /**
   * Sends a streaming message to the provider.
   * Waits for previous send, prepares message, delegates to StreamProcessor.
   */
  async sendMessageStream(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    await this.sendPromise;
    this.lastPromptTokenCount = null;
    this.currentPromptEnvelopeEstimate = null;

    const userContents = this._normalizeUserContent(params);

    let streamDoneResolver: () => void;
    this.sendPromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });

    // Force-resolve sendPromise when the abort signal fires.
    // This prevents a permanent deadlock when .return() can't propagate
    // through a generator blocked on a hung inner iterator (e.g. stalled
    // HTTP stream after idle timeout).
    const abortSignal = params.config?.abortSignal;
    const onAbort = () => streamDoneResolver!();
    if (abortSignal) {
      if (abortSignal.aborted) {
        streamDoneResolver!();
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    return this._createStreamGenerator(params, prompt_id, userContents, () => {
      abortSignal?.removeEventListener('abort', onAbort);
      streamDoneResolver!();
    });
  }

  private async *_createStreamGenerator(
    params: SendMessageParams,
    prompt_id: string,
    userContents: IContent[],
    onDone: () => void,
  ): AsyncGenerator<StreamEvent> {
    const requestParams = this._withProviderRequestContext(params);
    try {
      let lastError: unknown = new Error('Request failed after all retries.');
      let attempt = 0;
      let retrying = true;
      while (retrying && attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts) {
        const outcome = yield* this._runStreamAttempt(
          requestParams,
          prompt_id,
          userContents,
          attempt,
        );
        lastError = outcome.error;
        if (outcome.action !== 'retry') {
          retrying = false;
        } else {
          await delay(
            INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs * (attempt + 1),
            requestParams.config?.abortSignal,
          );
          attempt++;
        }
      }
      if (lastError != null) throw lastError;
    } finally {
      onDone();
    }
  }

  /**
   * Runs a single stream attempt, yielding events incrementally. Returns the
   * outcome (error + action) so the caller loop can decide retry vs stop with
   * a single break/continue.
   */
  private async *_runStreamAttempt(
    params: SendMessageParams,
    prompt_id: string,
    userContents: IContent[],
    attempt: number,
  ): AsyncGenerator<StreamEvent, { error: unknown; action: 'retry' | 'stop' }> {
    if (attempt > 0) {
      yield { type: StreamEventType.RETRY };
    }

    let hasYieldedChunk = false;
    try {
      const currentParams = this._applyRetryTemperature(params, attempt);
      const stream = await this.streamProcessor.makeApiCallAndProcessStream(
        currentParams,
        prompt_id,
        userContents,
      );
      for await (const chunk of stream) {
        hasYieldedChunk ||= chunk.content.blocks.some(
          (block) =>
            (block.type === 'text' && block.text.length > 0) ||
            block.type === 'thinking' ||
            block.type === 'tool_call',
        );
        yield wrapChunk(chunk);
      }
      return { error: null, action: 'stop' };
    } catch (error) {
      // Hook execution control errors are yielded then stop the loop.
      if (error instanceof AgentExecutionStoppedError) {
        yield {
          type: StreamEventType.AGENT_EXECUTION_STOPPED,
          reason: error.reason,
          systemMessage: error.systemMessage,
          contextCleared: error.contextCleared,
        };
        return { error: null, action: 'stop' };
      }
      if (error instanceof AgentExecutionBlockedError) {
        yield {
          type: StreamEventType.AGENT_EXECUTION_BLOCKED,
          reason: error.reason,
          systemMessage: error.systemMessage,
          contextCleared: error.contextCleared,
        };
        if (error.blockedOutput) {
          // P13: blockedOutput is now a neutral ModelOutput (was syntheticResponse).
          yield {
            type: StreamEventType.CHUNK,
            value: error.blockedOutput,
          };
        }
        return { error: null, action: 'stop' };
      }
      if (
        !hasYieldedChunk &&
        shouldRetryStreamAttempt(error, params, attempt)
      ) {
        return { error, action: 'retry' };
      }
      return { error, action: 'stop' };
    }
  }

  private _applyRetryTemperature(
    params: SendMessageParams,
    attempt: number,
  ): SendMessageParams {
    if (attempt === 0) return params;
    const baselineTemperature = Math.max(params.config?.temperature ?? 1, 1);
    const newTemperature = Math.min(
      Math.max(baselineTemperature + attempt * 0.1, 0),
      2,
    );
    return {
      ...params,
      config: { ...params.config, temperature: newTemperature },
    };
  }

  private _normalizeUserContent(params: SendMessageParams): IContent[] {
    return normalizeToolInteractionInput(params.message);
  }

  private _withProviderRequestContext(
    params: SendMessageParams,
  ): SendMessageParams {
    return {
      ...params,
      config: {
        ...params.config,
        providerRequestContext: params.config?.providerRequestContext ?? {},
      },
    };
  }

  private _stampTurnMetadata(contents: IContent[]): IContent[] {
    const idGen = this.historyService.getIdGeneratorCallback();
    return contents.map((content) => ({
      ...content,
      metadata: {
        ...content.metadata,
        id: idGen(),
      },
    }));
  }

  /**
   * Waits for any pending send operation to complete.
   * Fail-open: swallows errors from previous failed sends.
   */
  async waitForIdle(): Promise<void> {
    try {
      await this.sendPromise;
    } catch {
      // If a previous send failed, sendPromise can reject; callers that just need
      // a "best effort" flush should not fail provider switching.
    }
  }

  /** Tracks tool responses already recorded during eager client streaming. */
  markToolResponsesRecorded(callIds: readonly string[]): void {
    for (const callId of callIds) {
      if (typeof callId === 'string' && callId.length > 0) {
        this.eagerlyRecordedToolResponseCallIds.add(callId);
      }
    }
  }

  /**
   * Estimates the token count for pending IContent items.
   */
  async estimatePendingTokens(contents: IContent[]): Promise<number> {
    return this.compressionHandler.estimatePendingTokens(contents);
  }

  /**
   * Prepares user message: validates and converts input before provider enforcement.
   */
  private _prepareSendMessage(params: SendMessageParams): {
    userContents: IContent[];
    userIContents: IContent[];
  } {
    const userContents = this._normalizeUserContent(params);
    const userIContents = this._stampTurnMetadata(userContents);

    return { userContents, userIContents };
  }

  /**
   * Executes the provider call with retry and bucket failover.
   */
  private async _executeSendWithRetry(
    params: SendMessageParams,
    userIContents: IContent[],
    provider: IProvider,
    prompt_id: string,
  ): Promise<ModelOutput> {
    const requestParams = this._withProviderRequestContext(params);
    this._validateProvider(provider);
    const timing = createProviderSendTiming();

    try {
      const providerBaseUrl = this.resolveProviderBaseUrl(provider);
      const response = await this._enforceAndSendProviderRequest(
        provider,
        requestParams,
        userIContents,
        prompt_id,
        providerBaseUrl,
        timing,
      );
      logModelOutputResponse(
        this.runtimeContext,
        prompt_id,
        timing.elapsedSinceSend(),
        response,
      );
      return response;
    } catch (error) {
      this.sendPromise = Promise.resolve();
      return throwTurnSendError(
        error,
        this.runtimeContext,
        prompt_id,
        timing.elapsedSinceSend(),
        this._normalizeRequestTools(params),
        this.logger,
      );
    } finally {
      this.compressionHandler.clearProviderCompressionCallback(provider);
    }
  }

  private async _enforceAndLogProviderContents(
    userIContents: IContent[],
    provider: IProvider,
    prompt_id: string,
    estimateFinalizedPromptTokens?: (contents: IContent[]) => Promise<number>,
  ): Promise<IContent[]> {
    const iContents = await this.compressionHandler.enforceProviderContents(
      {
        contents: this.historyService.getCuratedForProvider(userIContents),
        pendingContents: userIContents,
      },
      prompt_id,
      provider,
      estimateFinalizedPromptTokens,
    );
    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      iContents,
      this.runtimeContext.state.model,
      prompt_id,
    );
    return iContents;
  }

  private _validateProvider(provider: IProvider): void {
    validateProviderForSend(
      provider,
      this.logger,
      this.runtimeContext.state.model,
      () => this.resolveProviderBaseUrl(provider),
    );
  }

  /**
   * Runs provider-content enforcement and the prompt-envelope send/retry loop.
   * `timing` starts measuring only when a prepared request is handed to the
   * provider, so telemetry reports provider latency rather than local
   * enforcement time.
   */
  private async _enforceAndSendProviderRequest(
    provider: IProvider,
    requestParams: SendMessageParams,
    userIContents: IContent[],
    prompt_id: string,
    providerBaseUrl: string | undefined,
    timing: ProviderSendTiming,
  ): Promise<ModelOutput> {
    const toolSelection = await this._applyToolSelectionHook(
      this.runtimeContext.providerRuntime.config,
      this._selectRequestTools(requestParams),
    );
    const runtimeContext = this.providerRuntimeBuilder(
      'TurnProcessor.executeProviderCall',
      { toolCount: toolSelection.tools?.length ?? 0 },
    );
    return enforceAndSendWithPromptEnvelopeRetries({
      provider,
      contents: userIContents,
      buildOptions: (contents) =>
        this._buildProviderChatOptions(
          contents,
          toolSelection.tools,
          runtimeContext,
          requestParams.config?.abortSignal ?? new AbortController().signal,
          requestParams.config?.providerRequestContext,
        ),
      enforce: (contents, estimate) =>
        this._enforceAndLogProviderContents(
          contents,
          provider,
          prompt_id,
          estimate,
        ),
      fallbackEstimate: (contents) =>
        this.compressionHandler.estimatePendingTokens(contents),
      send: (contents, prepared) =>
        timing.measure(() =>
          this._executeProviderCall(
            provider,
            requestParams,
            prompt_id,
            contents,
            providerBaseUrl,
            toolSelection,
            runtimeContext,
            prepared,
          ),
        ),
      shouldRetryOnError: shouldRetryDirectProviderError,
      signal: requestParams.config?.abortSignal,
    });
  }

  /**
   * Executes the actual provider.generateChatCompletion call.
   */
  private async _executeProviderCall(
    provider: IProvider,
    params: SendMessageParams,
    promptId: string,
    requestContents: IContent[],
    providerBaseUrl: string | undefined,
    toolSelection: ToolSelectionHookResult,
    runtimeContext: ProviderRuntimeContext,
    preparedAtEnforcement?: Awaited<ReturnType<typeof prepareAtSendSeam>>,
  ): Promise<ModelOutput> {
    const tools = toolSelection.tools;
    const allowedFunctionNames = toolSelection.allowedFunctionNames;
    this._logToolDiagnostics(provider, tools, providerBaseUrl);
    const timeoutController = new AbortController();
    const upstreamAbortSignal = params.config?.abortSignal;
    const onAbort = () => timeoutController.abort();
    upstreamAbortSignal?.addEventListener('abort', onAbort, { once: true });
    if (upstreamAbortSignal?.aborted === true) {
      onAbort();
    }

    try {
      const prepared =
        preparedAtEnforcement ??
        (await prepareAtSendSeam(
          provider,
          this._buildProviderChatOptions(
            requestContents,
            tools,
            runtimeContext,
            timeoutController.signal,
            params.config?.providerRequestContext,
          ),
        ));
      this.currentPromptEnvelopeEstimate = prepared.estimate;
      recordFinalizedPromptEnvelopeEstimate(
        this.compressionHandler.tokenUsageLogger,
        promptId,
        prepared.estimate,
        provider.name,
      );
      const transportPrepared = bindPreparedTransportSignal(
        prepared,
        timeoutController.signal,
      );

      const streamResponse = provider.generateChatCompletion(
        transportPrepared.options,
      );
      const lastResponse = await this._consumeProviderStream(
        streamResponse,
        runtimeContext,
        timeoutController,
        upstreamAbortSignal,
      );
      const output = toModelStreamChunk(lastResponse);
      this._applyHookToolFiltering(output, lastResponse, allowedFunctionNames);
      return output;
    } catch (error) {
      this.currentPromptEnvelopeEstimate = null;
      throw error;
    } finally {
      timeoutController.abort();
      upstreamAbortSignal?.removeEventListener('abort', onAbort);
    }
  }

  private _applyHookToolFiltering(
    output: ModelStreamChunk,
    _lastResponse: IContent,
    allowedFunctionNames: string[] | undefined,
  ): void {
    if (allowedFunctionNames === undefined) return;
    output.content = {
      ...output.content,
      blocks: filterHookRestrictedBlocks(
        output.content.blocks,
        allowedFunctionNames,
      ),
    };
    // P13 AFC boundary: toModelStreamChunk already extracted AFC into
    // output.afcHistory and stripped it from providerMetadata. Apply
    // hook-restriction filtering to the first-class afcHistory field only.
    if (output.afcHistory !== undefined) {
      output.afcHistory = filterAfcByHookRestrictions(
        output.afcHistory,
        allowedFunctionNames,
      );
    }
  }

  private _buildProviderChatOptions(
    requestContents: IContent[],
    tools: ToolGroupArray | undefined,
    runtimeContext: ProviderRuntimeContext,
    timeoutSignal: AbortSignal,
    requestContext: Record<string, unknown> | undefined,
  ): GenerateChatOptions {
    return buildProviderChatOptions(
      requestContents,
      tools,
      runtimeContext,
      {
        signal: timeoutSignal,
      } as GenerateChatOptions['invocation'],
      requestContext,
      this.generationConfig.systemInstruction,
    );
  }

  private async _consumeProviderStream(
    streamResponse: AsyncIterable<IContent>,
    runtimeContext: ProviderRuntimeContext,
    timeoutController: AbortController,
    upstreamAbortSignal: AbortSignal | undefined,
  ): Promise<IContent> {
    let lastResponse: IContent | undefined;
    const blocks: IContent['blocks'] = [];
    const iterator = streamResponse[Symbol.asyncIterator]();
    const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(
      runtimeContext.config,
    );

    let nextResponse = await readProviderStreamResponse(
      iterator,
      timeoutController,
      upstreamAbortSignal,
      effectiveTimeoutMs,
    );
    while (nextResponse.done !== true) {
      const iContent = nextResponse.value;
      this._trackProviderPromptTokens(iContent);
      blocks.push(...iContent.blocks);
      lastResponse = iContent;
      nextResponse = await readProviderStreamResponse(
        iterator,
        timeoutController,
        upstreamAbortSignal,
        effectiveTimeoutMs,
      );
    }

    if (!lastResponse) throw new Error('No response from provider');
    return { ...lastResponse, blocks };
  }

  private _trackProviderPromptTokens(iContent: IContent): void {
    const promptTokens = iContent.metadata?.usage?.promptTokens;
    if (promptTokens === undefined) {
      return;
    }

    this.lastPromptTokenCount = promptTokens;
    this.compressionHandler.lastPromptTokenCount = this.lastPromptTokenCount;
  }
  private _selectRequestTools(
    params: SendMessageParams,
  ): AgentClientGenerateConfig['tools'] {
    return params.config?.tools ?? this.generationConfig.tools;
  }

  private _normalizeRequestTools(
    params: SendMessageParams,
  ): ToolGroupArray | undefined {
    const tools = this._selectRequestTools(params);
    return Array.isArray(tools) ? (tools as ToolGroupArray) : undefined;
  }

  private async _applyToolSelectionHook(
    configForHooks: Config | undefined,
    tools: AgentClientGenerateConfig['tools'],
  ): Promise<ToolSelectionHookResult> {
    const toolsFromConfig = Array.isArray(tools)
      ? (tools as ToolGroupArray)
      : [];
    if (
      configForHooks === undefined ||
      typeof configForHooks.getEnableHooks !== 'function' ||
      configForHooks.getEnableHooks() !== true
    ) {
      return {
        tools: toolsFromConfig,
        allowedFunctionNames: undefined,
      };
    }

    const hookSystem = configForHooks.getHookSystem();
    if (hookSystem === undefined) {
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    }

    await hookSystem.initialize();
    const toolSelectionResult =
      await hookSystem.fireBeforeToolSelectionEvent(toolsFromConfig);
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });
    const allowedFunctions = modifiedConfig?.toolConfig?.allowedFunctionNames;
    if (!Array.isArray(allowedFunctions)) {
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    }

    const allowedNames = new Set(allowedFunctions.map(canonicalizeToolName));
    const filteredTools = toolsFromConfig
      .map((toolGroup) => ({
        ...toolGroup,
        functionDeclarations: toolGroup.functionDeclarations.filter((fn) =>
          allowedNames.has(canonicalizeToolName(fn.name)),
        ),
      }))
      .filter((toolGroup) => toolGroup.functionDeclarations.length > 0);
    return { tools: filteredTools, allowedFunctionNames: allowedFunctions };
  }

  private _logToolDiagnostics(
    provider: IProvider,
    tools: unknown,
    baseUrl: string | undefined,
  ): void {
    if (Array.isArray(tools)) {
      const total = tools.reduce((sum, g) => {
        if (
          typeof g === 'object' &&
          g !== null &&
          'functionDeclarations' in g &&
          Array.isArray(g.functionDeclarations)
        )
          return sum + g.functionDeclarations.length;
        return sum;
      }, 0);
      if (total === 0)
        this.logger.warn(
          () =>
            `[TurnProcessor] Tools array exists but has 0 function declarations!`,
          { tools, provider: provider.name },
        );
    }
    this.logger.debug(
      () => '[TurnProcessor] Calling provider.generateChatCompletion',
      {
        providerName: provider.name,
        model: this.runtimeContext.state.model,
        toolCount: Array.isArray(tools) ? tools.length : 0,
        baseUrl,
      },
    );
  }

  /**
   * Commits the send result to history: adds user and model content, syncs tokens.
   */
  private async _commitSendResult(
    response: ModelOutput,
    userContents: IContent[],
    _params: SendMessageParams,
    _prompt_id: string,
  ): Promise<void> {
    try {
      const currentModel = this.runtimeContext.state.model;
      const afcHistory = response.afcHistory;

      const filteredAfcHistory =
        afcHistory && afcHistory.length > 0
          ? afcHistory.filter((content: IContent) => content.blocks.length > 0)
          : undefined;
      if (filteredAfcHistory && filteredAfcHistory.length > 0) {
        this._recordAfcHistory(filteredAfcHistory, currentModel);
      } else {
        this._recordUserContents(userContents, currentModel);
      }

      this._recordOutputContent(response, currentModel, filteredAfcHistory);

      await this._syncTokenCounts(response, _prompt_id);
    } finally {
      this.eagerlyRecordedToolResponseCallIds.clear();
    }
  }

  private _recordAfcHistory(
    afcHistory: IContent[],
    currentModel: string | undefined,
  ): void {
    const curatedHistory = this.historyService.getCurated();
    const index = curatedHistory.length;
    const newEntries = afcHistory.slice(index);
    const baseURL = this.runtimeContext.state.baseUrl;
    for (const content of newEntries) {
      // AFC history is mixed user/model; stampAiTurnModel no-ops on non-ai
      // entries, so only freshly generated model turns get the origin stamp.
      this.historyService.add(
        stampAiTurnModel(content, currentModel, baseURL),
        currentModel,
      );
    }
  }

  private _recordUserContents(
    userContents: IContent[],
    currentModel: string | undefined,
  ): void {
    for (const content of userContents) {
      this.historyService.add(content, currentModel);
    }
  }

  private _recordOutputContent(
    response: ModelOutput,
    currentModel: string | undefined,
    afcHistory: IContent[] | undefined,
  ): void {
    const outputContent = response.content;
    const baseURL = this.runtimeContext.state.baseUrl;
    if (outputContent.blocks.length > 0) {
      const includeThoughts =
        this.runtimeContext.ephemerals.reasoning.includeInContext();
      const allowedTools = response.hookRestrictions?.allowedToolNames;
      const blocks = outputContent.blocks;
      const filteredBlocks = allowedTools
        ? filterHookRestrictedBlocks(blocks, allowedTools)
        : blocks;
      const contentForHistory = includeThoughts
        ? filteredBlocks
        : filteredBlocks.filter((b: ContentBlock) => b.type !== 'thinking');

      if (contentForHistory.length > 0) {
        this.historyService.add(
          stampAiTurnModel(
            iContentFromBlocks(contentForHistory, 'ai'),
            currentModel,
            baseURL,
          ),
          currentModel,
        );
      }
    } else if (!afcHistory || afcHistory.length === 0) {
      this.historyService.add(
        stampAiTurnModel(
          iContentFromBlocks([], 'ai'),
          currentModel,
          baseURL,
        ),
        currentModel,
      );
    }
  }

  private async _syncTokenCounts(
    response: ModelOutput,
    promptId?: string,
  ): Promise<void> {
    await this.historyService.waitForTokenUpdates();
    const usage = response.usage;
    if (usage?.promptTokens !== undefined) {
      const combined = usage.promptTokens;
      if (combined > 0) {
        this.historyService.syncTotalTokens(combined);
        await this.historyService.waitForTokenUpdates();
      }
    } else if (
      this.lastPromptTokenCount != null &&
      this.lastPromptTokenCount > 0 &&
      !Number.isNaN(this.lastPromptTokenCount)
    ) {
      this.historyService.syncTotalTokens(this.lastPromptTokenCount);
      await this.historyService.waitForTokenUpdates();
    }

    if (promptId !== undefined) {
      let usageForLogging: ActualTokenUsageInput | undefined;
      if (usage) {
        usageForLogging = {
          promptTokens: usage.promptTokens,
          cachedTokens: usage.cachedTokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        };
      } else if (
        this.lastPromptTokenCount !== null &&
        this.lastPromptTokenCount > 0
      ) {
        usageForLogging = { promptTokens: this.lastPromptTokenCount };
      }
      await recordActualTokenUsage(
        this.compressionHandler.tokenUsageLogger,
        promptId,
        usageForLogging,
      );
    }
  }
}
