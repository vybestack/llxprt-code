/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getRequestSignal } from '../utils/abortSignal.js';
import { prepareKimiProviderFiles } from './kimi-provider-file-preparation.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { readInvocationPolicyRecord } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { captureResponsesRequest } from '../openai-responses/responses-request.js';
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import type OpenAI from 'openai';
import {
  logOpenAIChatTools,
  logOpenAIRequestDiagnostics,
} from './openai-request-diagnostics.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

import { type IProviderConfig } from '../types/IProviderConfig.js';
import { firstTruthyString } from '../utils/falsyFallback.js';

import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ToolFormatter } from '@vybestack/llxprt-code-tools/ToolFormatter.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import { type IModel } from '../IModel.js';
import { getOpenAIFallbackModels } from './openAIFallbackModels.js';
import { type IProvider, type GenerateChatOptions } from '../IProvider.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';

import { ToolCallPipeline } from './ToolCallPipeline.js';

import { isLocalEndpoint } from '../utils/localEndpoint.js';
import { type DumpMode } from '../utils/dumpContext.js';
import { createCredentialResolutionError } from '../utils/credentialResolutionError.js';

import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import {
  resolveOpenAITransport,
  resolveExplicitTransportModeFromSources,
  extractOpenAIModelParams,
} from './openaiModelPolicy.js';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from '../openai-responses/openAIResponsesExecutor.js';
import type {
  ChatRowInput,
  RequestContext,
} from './OpenAIRequestPreparation.js';
import type {
  ChatContinuation,
  ContinuationBody,
} from './OpenAIChatContinuation.js';
import type { RowsMediaInput } from '../openai-responses/responses-row-media.js';
import {
  OpenAIPromptEnvelopeStore,
  prepareOpenAIPromptProjection,
} from './OpenAIPromptEnvelopeStore.js';
import {
  prepareOwnedOpenAIChatRequest,
  prepareOpenAIChatProjection,
  readOpenAIMediaSupport,
  withProjectionModel,
} from './OpenAIPromptProjectionPreparation.js';
import { closeStagedRowsAfterFailure } from '../BaseProviderNormalization.js';
import {
  buildProjectionResponsesContext,
  preparedSourceInputs,
  resolveChatMediaRequest,
  resolveResponsesSendContext,
  restorePreparedSourceInputs,
} from './OpenAISourceRoute.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
  type resolveRequestMedia,
  captureRequestMediaInput,
} from '../utils/request-media-resolution.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { resolveRawTokenDeltaNotifier } from '../logging/attemptLifecycle.js';
import type { ModelDefaultRule } from '../composition/providerAliases.js';
import { createUnallowedModelParametersResolver as makeResolver } from '../openai-responses/unallowedModelParameters.js';

import type { ContinuationToolCall } from './OpenAIRequestBuilder.js';
import { aiTextContent, continuationTexts } from './OpenAIStreamChunkText.js';
import {
  createHttpAgents,
  resolveRuntimeKey,
  instantiateClient,
  mergeInvocationHeaders,
} from './OpenAIClientFactory.js';

/**
 * Typed options object for {@link OpenAIProvider.dispatchResponse}.
 *
 * @issue #2524 — Replaces the 12-positional-parameter list for clarity and
 *   safety.
 */
interface DispatchResponseOptions {
  response:
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    | OpenAI.Chat.Completions.ChatCompletion;
  model: string;
  detectedFormat: string;
  streamingEnabled: boolean;
  abortSignal: AbortSignal | undefined;
  /** Builds the request that follows tool calls with no text. */
  continuation: ChatContinuation;
  client: OpenAI;
  mergedHeaders: Record<string, string> | undefined;
  baseURL: string | undefined;
  logger: DebugLogger;
  reasoningFieldName: string | undefined;
  /**
   * Raw token-delta timing notifier resolved from request metadata (issue
   * #3473). Undefined when no attempt-lifecycle observer is attached.
   */
  onRawTokenDelta: (() => void) | undefined;
}

export class OpenAIProvider extends BaseProvider implements IProvider {
  protected requestProviderFileLifecycle?: object;
  protected requestProviderFileBindings?: ProviderFileBindingStore;
  protected requestWorkspaceDirectory?: string;
  private readonly textToolParser = new GemmaToolCallParser();
  private readonly toolCallPipeline = new ToolCallPipeline();
  private readonly preparedPromptEnvelopes = new OpenAIPromptEnvelopeStore();
  private readonly getUnallowedModelParameters: ReturnType<typeof makeResolver>;

  protected getLogger(): DebugLogger {
    return new DebugLogger('llxprt:provider:openai');
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Captures static alias rules while keeping request state per call.
   */
  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    modelDefaultRules: readonly ModelDefaultRule[] = [],
  ) {
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    super(
      {
        name: 'openai',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'], // Support environment variable fallback
        isOAuthEnabled: false,
        mediaTransportCapabilities:
          declaredMediaTransportCapabilities('openai'),
      },
      config,
    );

    this.getUnallowedModelParameters = makeResolver(modelDefaultRules);

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002
    // Request-specific values remain sourced from normalized options per call.
  }

  /** The transport reads `requestRows` itself (issue #854 WP08). */
  protected override ownsRequestRowsTransport(): boolean {
    return true;
  }

  /** Chat and Responses calls both read their rows from disk (issue #854). */
  protected override takesRowsRoute(): boolean {
    return true;
  }

  protected override async releaseUnstartedOptions(
    options: NormalizedGenerateChatOptions,
  ): Promise<void> {
    const prepared = this.preparedPromptEnvelopes.get(
      options.promptEnvelopeTransportToken,
    );
    if (prepared === undefined) return;
    const mediaRequest =
      prepared.protocol === 'openai-chat'
        ? prepared.mediaRequest
        : prepared.requestContext.mediaRequest;
    await mediaRequest.release();
  }

  /**
   * Tool formatter instances cannot be shared between stateless calls,
   * so construct a fresh one for every invocation.
   *
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   */
  private createToolFormatter(): ToolFormatter {
    return new ToolFormatter();
  }

  private buildResponsesExecutorDeps(): ResponsesExecutorDeps {
    return {
      providerName: this.name,
      logger: new DebugLogger('llxprt:provider:openai'),
      isCodexMode: () => false,
      getCodexAccountId: async () => {
        throw new Error('Codex account ID not available for OpenAIProvider');
      },
      resolveAuthTokenForPrompt: async () => this.getAuthTokenForPrompt(),
      shouldRetryOnError: (error) => this.shouldRetryResponse(error),
      getMediaTransportCapabilities: () =>
        this.name === 'openai'
          ? declaredMediaTransportCapabilities('openai-responses')
          : this.getMediaTransportCapabilities(),
      getUnallowedModelParameters: this.getUnallowedModelParameters,
    };
  }

  private captureRequestMedia(
    options: NormalizedGenerateChatOptions,
  ): Parameters<typeof resolveRequestMedia>[0] {
    return captureRequestMediaInput(
      options.metadata['logicalRequestId'],
      options.invocation.runtimeId,
      this.requestMediaBudgetBytes,
      this.requestMediaResolver,
    );
  }

  private captureResponsesRequest(
    options: NormalizedGenerateChatOptions,
  ): ReturnType<typeof captureResponsesRequest> {
    return captureResponsesRequest(
      options,
      this.name,
      this.resolveEffectiveBaseURL(options) ?? 'https://api.openai.com/v1',
      this.getCustomHeaders(options),
      this.getDefaultModel(),
      this.requestMediaResolver,
      this.requestMediaBudgetBytes,
    );
  }

  private resolveOpenAIResponsesEnabled(
    policy = this.captureOwnerPolicy(),
  ): boolean | undefined {
    const providerValue = readInvocationPolicyRecord(policy[this.name])[
      'openaiResponsesEnabled'
    ];
    if (typeof providerValue === 'boolean') {
      return providerValue;
    }

    const globalValue = policy['openaiResponsesEnabled'];
    if (typeof globalValue === 'boolean') {
      return globalValue;
    }

    const defaults = this.captureOwnerDefaults();
    const configured = defaults['openaiResponsesEnabled'];
    return typeof configured === 'boolean' ? configured : undefined;
  }

  private resolveTransport(
    model: string,
    baseURL: string | undefined,
    policy = this.captureOwnerPolicy(),
  ): { useResponses: boolean } {
    const providerSettings = readInvocationPolicyRecord(policy[this.name]);
    const explicitMode = resolveExplicitTransportModeFromSources(
      providerSettings,
      () => policy['responses-mode'] as string | undefined,
    );
    return resolveOpenAITransport({
      model,
      baseURL,
      explicitMode,
      openaiResponsesEnabled: this.resolveOpenAIResponsesEnabled(policy),
    });
  }

  getOpenaiResponsesEnabled(): boolean | undefined {
    return this.resolveOpenAIResponsesEnabled();
  }

  protected async getClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;
    const requiresAuth = options.invocation.getProviderOverrides<
      Record<string, unknown>
    >(this.name)?.['requires-auth'];
    const authExempt = requiresAuth === false || isLocalEndpoint(baseURL);
    let authToken = '';
    try {
      authToken =
        (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    } catch (cause) {
      const failure = createCredentialResolutionError(options, this.name, {
        kind: 'credential-source-failed',
        cause,
      });
      if (!authExempt) {
        throw failure;
      }
      this.getLogger().debug(
        () =>
          `Continuing without credentials for auth-exempt endpoint after authentication resolution failed: ${failure.message}`,
      );
    }
    if (!authToken && !authExempt) {
      throw createCredentialResolutionError(options, this.name);
    }

    const agentSettings = options.invocation.ephemerals;
    const agents = createHttpAgents({ ...agentSettings });

    // Apply invocation/provider header overrides at client construction time.
    // Some OpenAI-compatible gateways (e.g., Kimi For Coding) enforce allowlisting
    // based on User-Agent, which must be sent as a real HTTP header.
    const headers = mergeInvocationHeaders(options);

    return instantiateClient(authToken, baseURL, agents, headers, {
      headersTimeoutMs: agentSettings['openai-headers-timeout-ms'] as
        | number
        | undefined,
      requestTimeoutMs: agentSettings['openai-request-timeout-ms'] as
        | number
        | undefined,
    });
  }

  /**
   * Check if OAuth is supported for this provider
   */
  protected supportsOAuth(): boolean {
    // Standard OpenAI endpoints don't support OAuth
    return false;
  }

  override async getModels(): Promise<IModel[]> {
    // HYDRATION NOTE: Registry lookup has been moved to ProviderManager.getAvailableModels()
    // This method now only fetches from the live API or falls back to hardcoded list.
    // The ProviderManager will hydrate these results with models.dev data.

    this.getLogger().debug(
      () => `[getModels] Called for provider: ${this.name}`,
    );

    try {
      // Try to fetch models from the provider's API
      // Local endpoints often work without authentication
      const authToken = await this.getAuthToken();
      const baseURL = this.getBaseURL();
      const agentSettings = this.providerConfig?.readConnectionPolicy?.() ?? {};
      const agents = createHttpAgents({ ...agentSettings });
      const client = instantiateClient(authToken, baseURL, agents);

      const modelsEndpoint = `${baseURL ?? 'https://api.openai.com/v1'}/models`;
      this.getLogger().debug(
        () =>
          `[getModels] Fetching models from: ${modelsEndpoint} (provider: ${this.name}, hasAuth: ${!!authToken})`,
      );

      const response = await client.models.list();
      const models: IModel[] = [];
      const allModelIds: string[] = [];

      for await (const model of response) {
        allModelIds.push(model.id);
        // Filter out non-chat models (embeddings, audio, image, vision, DALL·E, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          models.push({
            id: model.id,
            name: model.id,
            provider: this.name,
            supportedToolFormats: ['openai'],
          });
        }
      }

      this.getLogger().debug(
        () =>
          `[getModels] Response from ${modelsEndpoint}: total=${allModelIds.length}, filtered=${models.length}, models=${JSON.stringify(allModelIds)}`,
      );

      return models;
    } catch (error) {
      this.getLogger().debug(
        () => `Error fetching models from OpenAI: ${error}`,
      );
      // Return a hardcoded list as fallback
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    return getOpenAIFallbackModels(this.name);
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    // Check if this is a Qwen provider instance based on baseURL
    if (isQwenBaseURL(this.getBaseURL())) {
      return firstTruthyString(
        process.env.LLXPRT_DEFAULT_MODEL,
        'qwen3-coder-plus',
      );
    }
    return firstTruthyString(process.env.LLXPRT_DEFAULT_MODEL, 'gpt-5.5');
  }

  /**
   * Get the currently selected model
   */
  override getCurrentModel(): string {
    return this.getModel();
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * No-op retained for compatibility because clients are no longer cached.
   */
  clearClientCache(runtimeKey?: string): void {
    void runtimeKey;
  }

  /**
   * Override isAuthenticated to check the direct API key first.
   */
  override async isAuthenticated(): Promise<boolean> {
    const directApiKey = this.baseProviderConfig.apiKey;
    if (typeof directApiKey === 'string' && directApiKey.trim() !== '') {
      return true;
    }

    try {
      const nonOAuthToken = await this.authResolver.resolveAuthentication({
        includeOAuth: false,
      });
      if (typeof nonOAuthToken === 'string' && nonOAuthToken.trim() !== '') {
        return true;
      }
    } catch (error) {
      if (process.env.DEBUG) {
        this.getLogger().debug(
          () =>
            `[openai] non-OAuth authentication resolution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return super.isAuthenticated();
  }

  /**
   * Clear all provider state (for provider switching)
   * Clears both OpenAI client cache and auth token cache
   */
  override clearState(): void {
    // Clear OpenAI client cache
    this.clearClientCache();
    // Clear auth token cache from BaseProvider
    this.clearAuthCache();
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   * @pseudocode provider-invocation.md lines 8-12
   */
  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * Generate chat completion with per-call client instantiation.
   */
  private resolveAdmittedTransport(
    options: NormalizedGenerateChatOptions,
  ): ReturnType<OpenAIProvider['resolveTransport']> {
    return this.resolveTransport(
      options.resolved.model,
      options.resolved.baseURL,
      options.invocation.ephemerals,
    );
  }

  private async *sendResponses(
    options: NormalizedGenerateChatOptions,
    prepared: ReturnType<OpenAIPromptEnvelopeStore['get']>,
  ): AsyncIterableIterator<IContent> {
    if (prepared?.protocol === 'openai-chat') {
      await finishMediaRequest(prepared.mediaRequest, {
        status: 'failed',
        error: new Error(
          'Prepared OpenAI Chat envelope cannot be sent through Responses transport',
        ),
      });
      return;
    }
    const request = this.captureResponsesRequest(options);
    const deps = this.buildResponsesExecutorDeps();
    yield* executeOpenAIResponsesRequest(
      request,
      deps,
      await resolveResponsesSendContext(
        options,
        request,
        deps,
        prepared?.requestContext,
      ),
    );
  }

  protected override async *generateChatCompletionWithOptions(
    callOptions: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    // An unknown token fails with its transport's message before the blanked
    // prompt inputs of a rows-route call are restored from it.
    const decision = this.resolveAdmittedTransport(callOptions);
    const prepared = this.preparedPromptEnvelopes.get(
      callOptions.promptEnvelopeTransportToken,
    );
    if (
      callOptions.promptEnvelopeTransportToken !== undefined &&
      prepared === undefined
    ) {
      throw new Error(
        decision.useResponses
          ? 'Unknown OpenAI Responses prompt-envelope transport token'
          : 'Unknown OpenAI Chat prompt-envelope transport token',
      );
    }
    const options = restorePreparedSourceInputs(
      callOptions,
      this.preparedPromptEnvelopes,
    );
    // Issue #3136: the agent layer owns system-prompt assembly. Fail fast
    // before any request preparation so a missing instruction is never
    // silently transported as an empty prompt.
    requireAssembledSystemInstruction(options.systemInstruction);
    if (decision.useResponses) {
      yield* this.sendResponses(options, prepared);
      return;
    }
    if (prepared?.protocol === 'openai-responses') {
      await finishMediaRequest(prepared.requestContext.mediaRequest, {
        status: 'failed',
        error: new Error(
          'Prepared OpenAI Responses envelope cannot be sent through Chat transport',
        ),
      });
      return;
    }

    const mediaRequest = await resolveChatMediaRequest(
      options,
      prepared,
      this.captureRequestMedia(options),
    );
    let outcome: MediaRequestOutcome = { status: 'succeeded' };
    try {
      const callFormatter = this.createToolFormatter();
      const client = await this.getClient(options);
      const runtimeKey = resolveRuntimeKey(options);
      const logger = new DebugLogger('llxprt:provider:openai');
      logOpenAIChatTools(options, runtimeKey, logger);

      yield* this.generateChatCompletionImpl(
        options,
        callFormatter,
        client,
        logger,
        mediaRequest,
        prepared?.requestContext,
      );
    } catch (error) {
      outcome = { status: 'failed', error };
    } finally {
      await finishMediaRequest(mediaRequest, outcome);
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Legacy implementation for chat completion using accumulated tool calls approach
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const providerSettings = readInvocationPolicyRecord(
        this.captureOwnerPolicy()[this.name],
      );

      return extractOpenAIModelParams(providerSettings);
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get OpenAI provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Pipeline implementation for chat completion using optimized tool call pipeline
   */

  private logRequestContext(
    options: NormalizedGenerateChatOptions,
    requestContext: RequestContext,
    baseURL: string | undefined,
    logger: DebugLogger,
  ): void {
    logOpenAIRequestDiagnostics(
      this.name,
      options,
      requestContext,
      () => baseURL ?? this.getBaseURL(),
      logger,
    );
  }

  private async *dispatchResponse(
    options: DispatchResponseOptions,
  ): AsyncGenerator<IContent, void, unknown> {
    const { processStreamingResponse } = await import(
      './OpenAIStreamProcessor.js'
    );
    const { handleNonStreamingResponse } = await import(
      './OpenAINonStreamHandler.js'
    );
    if (options.streamingEnabled) {
      const deps = {
        toolCallPipeline: this.toolCallPipeline,
        textToolParser: this.textToolParser,
        logger: options.logger,
        getBaseURL: () => this.getBaseURL(),
        reasoningFieldName: options.reasoningFieldName,
        onRawTokenDelta: options.onRawTokenDelta,
      };
      yield* processStreamingResponse(
        options.response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        options.model,
        options.detectedFormat,
        options.abortSignal,
        options.baseURL,
        deps,
        (toolCalls) =>
          this.requestContinuationAfterToolCalls(toolCalls, options),
      );
    } else {
      const deps = {
        toolCallPipeline: this.toolCallPipeline,
        textToolParser: this.textToolParser,
        logger: options.logger,
      };
      yield* handleNonStreamingResponse(
        options.response as OpenAI.Chat.Completions.ChatCompletion,
        options.model,
        options.detectedFormat,
        deps,
      );
    }
  }

  /**
   * Kimi-only media pre-pass (see {@link prepareKimiProviderFiles}): the media
   * stage to write the body through, or `undefined` when the request has no
   * pre-pass.
   */
  private maybeProcessKimiMedia(
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
    media: RowsMediaInput,
  ): Promise<ChatRowInput | undefined> {
    return prepareKimiProviderFiles(
      options,
      client,
      logger,
      mediaRequest,
      this.name,
      this.getMediaTransportCapabilities(),
      this.requestProviderFileBindings,
      this.requestProviderFileLifecycle,
      this.requestWorkspaceDirectory,
      media,
    );
  }

  private async *generateChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
    preparedRequestContext?: RequestContext,
  ): AsyncGenerator<IContent, void, unknown> {
    const abortSignal = getRequestSignal(options);
    const ephemeralSettings = (
      options.invocation as { ephemerals?: Readonly<Record<string, unknown>> }
    ).ephemerals;

    const { executeApiRequest } = await import('./OpenAIApiExecution.js');
    const { mergeInvocationHeaders } = await import('./OpenAIClientFactory.js');

    const requestContext =
      preparedRequestContext ??
      (await this.prepareChatRequest(options, client, logger, mediaRequest));

    const {
      model,
      detectedFormat,
      formattedTools,
      streamingEnabled,
      spool,
      dump,
      continuation,
    } = requestContext;
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    this.logRequestContext(options, requestContext, baseURL, logger);

    const customHeaders = this.getCustomHeaders();
    const mergedHeaders = mergeInvocationHeaders(options, customHeaders);
    const dumpMode = ephemeralSettings?.dumpcontext as DumpMode | undefined;

    const response = await executeApiRequest({
      client,
      spool,
      dumpBody: dump,
      abortSignal,
      mergedHeaders,
      dumpMode,
      baseURL,
      model,
      formattedTools,
      streamingEnabled,
      logger,
      getBaseURL: () => this.getBaseURL(),
    });

    const reasoningFieldName = options.invocation.getEphemeral<string>(
      'reasoning.fieldName',
    );

    yield* this.dispatchResponse({
      response,
      model,
      detectedFormat,
      streamingEnabled,
      abortSignal,
      continuation,
      client,
      mergedHeaders,
      baseURL,
      logger,
      reasoningFieldName,
      onRawTokenDelta: resolveRawTokenDeltaNotifier(options.metadata),
    });
  }

  /**
   * Writes the body of an unprojected send. The Kimi media pre-pass (upload
   * PDFs via the Files API and replace them with file-id references so large
   * documents stay out of the token budget) only activates for Kimi aliases
   * with mediaSupport.fileUpload enabled; every other request resolves media
   * row by row while the body is written.
   */
  private async prepareChatRequest(
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
  ): Promise<RequestContext> {
    const media = this.captureRequestMedia(options);
    return prepareOwnedOpenAIChatRequest(
      options,
      mediaRequest,
      media,
      this.getDefaultModel(),
      logger,
      this.name,
      this.getMediaTransportCapabilities(),
      await this.maybeProcessKimiMedia(
        options,
        client,
        logger,
        mediaRequest,
        media,
      ),
    );
  }

  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const normalized = await this.normalizeOptionsForProjection(
      withProjectionModel(
        options,
        () => this.getModel() || this.getDefaultModel(),
      ),
    );
    return this.prepareProjection(normalized).catch((error: unknown) =>
      closeStagedRowsAfterFailure(normalized.stagedRows, error),
    );
  }

  private prepareProjection(
    normalized: NormalizedGenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    return prepareOpenAIPromptProjection({
      ...preparedSourceInputs(normalized),
      useResponses: this.resolveTransport(
        normalized.resolved.model,
        normalized.resolved.baseURL ?? this.baseProviderConfig.baseURL,
        normalized.invocation.ephemerals,
      ).useResponses,
      store: this.preparedPromptEnvelopes,
      prepareResponses: () =>
        buildProjectionResponsesContext(
          this.captureResponsesRequest(normalized),
          this.buildResponsesExecutorDeps(),
          normalized.stagedRows,
        ),
      prepareChat: () =>
        prepareOpenAIChatProjection(
          normalized,
          this.chatProjectionDeps(normalized),
          this.requestMediaResolver,
          this.requestMediaBudgetBytes,
        ),
    });
  }

  private chatProjectionDeps(
    normalized: NormalizedGenerateChatOptions,
  ): Parameters<typeof prepareOpenAIChatProjection>[1] {
    return {
      readMediaSupport: () =>
        readOpenAIMediaSupport(
          normalized.invocation.providerDefaults.providerSpecific,
        ),
      getClient: (clientOptions) => this.getClient(clientOptions),
      resolveAuthToken: (authOptions) =>
        this.resolveProjectionAuthToken(authOptions),
      processMedia: (preparedOptions, client, logger, mediaRequest, media) =>
        this.maybeProcessKimiMedia(
          preparedOptions,
          client,
          logger,
          mediaRequest,
          media,
        ),
      logger: this.getLogger(),
      defaultModel: this.getDefaultModel(),
      providerName: this.name,
      mediaTransportCapabilities: this.getMediaTransportCapabilities(),
    };
  }

  override getToolFormat(): string {
    const modelName = this.getModel() || this.getDefaultModel();
    const settings = readInvocationPolicyRecord(
      this.captureOwnerPolicy()[this.name],
    );
    const logger = new DebugLogger('llxprt:provider:openai');
    const format = resolveToolFormat(
      modelName,
      this.name,
      settings.toolFormat,
      logger,
    );
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  parseToolResponse(response: unknown): unknown {
    // Follow-up (#1569): Implement response parsing based on detected format
    // For now, return the response as-is
    return response;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Determines whether a response should be retried based on error codes
   * @param error The error object from the API response
   * @returns true if the request should be retried, false otherwise
   */
  shouldRetryResponse(error: unknown): boolean {
    return shouldRetryOnStatus(error, {
      logger: new DebugLogger('llxprt:provider:openai'),
      checkNetworkTransient: isNetworkTransientError,
    });
  }

  /**
   * Request continuation after tool calls when model returned no text.
   * This is a helper used when the model returns tool calls but no text.
   *
   * @plan PLAN-20250120-DEBUGLOGGING.P15
   * @issue #584, #764 (CodeRabbit review)
   */
  private async *requestContinuationAfterToolCalls(
    toolCalls: ContinuationToolCall[],
    request: Pick<
      DispatchResponseOptions,
      | 'continuation'
      | 'client'
      | 'abortSignal'
      | 'model'
      | 'logger'
      | 'mergedHeaders'
      | 'reasoningFieldName'
      | 'onRawTokenDelta'
    >,
  ): AsyncGenerator<IContent, void, unknown> {
    const {
      continuation,
      client,
      abortSignal,
      model,
      logger,
      mergedHeaders,
      reasoningFieldName,
      onRawTokenDelta,
    } = request;
    let body: ContinuationBody | undefined;

    // Make a continuation request (wrap in try-catch since tools were already yielded)
    try {
      const { executeSpooledStreamingChatRequest } = await import(
        './OpenAIApiExecution.js'
      );
      body = await continuation.build(toolCalls);
      const continuationResponse = await executeSpooledStreamingChatRequest(
        client,
        body.spool,
        abortSignal,
        mergedHeaders,
      );

      let accumulatedText = '';

      for await (const sanitizedText of continuationTexts(
        continuationResponse,
        abortSignal,
        logger,
        reasoningFieldName,
        onRawTokenDelta,
      )) {
        accumulatedText += sanitizedText;
        yield aiTextContent(sanitizedText);
      }

      logger.debug(
        () =>
          `[OpenAIProvider] Continuation request completed, received ${accumulatedText.length} chars`,
        {
          model,
          accumulatedTextLength: accumulatedText.length,
        },
      );
    } catch (continuationError) {
      // Tool calls were already successfully yielded, so log warning and continue
      logger.warn(
        () =>
          `[OpenAIProvider] Continuation request failed, but tool calls were already emitted: ${continuationError instanceof Error ? continuationError.message : String(continuationError)}`,
        {
          model,
          error: continuationError,
        },
      );
      // Don't re-throw - tool calls were already successful
    } finally {
      body?.release();
    }
  }
}
