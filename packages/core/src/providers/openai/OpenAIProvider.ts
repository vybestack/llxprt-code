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
import type { IContent } from '../../services/history/IContent.js';

import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';

import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import type { OAuthManager } from '../../auth/precedence.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
import type { TextBlock } from '../../services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { IProvider } from '../IProvider.js';
import { isNetworkTransientError } from '../../utils/retry.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';

import { ToolCallPipeline } from './ToolCallPipeline.js';

import { isLocalEndpoint } from '../utils/localEndpoint.js';
import type { DumpMode } from '../utils/dumpContext.js';

import { detectToolFormat } from '../utils/toolFormatDetection.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';

import { buildContinuationMessages } from './OpenAIRequestBuilder.js';
import { coerceMessageContentToString } from './OpenAIResponseParser.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import {
  createHttpAgents,
  resolveRuntimeKey,
  instantiateClient,
  mergeInvocationHeaders,
} from './OpenAIClientFactory.js';

export class OpenAIProvider extends BaseProvider implements IProvider {
  private readonly textToolParser = new GemmaToolCallParser();
  private readonly toolCallPipeline = new ToolCallPipeline();

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
    oauthManager?: OAuthManager,
  ) {
    // Normalize empty string to undefined for proper precedence handling
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    // Detect if this is a Qwen endpoint
    // CRITICAL FIX: For now, only use base URL check in constructor since `this.name` isn't available yet
    // The name-based check will be handled in the supportsOAuth() method after construction
    const isQwenEndpoint = isQwenBaseURL(baseURL);
    const forceQwenOAuth = Boolean(
      (config as { forceQwenOAuth?: boolean } | undefined)?.forceQwenOAuth,
    );

    // Initialize base provider with auth configuration
    super(
      {
        name: 'openai',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'], // Support environment variable fallback
        isOAuthEnabled: (isQwenEndpoint || forceQwenOAuth) && !!oauthManager,
        oauthProvider: isQwenEndpoint || forceQwenOAuth ? 'qwen' : undefined,
        oauthManager,
      },
      config,
    );

    // Initialize tool call pipeline

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

    // Resolve settings for HTTP agents from invocation or provider config
    const agentSettings =
      options.invocation?.ephemerals ??
      this.providerConfig?.getEphemeralSettings?.() ??
      {};
    const agents = createHttpAgents(agentSettings);

    // Apply invocation/provider header overrides at client construction time.
    // Some OpenAI-compatible gateways (e.g., Kimi For Coding) enforce allowlisting
    // based on User-Agent, which must be sent as a real HTTP header.
    const headers = mergeInvocationHeaders(options);

    return instantiateClient(authToken, baseURL, agents, headers);
  }

  /**
   * Check if OAuth is supported for this provider
   * Qwen endpoints support OAuth, standard OpenAI does not
   */
  protected supportsOAuth(): boolean {
    const providerConfig = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    if (providerConfig?.forceQwenOAuth) {
      return true;
    }
    // CRITICAL FIX: Check provider name first for cases where base URL is changed by profiles
    // This handles the cerebrasqwen3 profile case where base-url is changed to cerebras.ai
    // but the provider name is still 'qwen' due to Object.defineProperty override
    if (this.name === 'qwen') {
      return true;
    }

    // Fallback to base URL check for direct instantiation
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('dashscope.aliyuncs.com') ||
        baseURL.includes('api.qwen.com') ||
        baseURL.includes('qwen'))
    ) {
      return true;
    }

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
    // Return commonly available OpenAI models as fallback
    // Use this.name so it works for providers that extend OpenAIProvider (e.g., Chutes.ai)
    return [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: this.name,
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo-preview',
        name: 'GPT-4.2 Turbo Preview',
        provider: this.name,
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo',
        name: 'GPT-4.2 Turbo',
        provider: this.name,
        supportedToolFormats: ['openai'],
      },
    ];
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    // Check if this is a Qwen provider instance based on baseURL
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('qwen') || baseURL.includes('dashscope'))
    ) {
      return process.env.LLXPRT_DEFAULT_MODEL || 'qwen3-coder-plus';
    }
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
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
  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public clearClientCache(runtimeKey?: string): void {
    void runtimeKey;
  }

  /**
   * Override isAuthenticated for qwen provider to check OAuth directly
   */
  override async isAuthenticated(): Promise<boolean> {
    const config = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };

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

    if (this.name === 'qwen' && config?.forceQwenOAuth) {
      try {
        const token = await this.authResolver.resolveAuthentication({
          settingsService: this.resolveSettingsService(),
          includeOAuth: true,
        });
        return typeof token === 'string' && token.trim() !== '';
      } catch (error) {
        if (process.env.DEBUG) {
          this.getLogger().debug(
            () =>
              `[openai] forced OAuth authentication failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return false;
      }
    }

    // For non-qwen providers, use the normal check
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

  override getServerTools(): string[] {
    // TODO: Implement server tools for OpenAI provider
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    // TODO: Implement server tool invocation for OpenAI provider
    throw new Error(
      `Server tool '${toolName}' not supported by OpenAI provider`,
    );
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
          toolsStructure: tools != null ? 'available' : 'undefined',
          runtimeKey,
        },
      );
    }

    // Pass tools directly in Gemini format - they'll be converted per call
    const generator = this.generateChatCompletionImpl(
      options,
      callFormatter,
      client,
      logger,
    );

    for await (const item of generator) {
      yield item;
    }
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

      const reservedKeys = new Set([
        'enabled',
        'apiKey',
        'api-key',
        'apiKeyfile',
        'api-keyfile',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      if (providerSettings) {
        for (const [key, value] of Object.entries(providerSettings)) {
          if (reservedKeys.has(key) || value === undefined || value === null) {
            continue;
          }
          params[key] = value;
        }
      }

      return Object.keys(params).length > 0 ? params : undefined;
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

  private async *generateChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
  ): AsyncGenerator<IContent, void, unknown> {
    const { metadata } = options;
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    const ephemeralSettings = options.invocation?.ephemerals ?? {};

    // Import the extracted modules
    const { prepareRequest } = await import('./OpenAIRequestPreparation.js');
    const { executeApiRequest } = await import('./OpenAIApiExecution.js');
    const { processStreamingResponse } = await import(
      './OpenAIStreamProcessor.js'
    );
    const { handleNonStreamingResponse } = await import(
      './OpenAINonStreamHandler.js'
    );
    const { mergeInvocationHeaders } = await import('./OpenAIClientFactory.js');

    // Prepare request
    const requestContext = await prepareRequest(
      options,
      this.getDefaultModel(),
      options.config,
      logger,
    );

    const {
      model,
      detectedFormat,
      formattedTools,
      streamingEnabled,
      requestBody,
      messagesWithSystem,
    } = requestContext;
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    // Log request details
    if (logger.enabled) {
      const resolved = options.resolved;
      logger.debug(() => `[OpenAIProvider] Resolved request context`, {
        provider: this.name,
        model,
        resolvedModel: resolved.model,
        resolvedBaseUrl: resolved.baseURL,
        authTokenPresent: Boolean(resolved.authToken),
        messageCount: options.contents.length,
        toolCount: options.tools?.length ?? 0,
        metadataKeys: Object.keys(metadata ?? {}),
      });

      logger.debug(() => `[OpenAIProvider] Sending chat request`, {
        model,
        baseURL: baseURL ?? this.getBaseURL(),
        streamingEnabled,
        toolCount: formattedTools?.length ?? 0,
        hasAuthToken: Boolean(options.resolved.authToken),
        messageCount: messagesWithSystem.length,
      });

      if ('tools' in requestBody) {
        logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
          toolCount: requestBody.tools?.length,
          toolNames: requestBody.tools?.map((t) =>
            'function' in t ? t.function?.name : undefined,
          ),
          firstTool: requestBody.tools?.[0],
        });
      }
    }

    const customHeaders = this.getCustomHeaders();
    const mergedHeaders = mergeInvocationHeaders(options, customHeaders);
    const dumpMode = ephemeralSettings.dumpcontext as DumpMode | undefined;

    // Execute API request
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

    // Process response
    if (streamingEnabled) {
      const deps = {
        toolCallPipeline: this.toolCallPipeline,
        textToolParser: this.textToolParser,
        logger,
        getBaseURL: () => this.getBaseURL(),
      };

      yield* processStreamingResponse(
        response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        model,
        detectedFormat,
        abortSignal,
        requestBody,
        messagesWithSystem,
        client,
        mergedHeaders,
        baseURL,
        deps,
        this.requestContinuationAfterToolCalls.bind(this),
      );
    } else {
      const deps = {
        toolCallPipeline: this.toolCallPipeline,
        textToolParser: this.textToolParser,
        logger,
      };

      yield* handleNonStreamingResponse(
        response as OpenAI.Chat.Completions.ChatCompletion,
        model,
        detectedFormat,
        deps,
      );
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Returns the detected tool format for the current model
   */
  override getToolFormat(): string {
    const modelName = this.getModel() || this.getDefaultModel();
    const format = detectToolFormat(
      modelName,
      new DebugLogger('llxprt:provider:openai'),
    );
    const logger = new DebugLogger('llxprt:provider:openai');
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  /**
   * Parse tool response from API (placeholder for future response parsing)
   * @param response The raw API response
   * @returns Parsed tool response
   */
  parseToolResponse(response: unknown): unknown {
    // TODO: Implement response parsing based on detected format
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
          ...(abortSignal != null ? { signal: abortSignal } : {}),
          ...(mergedHeaders != null ? { headers: mergedHeaders } : {}),
        },
      );

      let accumulatedText = '';

      // Process the continuation response
      for await (const chunk of continuationResponse as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (abortSignal?.aborted) {
          break;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const deltaContent = coerceMessageContentToString(
          choice.delta?.content as unknown,
        );
        if (deltaContent) {
          const sanitized = sanitizeProviderText(deltaContent);
          if (sanitized) {
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
