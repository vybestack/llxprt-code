/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Content,
  type GenerateContentConfig,
  type SendMessageParameters,
  ApiError,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import type { IContent } from '../services/history/IContent.js';
import type { IProvider, ProviderToolset } from '../providers/IProvider.js';
import { DebugLogger } from '../debug/index.js';
import type { CompressionHandler } from './compression/CompressionHandler.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { StreamProcessor } from './StreamProcessor.js';
import {
  normalizeToolInteractionInput,
  convertIContentToResponse,
} from './MessageConverter.js';
import {
  StreamEventType,
  type StreamEvent,
  InvalidStreamError,
  EmptyStreamError,
  isThoughtPart,
  isSchemaDepthError,
  INVALID_CONTENT_RETRY_OPTIONS,
  type UsageMetadataWithCache,
} from './geminiChatTypes.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './geminiChat.js';
import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
import { hasCycleInSchema } from '../tools/tools.js';

/**
 * Handles turn-level operations: sendMessage, sendMessageStream, waitForIdle.
 * Orchestrates non-streaming sends and delegates streaming to StreamProcessor.
 */
export class TurnProcessor {
  private logger = new DebugLogger('llxprt:turn-processor');
  private sendPromise: Promise<void> = Promise.resolve();
  private lastPromptTokenCount: number | null = null;

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly compressionHandler: CompressionHandler,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRuntimeContext,
    private readonly generationConfig: GenerateContentConfig,
    private readonly historyService: HistoryService,
    private readonly streamProcessor: StreamProcessor,
    private readonly makePositionMatcher: () =>
      | (() => { historyId: string; toolName?: string })
      | undefined,
    private readonly resolveProviderBaseUrl: (
      provider: IProvider,
    ) => string | undefined,
  ) {}

  /**
   * Sends a non-streaming message to the provider.
   * Waits for previous send, prepares message, calls provider, commits result to history.
   */
  async sendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    await this.sendPromise;

    this.lastPromptTokenCount = null;

    const prepared = await this._prepareSendMessage(params, prompt_id);

    const provider = this.providerResolver('sendMessage');
    const response = await this._executeSendWithRetry(
      params,
      prepared.userIContents,
      provider,
      prompt_id,
    );

    this.sendPromise = this._commitSendResult(
      response,
      prepared.userContent,
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
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    await this.sendPromise;
    this.lastPromptTokenCount = null;

    const userContent: Content | Content[] = normalizeToolInteractionInput(
      params.message,
    );
    const userIContents = this._convertToIContents(userContent);

    const pendingTokens = await this.estimatePendingTokens(userIContents);
    await this.compressionHandler.ensureCompressionBeforeSend(
      prompt_id,
      pendingTokens,
      'stream',
      'auto',
    );

    let streamDoneResolver: () => void;
    this.sendPromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });

    return this._createStreamGenerator(
      params,
      prompt_id,
      pendingTokens,
      userContent,
      () => streamDoneResolver!(),
    );
  }

  private async *_createStreamGenerator(
    params: SendMessageParameters,
    prompt_id: string,
    pendingTokens: number,
    userContent: Content | Content[],
    onDone: () => void,
  ): AsyncGenerator<StreamEvent> {
    try {
      let lastError: unknown = new Error('Request failed after all retries.');
      for (
        let attempt = 0;
        attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;
        attempt++
      ) {
        try {
          if (attempt > 0) yield { type: StreamEventType.RETRY };

          const currentParams = this._applyRetryTemperature(params, attempt);
          const stream = await this.streamProcessor.makeApiCallAndProcessStream(
            currentParams,
            prompt_id,
            pendingTokens,
            userContent,
          );
          for await (const chunk of stream) {
            yield { type: StreamEventType.CHUNK, value: chunk };
          }
          lastError = null;
          break;
        } catch (error) {
          // Handle hook execution control errors before retry logic
          if (error instanceof AgentExecutionStoppedError) {
            yield {
              type: StreamEventType.AGENT_EXECUTION_STOPPED,
              reason: error.reason,
              systemMessage: error.systemMessage,
              contextCleared: error.contextCleared,
            };
            lastError = null;
            break;
          }

          if (error instanceof AgentExecutionBlockedError) {
            yield {
              type: StreamEventType.AGENT_EXECUTION_BLOCKED,
              reason: error.reason,
              systemMessage: error.systemMessage,
              contextCleared: error.contextCleared,
            };
            // If there's a synthetic response, yield it as a chunk
            if (error.syntheticResponse) {
              yield {
                type: StreamEventType.CHUNK,
                value: error.syntheticResponse,
              };
            }
            lastError = null;
            break;
          }

          lastError = error;
          if (
            (error instanceof InvalidStreamError ||
              error instanceof EmptyStreamError) &&
            attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1
          ) {
            await new Promise((res) =>
              setTimeout(
                res,
                INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs * (attempt + 1),
              ),
            );
            continue;
          }
          break;
        }
      }
      if (lastError) throw lastError;
    } finally {
      onDone();
    }
  }

  private _applyRetryTemperature(
    params: SendMessageParameters,
    attempt: number,
  ): SendMessageParameters {
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

  private _convertToIContents(userContent: Content | Content[]): IContent[] {
    const contents = Array.isArray(userContent) ? userContent : [userContent];
    const matcher = this.makePositionMatcher();
    return contents.map((content) => {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      return ContentConverters.toIContent(content, idGen, matcher, turnKey);
    });
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

  /**
   * Estimates the token count for pending IContent items.
   */
  async estimatePendingTokens(contents: IContent[]): Promise<number> {
    return this.compressionHandler.estimatePendingTokens(contents);
  }

  /**
   * Prepares user message: validates, converts input, estimates tokens, compresses if needed.
   */
  private async _prepareSendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<{
    userContent: Content | Content[];
    userIContents: IContent[];
    pendingTokens: number;
  }> {
    const userContent = normalizeToolInteractionInput(params.message);
    const userIContents = this._convertToIContents(userContent);

    const pendingTokens = await this.estimatePendingTokens(userIContents);
    await this.compressionHandler.ensureCompressionBeforeSend(
      prompt_id,
      pendingTokens,
      'send',
      'auto',
    );

    const provider = this.providerResolver('sendMessage');
    await this.compressionHandler.enforceContextWindow(
      pendingTokens,
      prompt_id,
      provider,
    );

    return { userContent, userIContents, pendingTokens };
  }

  /**
   * Executes the provider call with retry and bucket failover.
   */
  private async _executeSendWithRetry(
    params: SendMessageParameters,
    userIContents: IContent[],
    provider: IProvider,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    this._validateProvider(provider);
    const iContents = this.historyService.getCuratedForProvider(userIContents);
    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      ContentConverters.toGeminiContents(iContents),
      this.runtimeContext.state.model,
      prompt_id,
    );

    const providerBaseUrl = this.resolveProviderBaseUrl(provider);
    const startTime = Date.now();

    try {
      const response = await retryWithBackoff(
        () =>
          this._executeProviderCall(
            provider,
            params,
            iContents,
            providerBaseUrl,
          ),
        {
          shouldRetryOnError: (error: unknown) => {
            if (error instanceof ApiError && error.message) {
              if (error.status === 400 || isSchemaDepthError(error.message))
                return false;
              if (
                error.status === 429 ||
                (error.status >= 500 && error.status < 600)
              )
                return true;
            }
            return false;
          },
          signal: params.config?.abortSignal,
        },
      );

      const durationMs = Date.now() - startTime;
      logApiResponse(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        prompt_id,
        durationMs,
        response.usageMetadata,
        JSON.stringify(response),
      );
      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logApiError(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        prompt_id,
        durationMs,
        error,
      );
      this._enrichSchemaDepthError(error);
      this.sendPromise = Promise.resolve();
      throw error;
    }
  }

  private _validateProvider(provider: IProvider): void {
    this.logger.debug(
      () => '[TurnProcessor] Active provider snapshot before send',
      {
        providerName: provider.name,
        providerDefaultModel: provider.getDefaultModel?.(),
        configModel: this.runtimeContext.state.model,
        baseUrl: this.resolveProviderBaseUrl(provider),
      },
    );
    if (typeof provider.generateChatCompletion !== 'function') {
      throw new Error(
        `Provider ${provider.name} does not support IContent interface`,
      );
    }
  }

  /**
   * Executes the actual provider.generateChatCompletion call.
   */
  private async _executeProviderCall(
    provider: IProvider,
    params: SendMessageParameters,
    requestContents: IContent[],
    providerBaseUrl: string | undefined,
  ): Promise<GenerateContentResponse> {
    const tools = this.generationConfig.tools;
    this._logToolDiagnostics(provider, tools, providerBaseUrl);

    const runtimeContext = this.providerRuntimeBuilder(
      'TurnProcessor.executeProviderCall',
      { toolCount: tools?.length ?? 0 },
    );

    const streamResponse = provider.generateChatCompletion({
      contents: requestContents,
      tools: tools as ProviderToolset | undefined,
      config: runtimeContext.config,
      runtime: runtimeContext,
      settings: runtimeContext.settingsService,
      metadata: runtimeContext.metadata,
      userMemory: runtimeContext.config?.getUserMemory?.(),
    });

    let lastResponse: IContent | undefined;
    for await (const iContent of streamResponse) {
      const promptTokens = iContent.metadata?.usage?.promptTokens;
      if (promptTokens !== undefined) {
        const cacheReads =
          iContent.metadata?.usage?.cache_read_input_tokens || 0;
        const cacheWrites =
          iContent.metadata?.usage?.cache_creation_input_tokens || 0;
        this.lastPromptTokenCount = promptTokens + cacheReads + cacheWrites;
        this.compressionHandler.lastPromptTokenCount =
          this.lastPromptTokenCount;
      }
      lastResponse = iContent;
    }

    if (!lastResponse) throw new Error('No response from provider');
    return convertIContentToResponse(lastResponse);
  }

  private _logToolDiagnostics(
    provider: IProvider,
    tools: unknown,
    baseUrl: string | undefined,
  ): void {
    if (tools && Array.isArray(tools)) {
      const total = tools.reduce((sum, g) => {
        if (
          g &&
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
        toolCount: (tools as unknown[])?.length ?? 0,
        baseUrl,
      },
    );
  }

  /**
   * Commits the send result to history: adds user and model content, syncs tokens.
   */
  private async _commitSendResult(
    response: GenerateContentResponse,
    userContent: Content | Content[],
    _params: SendMessageParameters,
    _prompt_id: string,
  ): Promise<void> {
    const currentModel = this.runtimeContext.state.model;
    const afcHistory = response.automaticFunctionCallingHistory;

    if (afcHistory && afcHistory.length > 0) {
      this._recordAfcHistory(afcHistory, currentModel);
    } else {
      this._recordUserContent(userContent, currentModel);
    }

    this._recordOutputContent(response, currentModel, afcHistory);

    await this._syncTokenCounts(response);
  }

  private _recordAfcHistory(
    afcHistory: Content[],
    currentModel: string | undefined,
  ): void {
    const curatedHistory = this.historyService.getCurated();
    const index = ContentConverters.toGeminiContents(curatedHistory).length;
    const newEntries = afcHistory.slice(index) ?? [];
    const matcher = this.makePositionMatcher();
    for (const content of newEntries) {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      this.historyService.add(
        ContentConverters.toIContent(content, idGen, matcher, turnKey),
        currentModel,
      );
    }
  }

  private _recordUserContent(
    userContent: Content | Content[],
    currentModel: string | undefined,
  ): void {
    const contents = Array.isArray(userContent) ? userContent : [userContent];
    const matcher = this.makePositionMatcher();
    for (const content of contents) {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      this.historyService.add(
        ContentConverters.toIContent(content, idGen, matcher, turnKey),
        currentModel,
      );
    }
  }

  private _recordOutputContent(
    response: GenerateContentResponse,
    currentModel: string | undefined,
    afcHistory: Content[] | undefined,
  ): void {
    const outputContent = response.candidates?.[0]?.content;
    if (outputContent) {
      const includeThoughts =
        this.runtimeContext.ephemerals.reasoning.includeInContext();
      const contentForHistory = includeThoughts
        ? outputContent
        : {
            ...outputContent,
            parts: (outputContent.parts ?? []).filter((p) => !isThoughtPart(p)),
          };

      if ((contentForHistory.parts?.length ?? 0) > 0) {
        const turnKey = this.historyService.generateTurnKey();
        const idGen = this.historyService.getIdGeneratorCallback(turnKey);
        this.historyService.add(
          ContentConverters.toIContent(
            contentForHistory,
            idGen,
            undefined,
            turnKey,
          ),
          currentModel,
        );
      }
    } else if (
      response.candidates?.length &&
      (!afcHistory || afcHistory.length === 0)
    ) {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      this.historyService.add(
        ContentConverters.toIContent(
          { role: 'model', parts: [] } as Content,
          idGen,
          undefined,
          turnKey,
        ),
        currentModel,
      );
    }
  }

  private async _syncTokenCounts(
    response: GenerateContentResponse,
  ): Promise<void> {
    await this.historyService.waitForTokenUpdates();
    const usageMetadata = response.usageMetadata as
      | UsageMetadataWithCache
      | undefined;
    if (usageMetadata?.promptTokenCount !== undefined) {
      const combined =
        usageMetadata.promptTokenCount +
        (usageMetadata.cache_read_input_tokens || 0) +
        (usageMetadata.cache_creation_input_tokens || 0);
      if (combined > 0) {
        this.historyService.syncTotalTokens(combined);
        await this.historyService.waitForTokenUpdates();
      }
    } else if (this.lastPromptTokenCount) {
      // lastPromptTokenCount is already cache-adjusted (includes
      // cache_read + cache_creation tokens) from the provider call path
      if (this.lastPromptTokenCount > 0) {
        this.historyService.syncTotalTokens(this.lastPromptTokenCount);
        await this.historyService.waitForTokenUpdates();
      }
    }
  }

  /**
   * Enriches schema depth errors with additional context for debugging.
   */
  private _enrichSchemaDepthError(error: unknown): void {
    if (
      error instanceof ApiError &&
      error.message &&
      isSchemaDepthError(error.message)
    ) {
      const tools = this.generationConfig.tools;
      if (!tools || !Array.isArray(tools)) {
        return;
      }

      const toolNames: string[] = [];
      const cyclicSchemaTools: string[] = [];

      for (const toolGroup of tools) {
        if (
          toolGroup &&
          'functionDeclarations' in toolGroup &&
          Array.isArray(toolGroup.functionDeclarations)
        ) {
          for (const funcDecl of toolGroup.functionDeclarations) {
            const name = funcDecl.name || 'unknown';
            toolNames.push(name);
            if (
              funcDecl.parametersJsonSchema &&
              typeof funcDecl.parametersJsonSchema === 'object'
            ) {
              if (
                hasCycleInSchema(
                  funcDecl.parametersJsonSchema as Record<string, unknown>,
                )
              ) {
                cyclicSchemaTools.push(name);
              }
            }
          }
        }
      }

      const metadata = {
        totalTools: toolNames.length,
        toolNames,
        cyclicSchemaTools,
      };

      const extraDetails =
        cyclicSchemaTools.length > 0
          ? `\n\nTools with cyclic schemas detected: ${cyclicSchemaTools.join(', ')}\n` +
            `This is a known issue that can cause "maximum schema depth exceeded" errors.\n` +
            `Please review the schema definitions for these tools.`
          : '';

      this.logger.error(
        () => `[TurnProcessor] Schema depth error encountered${extraDetails}`,
        metadata,
      );
    }
  }
}
