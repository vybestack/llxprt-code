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

/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import type OpenAI from 'openai';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

import { type IProviderConfig } from '../types/IProviderConfig.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import { type ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';

import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ToolFormatter } from '@vybestack/llxprt-code-tools/ToolFormatter.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import { type TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type IModel } from '../IModel.js';
import { getOpenAIFallbackModels } from './openAIFallbackModels.js';
import { type IProvider, type GenerateChatOptions } from '../IProvider.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';

import { ToolCallPipeline } from './ToolCallPipeline.js';

import { isLocalEndpoint } from '../utils/localEndpoint.js';
import { type DumpMode } from '../utils/dumpContext.js';

import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import { kimiFileUploadCache } from './kimiFileUploadCache.js';
import {
  resolveOpenAITransport,
  resolveExplicitTransportModeFromSources,
  extractOpenAIModelParams,
} from './openaiModelPolicy.js';
import {
  executeOpenAIResponsesRequest,
  buildResponsesRequestContextForProjection,
  isResponsesPdfEnabled,
  type ResponsesExecutorDeps,
} from '../openai-responses/openAIResponsesExecutor.js';
import type { prepareRequest } from './OpenAIRequestPreparation.js';
import {
  OpenAIPromptEnvelopeStore,
  prepareOpenAIPromptProjection,
} from './OpenAIPromptEnvelopeStore.js';
import {
  prepareOpenAIChatProjection,
  withProjectionModel,
} from './OpenAIPromptProjectionPreparation.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';

import { buildContinuationMessages } from './OpenAIRequestBuilder.js';
import { extractSanitizedChunkText } from './OpenAIStreamChunkText.js';
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
  requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  client: OpenAI;
  mergedHeaders: Record<string, string> | undefined;
  baseURL: string | undefined;
  logger: DebugLogger;
  reasoningFieldName: string | undefined;
}

export class OpenAIProvider extends BaseProvider implements IProvider {
  private readonly textToolParser = new GemmaToolCallParser();
  private readonly toolCallPipeline = new ToolCallPipeline();
  private readonly preparedPromptEnvelopes = new OpenAIPromptEnvelopeStore();

  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:provider:openai');
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Constructor reduced to minimal initialization - no state captured
   */
  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
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
      },
      config,
    );

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002
    // No constructor-captured state - all values sourced from normalized options per call
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
      getProviderBaseURL: (options) => this.resolveEffectiveBaseURL(options),
      getCustomHeaders: (options) => this.getCustomHeaders(options),
      isCodexBaseURL: () => false,
      getCodexAccountId: async () => {
        throw new Error('Codex account ID not available for OpenAIProvider');
      },
      resolveAuthTokenForPrompt: async () => this.getAuthTokenForPrompt(),
      shouldRetryOnError: (error) => this.shouldRetryResponse(error),
      getDefaultModel: () => this.getDefaultModel(),
      getGlobalConfig: () => undefined,
    };
  }

  private resolveOpenAIResponsesEnabled(
    settingsService = this.resolveSettingsService(),
  ): boolean | undefined {
    const providerValue = settingsService.getProviderSettings(this.name)[
      'openaiResponsesEnabled'
    ];
    if (typeof providerValue === 'boolean') {
      return providerValue;
    }

    const globalValue = settingsService.get('openaiResponsesEnabled');
    if (typeof globalValue === 'boolean') {
      return globalValue;
    }

    return this.providerConfig?.openaiResponsesEnabled;
  }

  private resolveTransport(
    model: string,
    baseURL: string | undefined,
    settingsService = this.resolveSettingsService(),
  ): { useResponses: boolean } {
    const providerSettings = settingsService.getProviderSettings(this.name);
    const explicitMode = resolveExplicitTransportModeFromSources(
      providerSettings,
      () => settingsService.get('responses-mode') as string | undefined,
    );
    return resolveOpenAITransport({
      model,
      baseURL,
      explicitMode,
      openaiResponsesEnabled:
        this.resolveOpenAIResponsesEnabled(settingsService),
    });
  }

  getOpenaiResponsesEnabled(): boolean | undefined {
    return this.resolveOpenAIResponsesEnabled();
  }

  protected async getClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    const authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;

    const requiresAuth = options.settings.getProviderSettings(this.name)[
      'requires-auth'
    ];
    const authExempt = requiresAuth === false || isLocalEndpoint(baseURL);
    if (!authToken && !authExempt) {
      throw new Error(
        `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).")`,
      );
    }

    const agentSettings = resolveAgentSettings(
      options.invocation.ephemerals,
      this.providerConfig,
    );
    const agents = createHttpAgents(agentSettings);

    // Apply invocation/provider header overrides at client construction time.
    // Some OpenAI-compatible gateways (e.g., Kimi For Coding) enforce allowlisting
    // based on User-Agent, which must be sent as a real HTTP header.
    const headers = mergeInvocationHeaders(options);

    return instantiateClient(authToken, baseURL, agents, headers);
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
      const agentSettings = this.providerConfig?.getEphemeralSettings?.() ?? {};
      const agents = createHttpAgents(agentSettings);
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
        settingsService: this.resolveSettingsService(),
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
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    // Issue #3136: the agent layer owns system-prompt assembly. Fail fast
    // before any request preparation so a missing instruction is never
    // silently transported as an empty prompt.
    requireAssembledSystemInstruction(options.systemInstruction);

    const model = options.resolved.model || this.getModel();
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;

    const decision = this.resolveTransport(model, baseURL);
    const prepared = this.preparedPromptEnvelopes.get(
      options.promptEnvelopeTransportToken,
    );
    if (
      options.promptEnvelopeTransportToken !== undefined &&
      prepared === undefined
    ) {
      throw new Error(
        decision.useResponses
          ? 'Unknown OpenAI Responses prompt-envelope transport token'
          : 'Unknown OpenAI Chat prompt-envelope transport token',
      );
    }
    if (decision.useResponses) {
      if (prepared?.protocol === 'openai-chat') {
        throw new Error(
          'Prepared OpenAI Chat envelope cannot be sent through Responses transport',
        );
      }
      yield* executeOpenAIResponsesRequest(
        options,
        this.buildResponsesExecutorDeps(),
        prepared?.requestContext,
      );
      return;
    }
    if (prepared?.protocol === 'openai-responses') {
      throw new Error(
        'Prepared OpenAI Responses envelope cannot be sent through Chat transport',
      );
    }

    const callFormatter = this.createToolFormatter();
    const client = await this.getClient(options);
    const runtimeKey = resolveRuntimeKey(options);
    const { tools } = options;
    const logger = new DebugLogger('llxprt:provider:openai');

    // Debug log what we receive
    if (logger.enabled) {
      logger.debug(
        () => `[OpenAIProvider] generateChatCompletion received tools:`,
        {
          hasTools: !!tools,
          toolsLength: tools?.length,
          toolsType: typeof tools,
          isArray: Array.isArray(tools),
          firstToolName: tools?.[0]?.functionDeclarations?.[0]?.name,
          toolsStructure: tools ? 'available' : 'undefined',
          runtimeKey,
        },
      );
    }

    // Delegate streaming to the pipeline implementation (yield* forwards
    // each chunk identically to an explicit for-await loop).
    yield* this.generateChatCompletionImpl(
      options,
      callFormatter,
      client,
      logger,
      prepared?.requestContext,
    );
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Legacy implementation for chat completion using accumulated tool calls approach
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

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
    requestContext: {
      model: string;
      detectedFormat: string;
      formattedTools: unknown[] | undefined;
      streamingEnabled: boolean;
      requestBody: OpenAI.Chat.ChatCompletionCreateParams;
      messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    },
    baseURL: string | undefined,
    logger: DebugLogger,
  ): void {
    if (!logger.enabled) return;
    const { metadata } = options;
    const resolved = options.resolved;
    logger.debug(() => `[OpenAIProvider] Resolved request context`, {
      provider: this.name,
      model: requestContext.model,
      resolvedModel: resolved.model,
      resolvedBaseUrl: resolved.baseURL,
      authTokenPresent: Boolean(resolved.authToken),
      messageCount: options.contents.length,
      toolCount: options.tools?.length ?? 0,
      metadataKeys: Object.keys(metadata),
    });
    logger.debug(() => `[OpenAIProvider] Sending chat request`, {
      model: requestContext.model,
      baseURL: baseURL ?? this.getBaseURL(),
      streamingEnabled: requestContext.streamingEnabled,
      toolCount: requestContext.formattedTools?.length ?? 0,
      hasAuthToken: Boolean(resolved.authToken),
      messageCount: requestContext.messagesWithSystem.length,
    });
    if ('tools' in requestContext.requestBody) {
      logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
        toolCount: requestContext.requestBody.tools?.length,
        toolNames: requestContext.requestBody.tools?.map((t) =>
          'function' in t ? t.function.name : undefined,
        ),
        firstTool: requestContext.requestBody.tools?.[0],
      });
    }
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
      };
      yield* processStreamingResponse(
        options.response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        options.model,
        options.detectedFormat,
        options.abortSignal,
        options.requestBody,
        options.messagesWithSystem,
        options.client,
        options.mergedHeaders,
        options.baseURL,
        deps,
        this.requestContinuationAfterToolCalls.bind(this),
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
   * Kimi-only media pre-pass. When the resolved provider is a Kimi alias with
   * `mediaSupport.fileUpload` enabled, uploads PDF media blocks via the Files
   * API and returns a cloned options object where PDF blocks are replaced with
   * text references and the file ids are appended to the system instruction.
   *
   * For all other providers, or when there are no uploadable PDFs, the original
   * options object is returned unchanged.
   */
  private async maybeProcessKimiMedia(
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
  ): Promise<NormalizedGenerateChatOptions> {
    const mediaSupport = this.readMediaSupport();
    const providerVideoSetting = options.settings.getProviderSettings(
      this.name,
    )['kimi.experimental-video'];
    const globalVideoSetting = options.settings.get('kimi.experimental-video');
    const allowVideo =
      mediaSupport?.videoSupport === true &&
      (providerVideoSetting === true || globalVideoSetting === true);
    const allowFileUpload = mediaSupport?.fileUpload === true;
    if (!allowFileUpload && !allowVideo) {
      return options;
    }

    try {
      const { processKimiMedia } = await import(
        '../kimi/kimiMediaProcessing.js'
      );
      const result = await processKimiMedia(
        client,
        options.contents,
        kimiFileUploadCache,
        { allowFileUpload, allowVideo },
      );

      if (
        result.fileReferenceText === '' &&
        result.contents === options.contents
      ) {
        return options;
      }

      logger.debug(
        () =>
          `[OpenAIProvider] Kimi file-upload pre-pass replaced PDF blocks; file reference injected into system instruction`,
        { fileReferenceText: result.fileReferenceText },
      );

      if (result.fileReferenceText === '') {
        return { ...options, contents: result.contents };
      }

      const existingInstruction = options.systemInstruction ?? '';
      // Intentional additive writer under the #3136 contract: appends
      // request-specific media references to the agent-assembled system
      // instruction. This is NOT core-prompt assembly.
      const combinedInstruction =
        existingInstruction.trim().length > 0
          ? `${existingInstruction}\n\n${result.fileReferenceText}`
          : result.fileReferenceText;

      return {
        ...options,
        contents: result.contents,
        systemInstruction: combinedInstruction,
      };
    } catch (mediaError) {
      logger.warn(
        () =>
          `[OpenAIProvider] Kimi media pre-pass failed, falling back to inline behavior: ${
            mediaError instanceof Error
              ? mediaError.message
              : String(mediaError)
          }`,
      );
      return options;
    }
  }

  /**
   * Read the mediaSupport block threaded onto providerConfig.providerSpecific
   * by the alias factory. Returns undefined for non-Kimi or when not declared.
   */
  private readMediaSupport():
    | { inlineImages?: boolean; fileUpload?: boolean; videoSupport?: boolean }
    | undefined {
    const specific = this.providerConfig?.providerSpecific as
      | { mediaSupport?: unknown }
      | undefined;
    const raw = specific?.mediaSupport;
    if (
      raw === null ||
      raw === undefined ||
      typeof raw !== 'object' ||
      Array.isArray(raw)
    ) {
      return undefined;
    }
    return raw as {
      inlineImages?: boolean;
      fileUpload?: boolean;
      videoSupport?: boolean;
    };
  }

  private async *generateChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
    preparedRequestContext?: Awaited<ReturnType<typeof prepareRequest>>,
  ): AsyncGenerator<IContent, void, unknown> {
    const { metadata } = options;
    const abortSignal = metadata.abortSignal as AbortSignal | undefined;
    const ephemeralSettings = (
      options.invocation as { ephemerals?: Readonly<Record<string, unknown>> }
    ).ephemerals;

    const { prepareRequest } = await import('./OpenAIRequestPreparation.js');
    const { executeApiRequest } = await import('./OpenAIApiExecution.js');
    const { mergeInvocationHeaders } = await import('./OpenAIClientFactory.js');

    // Kimi media pre-pass: upload PDFs via the Files API and replace them
    // with file-id references so large documents stay out of the token budget.
    // Only activates for Kimi aliases with mediaSupport.fileUpload enabled.
    const effectiveOptions =
      preparedRequestContext === undefined
        ? await this.maybeProcessKimiMedia(options, client, logger)
        : options;

    const requestContext =
      preparedRequestContext ??
      (await prepareRequest(
        effectiveOptions,
        this.getDefaultModel(),
        effectiveOptions.config,
        logger,
        this.name,
      ));

    const {
      model,
      detectedFormat,
      formattedTools,
      streamingEnabled,
      requestBody,
      messagesWithSystem,
    } = requestContext;
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    this.logRequestContext(options, requestContext, baseURL, logger);

    const customHeaders = this.getCustomHeaders();
    const mergedHeaders = mergeInvocationHeaders(options, customHeaders);
    const dumpMode = ephemeralSettings?.dumpcontext as DumpMode | undefined;

    const response = await executeApiRequest({
      client,
      requestBody,
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

    const reasoningFieldName = options.settings.get('reasoning.fieldName') as
      | string
      | undefined;

    yield* this.dispatchResponse({
      response,
      model,
      detectedFormat,
      streamingEnabled,
      abortSignal,
      requestBody,
      messagesWithSystem,
      client,
      mergedHeaders,
      baseURL,
      logger,
      reasoningFieldName,
    });
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
    const useResponses = this.resolveTransport(
      normalized.resolved.model,
      normalized.resolved.baseURL ?? this.baseProviderConfig.baseURL,
      normalized.settings,
    ).useResponses;
    return prepareOpenAIPromptProjection({
      normalized,
      useResponses,
      store: this.preparedPromptEnvelopes,
      responsesPdfEnabled: isResponsesPdfEnabled(normalized),
      prepareResponses: () =>
        buildResponsesRequestContextForProjection(
          normalized,
          this.buildResponsesExecutorDeps(),
        ),
      prepareChat: () =>
        prepareOpenAIChatProjection(normalized, {
          readMediaSupport: () => this.readMediaSupport(),
          getClient: (clientOptions) => this.getClient(clientOptions),
          resolveAuthToken: (authOptions) =>
            this.resolveProjectionAuthToken(authOptions),
          processMedia: (preparedOptions, client, logger) =>
            this.maybeProcessKimiMedia(preparedOptions, client, logger),
          logger: this.getLogger(),
          defaultModel: this.getDefaultModel(),
          providerName: this.name,
        }),
      collectUnsupported: (preparedOptions, supports) =>
        collectUnsupportedMedia(preparedOptions.contents, supports),
    });
  }

  override getToolFormat(): string {
    const modelName = this.getModel() || this.getDefaultModel();
    const settings = this.resolveSettingsService();
    const logger = new DebugLogger('llxprt:provider:openai');
    const format = resolveToolFormat(modelName, this.name, settings, logger);
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
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>,
    messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    requestBody: OpenAI.Chat.ChatCompletionCreateParams,
    client: OpenAI,
    abortSignal: AbortSignal | undefined,
    model: string,
    logger: DebugLogger,
    mergedHeaders: Record<string, string> | undefined,
    toolFormat: ToolFormat,
  ): AsyncGenerator<IContent, void, unknown> {
    const continuationMessages = buildContinuationMessages(
      toolCalls,
      messagesWithSystem,
      toolFormat,
    );

    // Make a continuation request (wrap in try-catch since tools were already yielded)
    try {
      const continuationResponse = await client.chat.completions.create(
        {
          ...requestBody,
          messages: continuationMessages,
          stream: true, // Always stream for consistency
        },
        {
          ...(abortSignal ? { signal: abortSignal } : {}),
          ...(mergedHeaders ? { headers: mergedHeaders } : {}),
        },
      );

      let accumulatedText = '';

      // Process the continuation response
      for await (const chunk of continuationResponse as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (abortSignal?.aborted === true) {
          break;
        }

        const sanitized = extractSanitizedChunkText(chunk);
        if (sanitized !== '') {
          accumulatedText += sanitized;
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: sanitized,
              } as TextBlock,
            ],
          } as IContent;
        }
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
    }
  }
}

function resolveAgentSettings(
  invocationSettings: Record<string, unknown> | undefined,
  providerConfig?: IProviderConfig,
): Record<string, unknown> {
  return invocationSettings ?? providerConfig?.getEphemeralSettings?.() ?? {};
}
