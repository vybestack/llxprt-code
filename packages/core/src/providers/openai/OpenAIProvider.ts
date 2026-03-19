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

import OpenAI from 'openai';
import { type IContent } from '../../services/history/IContent.js';

import { type IProviderConfig } from '../types/IProviderConfig.js';
import { type ToolFormat } from '../../tools/IToolFormatter.js';

import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { type OAuthManager } from '../../auth/precedence.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
import {
  type ToolCallBlock,
  type TextBlock,
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { type IModel } from '../IModel.js';
import { type IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import { isNetworkTransientError } from '../../utils/retry.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';

import { ToolCallPipeline } from './ToolCallPipeline.js';

import { isLocalEndpoint } from '../utils/localEndpoint.js';

import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { extractThinkTagsAsBlock } from '../utils/thinkingExtraction.js';
import { detectToolFormat } from '../utils/toolFormatDetection.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from '../utils/toolIdNormalization.js';

import {
  buildMessagesWithReasoning,
  buildContinuationMessages,
} from './OpenAIRequestBuilder.js';
import {
  coerceMessageContentToString,
  sanitizeToolArgumentsString,
  extractKimiToolCallsFromText,
  cleanThinkingContent,
  parseStreamingReasoningDelta,
} from './OpenAIResponseParser.js';
import {
  createHttpAgents,
  extractModelParamsFromOptions,
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
    const agentSettings = options.invocation?.ephemerals ?? this.providerConfig?.getEphemeralSettings?.() ?? {};
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
          toolsStructure: tools ? 'available' : 'undefined',
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
    const { contents, tools, metadata } = options;
    const model = options.resolved.model || this.getDefaultModel();
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    const ephemeralSettings = options.invocation?.ephemerals ?? {};

    if (logger.enabled) {
      const resolved = options.resolved;
      logger.debug(() => `[OpenAIProvider] Resolved request context`, {
        provider: this.name,
        model,
        resolvedModel: resolved.model,
        resolvedBaseUrl: resolved.baseURL,
        authTokenPresent: Boolean(resolved.authToken),
        messageCount: contents.length,
        toolCount: tools?.length ?? 0,
        metadataKeys: Object.keys(metadata ?? {}),
      });
    }

    // Detect the tool format to use BEFORE building messages
    // This is needed so that Kimi K2 tool IDs can be generated in the correct format
    const detectedFormat = detectToolFormat(model, logger);

    // Log the detected format for debugging
    logger.debug(
      () =>
        `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
      {
        model,
        detectedFormat,
        provider: this.name,
      },
    );

    // Convert IContent to OpenAI messages format
    // Use buildMessagesWithReasoning for reasoning-aware message building
    // Pass detectedFormat so that Kimi K2 tool IDs are generated correctly
    const messages = buildMessagesWithReasoning(
      contents,
      options,
      detectedFormat,
      options.config,
    );

    // Convert Gemini format tools to OpenAI format using the schema converter
    // This ensures required fields are always present in tool schemas
    let formattedTools: OpenAITool[] | undefined = convertToolsToOpenAI(tools);

    // CRITICAL FIX: Ensure we never pass an empty tools array
    // The OpenAI API errors when tools=[] but a tool call is attempted
    if (Array.isArray(formattedTools) && formattedTools.length === 0) {
      logger.warn(
        () =>
          `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
        {
          model,
          inputTools: tools,
          inputToolsLength: tools?.length,
          inputFirstGroup: tools?.[0],
          stackTrace: new Error().stack,
        },
      );
      formattedTools = undefined;
    }

    // Debug log the conversion result - enhanced logging for intermittent issues
    if (logger.enabled && formattedTools) {
      logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
        detectedFormat,
        inputHadTools: !!tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        inputFunctionDeclarationsLength:
          tools?.[0]?.functionDeclarations?.length,
        outputHasTools: !!formattedTools,
        outputToolsLength: formattedTools?.length,
        outputToolNames: formattedTools?.map((t) => t.function.name),
      });
    }

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting = ephemeralSettings['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Get the system prompt
    const flattenedToolNames =
      tools?.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => !!name),
      ) ?? [];
    const toolNamesArg =
      tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-003
     * Source user memory from normalized options instead of global config
     */
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );
    const mcpInstructions = options.config
      ?.getMcpClientManager?.()
      ?.getMcpInstructions();
    const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
      toolNamesArg ?? [],
      () => options.config?.getSubagentManager?.(),
    );
    const systemPrompt = await getCoreSystemPromptAsync({
      userMemory,
      mcpInstructions,
      model,
      tools: toolNamesArg,
      includeSubagentDelegation,
      interactionMode: options.config?.isInteractive?.()
        ? 'interactive'
        : 'non-interactive',
    });

    // Add system prompt as the first message in the array
    const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const maxTokens =
      (metadata?.maxTokens as number | undefined) ??
      (ephemeralSettings['max-tokens'] as number | undefined);

    // Build request - only include tools if they exist and are not empty
    // IMPORTANT: Create a deep copy of tools to prevent mutation issues
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      stream: streamingEnabled,
    };

    if (formattedTools && formattedTools.length > 0) {
      // Attach tool definitions; they are not mutated by compression logic
      requestBody.tools = formattedTools;
      requestBody.tool_choice = 'auto';
    }

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-002
     * Extract per-call request overrides from normalized options instead of cached state
     */
    const requestOverrides = extractModelParamsFromOptions(options);
    if (requestOverrides) {
      if (logger.enabled) {
        logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
          overrideKeys: Object.keys(requestOverrides),
        });
      }
      Object.assign(requestBody, requestOverrides);
    }

    // Inject thinking parameter for OpenAI-compatible reasoning models (pipeline path)
    if (!('thinking' in requestBody) && !('reasoning_effort' in requestBody)) {
      const reasoningEnabled = options.invocation?.modelBehavior?.[
        'reasoning.enabled'
      ] as boolean | undefined;
      if (reasoningEnabled === true) {
        (requestBody as unknown as Record<string, unknown>)['thinking'] = {
          type: 'enabled',
        };
      } else if (reasoningEnabled === false) {
        (requestBody as unknown as Record<string, unknown>)['thinking'] = {
          type: 'disabled',
        };
      }
    }

    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
      requestBody.max_tokens = maxTokens;
    }

    // Debug log request summary for Cerebras/Qwen
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    if (
      logger.enabled &&
      (model.toLowerCase().includes('qwen') || baseURL?.includes('cerebras'))
    ) {
      logger.debug(() => `Request to ${baseURL} for model ${model}:`, {
        baseURL,
        model,
        streamingEnabled,
        hasTools: 'tools' in requestBody,
        toolCount: formattedTools?.length || 0,
        messageCount: messages.length,
        toolsInRequest:
          'tools' in requestBody ? requestBody.tools?.length : 'not included',
      });
    }

    // Get retry settings from ephemeral settings
    const maxRetries =
      (ephemeralSettings['retries'] as number | undefined) ?? 6; // Default for OpenAI
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000; // Default for OpenAI

    // Get stream options from ephemeral settings (default: include usage for token tracking)
    const streamOptions = (ephemeralSettings['stream-options'] as
      | { include_usage?: boolean }
      | undefined) || { include_usage: true };

    // Add stream options to request if streaming is enabled
    if (streamingEnabled && streamOptions) {
      Object.assign(requestBody, { stream_options: streamOptions });
    }

    // Log the exact tools being sent for debugging
    if (logger.enabled && 'tools' in requestBody) {
      logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
        toolCount: requestBody.tools?.length,
        toolNames: requestBody.tools?.map((t) =>
          'function' in t ? t.function?.name : undefined,
        ),
        firstTool: requestBody.tools?.[0],
      });
    }

    // Wrap the API call with retry logic using centralized retry utility
    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Sending chat request`, {
        model,
        baseURL: baseURL ?? this.getBaseURL(),
        streamingEnabled,
        toolCount: formattedTools?.length ?? 0,
        hasAuthToken: Boolean(options.resolved.authToken),
        requestHasSystemPrompt: Boolean(systemPrompt?.length),
        messageCount: messagesWithSystem.length,
      });
    }
    let response;

    // Debug log throttle tracker status
    logger.debug(() => `Retry configuration:`, {
      hasThrottleTracker: !!this.throttleTracker,
      throttleTrackerType: typeof this.throttleTracker,
      maxRetries,
      initialDelayMs,
    });

    const customHeaders = this.getCustomHeaders();

    // Merge invocation ephemerals (CLI /set, alias ephemerals) into custom headers.
    // The continuation helper must use this merged header set too; otherwise the
    // follow-up request can be routed/validated differently and fail on strict
    // OpenAI-compatible gateways.
    const mergedHeaders = mergeInvocationHeaders(options, customHeaders);

    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Request body preview`, {
        model: requestBody.model,
        hasStop: 'stop' in requestBody,
        hasMaxTokens: 'max_tokens' in requestBody,
        hasResponseFormat: 'response_format' in requestBody,
        overrideKeys: requestOverrides ? Object.keys(requestOverrides) : [],
        mergedHeaderKeys: mergedHeaders ? Object.keys(mergedHeaders) : [],
      });
    }

    // Get dump mode from ephemeral settings
    const dumpMode = ephemeralSettings.dumpcontext as DumpMode | undefined;
    const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
    const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

    // REQ-RETRY-001: Retry logic is now handled by RetryOrchestrator at a higher level
    if (streamingEnabled) {
      while (true) {
        try {
          response = await client.chat.completions.create(requestBody, {
            ...(abortSignal ? { signal: abortSignal } : {}),
            ...(mergedHeaders ? { headers: mergedHeaders } : {}),
          });

          // Dump successful streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { streaming: true },
              false,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          break;
        } catch (error) {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }

          // Dump error if enabled
          if (shouldDumpError) {
            const dumpErrorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { error: dumpErrorMessage },
              true,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          // Re-throw other errors as-is
          const capturedErrorMessage =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;

          logger.error(
            () =>
              `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? this.getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
            {
              model,
              baseURL: baseURL ?? this.getBaseURL(),
              streamingEnabled,
              hasTools: formattedTools?.length ?? 0,
              requestHasSystemPrompt: !!systemPrompt,
              status,
            },
          );
          throw error;
        }
      }
    } else {
      while (true) {
        try {
          // REQ-RETRY-001: Retry logic is now handled by RetryOrchestrator at a higher level
          response = (await client.chat.completions.create(requestBody, {
            ...(abortSignal ? { signal: abortSignal } : {}),
            ...(mergedHeaders ? { headers: mergedHeaders } : {}),
          })) as OpenAI.Chat.Completions.ChatCompletion;

          // Dump successful non-streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              response,
              false,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          break;
        } catch (error) {
          const errorMessage = String(error);
          logger.debug(() => `[OpenAIProvider] Chat request error`, {
            errorType: error?.constructor?.name,
            status:
              typeof error === 'object' && error && 'status' in error
                ? (error as { status?: number }).status
                : undefined,
            errorKeys:
              error && typeof error === 'object' ? Object.keys(error) : [],
          });

          const isCerebrasToolError =
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'));

          if (isCerebrasToolError) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }

          // Dump error if enabled
          if (shouldDumpError) {
            const dumpErrorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { error: dumpErrorMessage },
              true,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          const capturedErrorMessage =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;

          logger.error(
            () =>
              `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? this.getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
            {
              model,
              baseURL: baseURL ?? this.getBaseURL(),
              streamingEnabled,
              hasTools: formattedTools?.length ?? 0,
              requestHasSystemPrompt: !!systemPrompt,
              status,
            },
          );
          throw error;
        }
      }
    }

    // Check if response is streaming or not
    if (streamingEnabled) {
      // Process streaming response
      let _accumulatedText = '';

      // Initialize tool call pipeline for this streaming session
      this.toolCallPipeline.reset();

      // Buffer for accumulating text chunks for providers that need it
      let textBuffer = '';
      // Use the same detected format from earlier for consistency
      const isKimiK2Model = model.toLowerCase().includes('kimi-k2');
      // Buffer text for Qwen format providers and Kimi-K2 to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen' || isKimiK2Model;

      // Accumulate thinking content across the entire stream to emit as ONE block
      // This handles fragmented <think>word</think> streaming from Synthetic API
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedThinkingContent = '';
      let hasEmittedThinking = false;

      // Accumulate reasoning_content from streaming deltas (pipeline path)
      // Synthetic API sends reasoning token-by-token, so we accumulate to emit ONE block
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedReasoningContent = '';

      // Track token usage from streaming chunks
      let streamingUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      // Track finish_reason for detecting empty responses (issue #584)
      let lastFinishReason: string | null | undefined = null;

      // Store pipeline result to avoid duplicate process() calls (CodeRabbit review #764)
      let cachedPipelineResult: Awaited<
        ReturnType<typeof this.toolCallPipeline.process>
      > | null = null;

      const allChunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = []; // Collect all chunks first

      try {
        // Handle streaming response - collect all chunks
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          if (abortSignal?.aborted) {
            break;
          }
          allChunks.push(chunk);
        }

        // Debug: Log how many chunks were received
        logger.debug(
          () =>
            `[Streaming pipeline] Collected ${allChunks.length} chunks from stream`,
          {
            firstChunkDelta: allChunks[0]?.choices?.[0]?.delta,
            lastChunkFinishReason:
              allChunks[allChunks.length - 1]?.choices?.[0]?.finish_reason,
          },
        );

        // Now process all collected chunks
        for (const chunk of allChunks) {
          // Check for cancellation during chunk processing
          if (abortSignal?.aborted) {
            break;
          }
          const chunkRecord = chunk as unknown as Record<string, unknown>;
          let parsedData: Record<string, unknown> | undefined;
          const rawData = chunkRecord?.data;
          if (typeof rawData === 'string') {
            try {
              parsedData = JSON.parse(rawData) as Record<string, unknown>;
            } catch {
              parsedData = undefined;
            }
          } else if (rawData && typeof rawData === 'object') {
            parsedData = rawData as Record<string, unknown>;
          }

          const streamingError =
            chunkRecord?.error ??
            parsedData?.error ??
            (parsedData?.data as { error?: unknown } | undefined)?.error;
          const streamingEvent = (chunkRecord?.event ?? parsedData?.event) as
            | string
            | undefined;
          const streamingErrorMessage =
            (streamingError as { message?: string } | undefined)?.message ??
            (streamingError as { error?: string } | undefined)?.error ??
            (parsedData as { message?: string } | undefined)?.message;
          if (
            streamingEvent === 'error' ||
            (streamingError && typeof streamingError === 'object')
          ) {
            const errorMessage =
              streamingErrorMessage ??
              (typeof streamingError === 'string'
                ? streamingError
                : 'Streaming response reported an error.');
            throw new Error(errorMessage);
          }

          // Extract usage information if present (typically in final chunk)
          if (chunk.usage) {
            streamingUsage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Parse reasoning_content from streaming delta (Pipeline path)
          // ACCUMULATE instead of yielding immediately to handle token-by-token streaming
          // Extract embedded Kimi K2 tool calls from reasoning_content (fixes #749)
          // @plan PLAN-20251202-THINKING.P16
          // @requirement REQ-THINK-003.1, REQ-KIMI-REASONING-001.1
          const { thinking: reasoningBlock, toolCalls: reasoningToolCalls } =
            parseStreamingReasoningDelta(choice.delta, logger);
          if (reasoningBlock) {
            // Accumulate reasoning content - will emit ONE block later
            accumulatedReasoningContent += reasoningBlock.thought;
          }
          // Add tool calls extracted from reasoning_content to pipeline
          if (reasoningToolCalls.length > 0) {
            // Get current pipeline stats to determine next index
            const stats = this.toolCallPipeline.getStats();
            let baseIndex = stats.collector.totalCalls;

            for (const toolCall of reasoningToolCalls) {
              // Add complete tool call as fragments to pipeline
              // For Kimi tool calls extracted from reasoning_content, generate a synthetic ID
              // since they don't have a real tool_call_id from the API
              this.toolCallPipeline.addFragment(baseIndex, {
                id: `call_kimi_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: toolCall.name,
                args: JSON.stringify(toolCall.parameters),
              });
              baseIndex++;
            }
          }

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            lastFinishReason = choice.finish_reason;
            logger.debug(
              () =>
                `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
              {
                model,
                finishReason: choice.finish_reason,
                hasAccumulatedText: _accumulatedText.length > 0,
                hasAccumulatedTools:
                  this.toolCallPipeline.getStats().collector.totalCalls > 0,
                hasBufferedText: textBuffer.length > 0,
              },
            );

            // If finish_reason is 'length', the response was cut off
            if (choice.finish_reason === 'length') {
              logger.debug(
                () =>
                  `Response truncated due to length limit for model ${model}`,
              );
            }

            // Don't flush buffer here on finish - let the final buffer handling
            // after the loop process it with proper sanitization and think tag extraction
            // This was causing unsanitized <think> tags to leak into output (pipeline path)
            // @plan PLAN-20251202-THINKING.P16
          }

          // Handle text content - buffer for Qwen format, emit immediately for others
          // Note: Synthetic API sends content that may duplicate reasoning_content.
          // This is the model's behavior - we don't filter it here as detection is unreliable.
          // @plan PLAN-20251202-THINKING.P16
          const rawDeltaContent = coerceMessageContentToString(
            choice.delta?.content as unknown,
          );
          if (rawDeltaContent) {
            // For Kimi models, we need to buffer the RAW content without processing
            // because Kimi tokens stream incrementally and partial tokens would leak
            // through if we try to process them immediately. The buffer will be
            // processed when flushed (at sentence boundaries or end of stream).
            let deltaContent: string;
            if (isKimiK2Model) {
              // For Kimi: Don't process yet - just pass through and let buffering handle it
              // We'll extract tool calls and sanitize when we flush the buffer
              deltaContent = rawDeltaContent;
            } else {
              // For non-Kimi models: sanitize immediately as before
              deltaContent = sanitizeProviderText(rawDeltaContent);
            }
            if (!deltaContent) {
              continue;
            }

            _accumulatedText += deltaContent;

            // Debug log for providers that need buffering
            if (shouldBufferText) {
              logger.debug(
                () => `[Streaming] Chunk content for ${detectedFormat} format:`,
                {
                  deltaContent,
                  length: deltaContent.length,
                  hasNewline: deltaContent.includes('\n'),
                  escaped: JSON.stringify(deltaContent),
                  bufferSize: textBuffer.length,
                },
              );

              // Buffer text to avoid stanza formatting
              textBuffer += deltaContent;

              const kimiBeginCount = (
                textBuffer.match(/<\|tool_calls_section_begin\|>/g) || []
              ).length;
              const kimiEndCount = (
                textBuffer.match(/<\|tool_calls_section_end\|>/g) || []
              ).length;
              const hasOpenKimiSection = kimiBeginCount > kimiEndCount;

              // Emit buffered text when we have a complete sentence or paragraph
              // Look for natural break points, avoiding flush mid Kimi section
              if (
                !hasOpenKimiSection &&
                (textBuffer.includes('\n') ||
                  textBuffer.endsWith('. ') ||
                  textBuffer.endsWith('! ') ||
                  textBuffer.endsWith('? ') ||
                  textBuffer.length > 100)
              ) {
                const parsedToolCalls: ToolCallBlock[] = [];
                let workingText = textBuffer;

                // Extract <think> tags and ACCUMULATE instead of emitting immediately
                // This handles fragmented <think>word</think> streaming from Synthetic API
                // @plan PLAN-20251202-THINKING.P16
                // @requirement REQ-THINK-003
                const tagBasedThinking = extractThinkTagsAsBlock(workingText);
                if (tagBasedThinking) {
                  // Clean Kimi tokens from thinking content before accumulating
                  const cleanedThought = cleanThinkingContent(
                    tagBasedThinking.thought,
                    logger,
                  );
                  // Accumulate thinking content - don't emit yet
                  // Use newline to preserve formatting between chunks (not space)
                  if (accumulatedThinkingContent.length > 0) {
                    accumulatedThinkingContent += '\n';
                  }
                  accumulatedThinkingContent += cleanedThought;
                  logger.debug(
                    () =>
                      `[Streaming] Accumulated thinking: ${accumulatedThinkingContent.length} chars total`,
                  );
                }

                const kimiParsed =
                  extractKimiToolCallsFromText(workingText, logger);
                if (kimiParsed.toolCalls.length > 0) {
                  parsedToolCalls.push(...kimiParsed.toolCalls);
                  logger.debug(
                    () =>
                      `[OpenAIProvider] Streaming buffer (pipeline) parsed Kimi tool calls`,
                    {
                      count: kimiParsed.toolCalls.length,
                      bufferLength: workingText.length,
                      cleanedLength: kimiParsed.cleanedText.length,
                    },
                  );
                }
                workingText = kimiParsed.cleanedText;

                const parsingText = sanitizeProviderText(workingText);
                let cleanedText = parsingText;
                try {
                  const parsedResult = this.textToolParser.parse(parsingText);
                  if (parsedResult.toolCalls.length > 0) {
                    parsedToolCalls.push(
                      ...parsedResult.toolCalls.map((call) => ({
                        type: 'tool_call' as const,
                        id: `text_tool_${Date.now()}_${Math.random()
                          .toString(36)
                          .substring(7)}`,
                        name: normalizeToolName(call.name),
                        parameters: call.arguments,
                      })),
                    );
                    cleanedText = parsedResult.cleanedContent;
                  }
                } catch (error) {
                  const logger = this.getLogger();
                  logger.debug(
                    () =>
                      `TextToolCallParser failed on buffered text: ${error}`,
                  );
                }

                // Emit accumulated thinking BEFORE tool calls or text content
                // This ensures thinking appears first in the response
                // @plan PLAN-20251202-THINKING.P16
                if (
                  !hasEmittedThinking &&
                  accumulatedThinkingContent.length > 0 &&
                  (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
                ) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: accumulatedThinkingContent,
                        sourceField: 'think_tags',
                        isHidden: false,
                      } as ThinkingBlock,
                    ],
                  } as IContent;
                  hasEmittedThinking = true;
                  logger.debug(
                    () =>
                      `[Streaming pipeline] Emitted accumulated thinking: ${accumulatedThinkingContent.length} chars`,
                  );
                }

                if (parsedToolCalls.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: parsedToolCalls,
                  } as IContent;
                }

                // Always use sanitized text to strip <think> tags (pipeline streaming)
                // Bug fix: Previously Kimi used unsanitized workingText
                // @plan PLAN-20251202-THINKING.P16
                // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
                // Previously we used cleanedText.trim().length > 0 which dropped spaces,
                // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
                if (cleanedText.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'text',
                        text: cleanedText,
                      } as TextBlock,
                    ],
                  } as IContent;
                }

                textBuffer = '';
              }
            } else {
              // For other providers, emit text immediately as before
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: deltaContent,
                  } as TextBlock,
                ],
              } as IContent;
            }
          }

          // Handle tool calls using the new pipeline
          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls && deltaToolCalls.length > 0) {
            for (const deltaToolCall of deltaToolCalls) {
              if (deltaToolCall.index === undefined) continue;

              // Add fragment to pipeline instead of accumulating strings
              // IMPORTANT: Capture the tool_call_id to preserve OpenAI API contract
              // This ensures tool responses can be properly matched in the next turn
              this.toolCallPipeline.addFragment(deltaToolCall.index, {
                id: deltaToolCall.id,
                name: deltaToolCall.function?.name,
                args: deltaToolCall.function?.arguments,
              });
            }
          }

          const choiceMessage = (
            choice as {
              message?: {
                tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
              };
            }
          ).message;
          const messageToolCalls = choiceMessage?.tool_calls;
          if (messageToolCalls && messageToolCalls.length > 0) {
            messageToolCalls.forEach(
              (
                toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
                index: number,
              ) => {
                if (!toolCall || toolCall.type !== 'function') {
                  return;
                }

                // Add final complete tool call to pipeline
                this.toolCallPipeline.addFragment(index, {
                  id: toolCall.id,
                  name: toolCall.function?.name,
                  args: toolCall.function?.arguments,
                });
              },
            );
          }
        }
      } catch (error) {
        if (
          abortSignal?.aborted ||
          (error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'AbortError')
        ) {
          // Signal was aborted - treat as intentional cancellation
          logger.debug(
            () =>
              `Pipeline streaming response cancelled by AbortSignal (error: ${error instanceof Error ? error.name : 'unknown'})`,
          );
          throw error;
        } else {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list during streaming. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }
          logger.error('Error processing streaming response:', error);
          throw error;
        }
      }

      // Check buffered text for <tool_call> format before flushing as plain text
      if (textBuffer.length > 0) {
        const parsedToolCalls: ToolCallBlock[] = [];
        let workingText = textBuffer;

        // Note: Synthetic API sends reasoning via both reasoning_content AND content fields.
        // This is the model's behavior - we don't strip it since the model is the source.
        // The user can configure reasoning display settings if they don't want duplicates.
        // @plan PLAN-20251202-THINKING.P16

        // Extract any remaining <think> tags from final buffer
        // @plan PLAN-20251202-THINKING.P16
        const tagBasedThinking = extractThinkTagsAsBlock(workingText);
        if (tagBasedThinking) {
          // Clean Kimi tokens from thinking content before accumulating
          const cleanedThought = cleanThinkingContent(
            tagBasedThinking.thought,
            logger,
          );
          // Use newline to preserve formatting between chunks (not space)
          if (accumulatedThinkingContent.length > 0) {
            accumulatedThinkingContent += '\n';
          }
          accumulatedThinkingContent += cleanedThought;
        }

        const kimiParsed = extractKimiToolCallsFromText(workingText, logger);
        if (kimiParsed.toolCalls.length > 0) {
          parsedToolCalls.push(...kimiParsed.toolCalls);
          this.getLogger().debug(
            () =>
              `[OpenAIProvider] Final buffer flush (pipeline) parsed Kimi tool calls`,
            {
              count: kimiParsed.toolCalls.length,
              bufferLength: workingText.length,
              cleanedLength: kimiParsed.cleanedText.length,
            },
          );
        }
        workingText = kimiParsed.cleanedText;

        const parsingText = sanitizeProviderText(workingText);
        let cleanedText = parsingText;
        try {
          const parsedResult = this.textToolParser.parse(parsingText);
          if (parsedResult.toolCalls.length > 0) {
            parsedToolCalls.push(
              ...parsedResult.toolCalls.map((call) => ({
                type: 'tool_call' as const,
                id: `text_tool_${Date.now()}_${Math.random()
                  .toString(36)
                  .substring(7)}`,
                name: normalizeToolName(call.name),
                parameters: call.arguments,
              })),
            );
            cleanedText = parsedResult.cleanedContent;
          }
        } catch (error) {
          const logger = this.getLogger();
          logger.debug(
            () => `TextToolCallParser failed on buffered text: ${error}`,
          );
        }

        // Emit accumulated thinking BEFORE tool calls or text content
        // @plan PLAN-20251202-THINKING.P16
        if (
          !hasEmittedThinking &&
          accumulatedThinkingContent.length > 0 &&
          (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
        ) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: accumulatedThinkingContent,
                sourceField: 'think_tags',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
          hasEmittedThinking = true;
        }

        if (parsedToolCalls.length > 0) {
          yield {
            speaker: 'ai',
            blocks: parsedToolCalls,
          } as IContent;
        }

        // Always use sanitized text to strip <think> tags (pipeline final buffer)
        // Bug fix: Previously Kimi used unsanitized workingText
        // @plan PLAN-20251202-THINKING.P16
        // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
        // Previously we used cleanedText.trim().length > 0 which dropped spaces,
        // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
        if (cleanedText.length > 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: cleanedText,
              } as TextBlock,
            ],
          } as IContent;
        }

        textBuffer = '';
      }

      // Emit any remaining accumulated thinking that wasn't emitted yet
      // (e.g., if entire response was just thinking with no content)
      // @plan PLAN-20251202-THINKING.P16
      if (!hasEmittedThinking && accumulatedThinkingContent.length > 0) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: accumulatedThinkingContent,
              sourceField: 'think_tags',
              isHidden: false,
            } as ThinkingBlock,
          ],
        } as IContent;
        hasEmittedThinking = true;
      }

      // Emit accumulated reasoning_content and pipeline tool calls as a single combined IContent.
      // DeepSeek-reasoner and similar models require reasoning_content in the SAME assistant
      // message as tool_calls; separate IContents prevent buildMessagesWithReasoning from
      // attaching reasoning_content, causing "Missing reasoning_content field" on the next turn.
      // @plan PLAN-20251202-THINKING.P16
      // @issue #1142

      // Process tool calls through the pipeline first
      cachedPipelineResult = await this.toolCallPipeline.process(abortSignal);

      {
        // Extract Kimi tool calls from the complete accumulated reasoning content (handles split tokens)
        const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
          accumulatedReasoningContent.length > 0
            ? extractKimiToolCallsFromText(accumulatedReasoningContent, logger)
            : { cleanedText: '', toolCalls: [] as ToolCallBlock[] };

        // Build pipeline tool call blocks
        const pipelineToolCallBlocks: ToolCallBlock[] = [];
        if (
          cachedPipelineResult.normalized.length > 0 ||
          cachedPipelineResult.failed.length > 0
        ) {
          // Process successful tool calls
          for (const normalizedCall of cachedPipelineResult.normalized) {
            const sanitizedArgs = sanitizeToolArgumentsString(
              normalizedCall.originalArgs ?? normalizedCall.args,
              logger,
            );

            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              sanitizedArgs,
              normalizedCall.name,
            );

            pipelineToolCallBlocks.push({
              type: 'tool_call',
              id: normalizeToHistoryToolId(
                normalizedCall.id || `call_${normalizedCall.index}`,
              ),
              name: normalizedCall.name,
              parameters: processedParameters,
            });
          }

          // Handle failed tool calls
          for (const failed of cachedPipelineResult.failed) {
            this.getLogger().warn(
              `Tool call validation failed for index ${failed.index}: ${failed.validationErrors.join(', ')}`,
            );
          }
        }

        // Combine all blocks into a single IContent so ThinkingBlock and ToolCallBlocks
        // are stored together in history and correctly round-tripped to the API.
        const combinedBlocks: Array<ThinkingBlock | ToolCallBlock> = [];

        if (cleanedReasoning.length > 0) {
          combinedBlocks.push({
            type: 'thinking',
            thought: cleanedReasoning,
            sourceField: 'reasoning_content',
            isHidden: false,
          } as ThinkingBlock);
        }

        // Kimi tool calls embedded in reasoning_content come first, then pipeline tool calls
        combinedBlocks.push(...reasoningToolCalls, ...pipelineToolCallBlocks);

        if (combinedBlocks.length > 0) {
          const combinedContent: IContent = {
            speaker: 'ai',
            blocks: combinedBlocks,
          };

          // Add usage metadata if we captured it from streaming
          if (streamingUsage) {
            const cacheMetrics = extractCacheMetrics(streamingUsage);
            combinedContent.metadata = {
              usage: {
                promptTokens: streamingUsage.prompt_tokens || 0,
                completionTokens: streamingUsage.completion_tokens || 0,
                totalTokens:
                  streamingUsage.total_tokens ||
                  (streamingUsage.prompt_tokens || 0) +
                    (streamingUsage.completion_tokens || 0),
                cachedTokens: cacheMetrics.cachedTokens,
                cacheCreationTokens: cacheMetrics.cacheCreationTokens,
                cacheMissTokens: cacheMetrics.cacheMissTokens,
              },
            };
          }

          yield combinedContent;
        }
      }

      // If we have usage information but no tool calls or reasoning, emit a metadata-only response
      if (
        streamingUsage &&
        accumulatedReasoningContent.length === 0 &&
        this.toolCallPipeline.getStats().collector.totalCalls === 0
      ) {
        const cacheMetrics = extractCacheMetrics(streamingUsage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: streamingUsage.prompt_tokens || 0,
              completionTokens: streamingUsage.completion_tokens || 0,
              totalTokens:
                streamingUsage.total_tokens ||
                (streamingUsage.prompt_tokens || 0) +
                  (streamingUsage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }

      // Detect and handle empty streaming responses after tool calls (issue #584)
      // Some models (like gpt-oss-120b on OpenRouter) return finish_reason=stop with tools but no text
      // Use cachedPipelineResult instead of pipelineStats.collector.totalCalls since process() resets the collector (CodeRabbit review #764)
      const toolCallCount =
        (cachedPipelineResult?.normalized.length ?? 0) +
        (cachedPipelineResult?.failed.length ?? 0);
      const hasToolsButNoText =
        lastFinishReason === 'stop' &&
        toolCallCount > 0 &&
        _accumulatedText.length === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0;

      if (hasToolsButNoText) {
        logger.log(
          () =>
            `[OpenAIProvider] Model returned tool calls but no text (finish_reason=stop). Requesting continuation for model '${model}'.`,
          {
            model,
            toolCallCount,
            baseURL: baseURL ?? this.getBaseURL(),
          },
        );

        // Note: In pipeline mode, tool calls have already been processed.
        // We need to get the normalized tool calls from the cached pipeline result to build continuation messages.
        // Use cached result to avoid duplicate process() call that would return empty results (CodeRabbit review #764)
        if (!cachedPipelineResult) {
          throw new Error(
            'Pipeline result not cached - this should not happen in pipeline mode',
          );
        }
        const toolCallsForHistory = cachedPipelineResult.normalized.map(
          (normalizedCall, index) => ({
            id:
              normalizedCall.id && normalizedCall.id.trim().length > 0
                ? normalizeToOpenAIToolId(normalizedCall.id)
                : `call_${index}`,
            type: 'function' as const,
            function: {
              name: normalizedCall.name,
              arguments: JSON.stringify(normalizedCall.args),
            },
          }),
        );

        // Request continuation after tool calls (delegated to shared method)
        yield* this.requestContinuationAfterToolCalls(
          toolCallsForHistory,
          messagesWithSystem,
          requestBody,
          client,
          abortSignal,
          model,
          logger,
          mergedHeaders,
          detectedFormat,
        );
      }

      // Detect and warn about empty streaming responses (common with Kimi K2 after tool calls)
      // Only warn if we truly got nothing - not even reasoning content
      if (
        _accumulatedText.length === 0 &&
        toolCallCount === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0
      ) {
        // Provide actionable guidance for users
        const isKimi = model.toLowerCase().includes('kimi');
        const isSynthetic =
          (baseURL ?? this.getBaseURL())?.includes('synthetic') ?? false;
        const troubleshooting = isKimi
          ? isSynthetic
            ? ' To fix: use streaming: "disabled" in your profile settings. Synthetic API streaming does not work reliably with tool calls.'
            : ' This provider may not support streaming with tool calls.'
          : ' Consider using streaming: "disabled" in your profile settings.';

        logger.warn(
          () =>
            `[OpenAIProvider] Empty streaming response for model '${model}' (received ${allChunks.length} chunks with no content).${troubleshooting}`,
          {
            model,
            baseURL: baseURL ?? this.getBaseURL(),
            isKimiModel: isKimi,
            isSyntheticAPI: isSynthetic,
            totalChunksReceived: allChunks.length,
          },
        );
      } else {
        // Log what we DID get for debugging
        logger.debug(
          () =>
            `[Streaming pipeline] Stream completed with accumulated content`,
          {
            textLength: _accumulatedText.length,
            toolCallCount,
            textBufferLength: textBuffer.length,
            reasoningLength: accumulatedReasoningContent.length,
            thinkingLength: accumulatedThinkingContent.length,
            totalChunksReceived: allChunks.length,
          },
        );
      }
    } else {
      // Handle non-streaming response
      const completion = response as OpenAI.Chat.Completions.ChatCompletion;
      const choice = completion.choices?.[0];

      if (!choice) {
        throw new Error('No choices in completion response');
      }

      // Log finish reason for debugging Qwen issues
      if (choice.finish_reason) {
        logger.debug(
          () =>
            `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
          {
            model,
            finishReason: choice.finish_reason,
            hasContent: !!choice.message?.content,
            hasToolCalls: !!(
              choice.message?.tool_calls && choice.message.tool_calls.length > 0
            ),
            contentLength: choice.message?.content?.length || 0,
            toolCallCount: choice.message?.tool_calls?.length || 0,
            detectedFormat,
          },
        );

        // Warn if the response was truncated
        if (choice.finish_reason === 'length') {
          logger.warn(
            () =>
              `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
          );
        }
      }

      const blocks: Array<TextBlock | ToolCallBlock> = [];

      // Handle text content (strip thinking / reasoning blocks) and Kimi tool sections
      const pipelineRawMessageContent = coerceMessageContentToString(
        choice.message?.content as unknown,
      );
      let pipelineKimiCleanContent: string | undefined;
      let pipelineKimiToolBlocks: ToolCallBlock[] = [];
      if (pipelineRawMessageContent) {
        const kimiParsed = extractKimiToolCallsFromText(
          pipelineRawMessageContent,
          logger,
        );
        pipelineKimiCleanContent = kimiParsed.cleanedText;
        pipelineKimiToolBlocks = kimiParsed.toolCalls;

        // Always use sanitized text - even Kimi-K2 should have consistent tag stripping
        const cleanedText = sanitizeProviderText(pipelineKimiCleanContent);
        if (cleanedText) {
          blocks.push({
            type: 'text',
            text: cleanedText,
          } as TextBlock);
        }
      }

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        // Use the same detected format from earlier for consistency

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            // Normalize tool name for consistency with streaming path
            const normalizedName = this.toolCallPipeline.normalizeToolName(
              toolCall.function.name,
              toolCall.function.arguments,
            );

            const sanitizedArgs = sanitizeToolArgumentsString(
              toolCall.function.arguments,
              logger,
            );

            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              sanitizedArgs,
              normalizedName,
            );

            blocks.push({
              type: 'tool_call',
              id: normalizeToHistoryToolId(toolCall.id),
              name: normalizedName,
              parameters: processedParameters,
            } as ToolCallBlock);
          }
        }
      }

      if (pipelineKimiToolBlocks.length > 0) {
        blocks.push(...pipelineKimiToolBlocks);
        this.getLogger().debug(
          () =>
            `[OpenAIProvider] Non-stream pipeline added Kimi tool calls from text`,
          { count: pipelineKimiToolBlocks.length },
        );
      }

      // Additionally check for <tool_call> format in text content
      if (pipelineKimiCleanContent) {
        const cleanedSource = sanitizeProviderText(pipelineKimiCleanContent);
        if (cleanedSource) {
          try {
            const parsedResult = this.textToolParser.parse(cleanedSource);
            if (parsedResult.toolCalls.length > 0) {
              // Add tool calls found in text content
              for (const call of parsedResult.toolCalls) {
                blocks.push({
                  type: 'tool_call',
                  id: `text_tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  name: normalizeToolName(call.name),
                  parameters: call.arguments,
                } as ToolCallBlock);
              }

              // Update the text content to remove the tool call parts
              if (choice.message.content !== parsedResult.cleanedContent) {
                // Find the text block and update it
                const textBlockIndex = blocks.findIndex(
                  (block) => block.type === 'text',
                );
                if (textBlockIndex >= 0) {
                  (blocks[textBlockIndex] as TextBlock).text =
                    parsedResult.cleanedContent;
                } else if (parsedResult.cleanedContent.trim()) {
                  // Add cleaned text if it doesn't exist
                  blocks.unshift({
                    type: 'text',
                    text: parsedResult.cleanedContent,
                  } as TextBlock);
                }
              }
            }
          } catch (error) {
            const logger = this.getLogger();
            logger.debug(
              () => `TextToolCallParser failed on message content: ${error}`,
            );
          }
        }
      }

      // Emit the complete response as a single IContent
      if (blocks.length > 0) {
        const responseContent: IContent = {
          speaker: 'ai',
          blocks,
        };

        // Add usage metadata from non-streaming response
        if (completion.usage) {
          const cacheMetrics = extractCacheMetrics(completion.usage);
          responseContent.metadata = {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          };
        }

        yield responseContent;
      } else if (completion.usage) {
        // Emit metadata-only response if no content blocks but have usage info
        const cacheMetrics = extractCacheMetrics(completion.usage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }
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
          ...(abortSignal ? { signal: abortSignal } : {}),
          ...(mergedHeaders ? { headers: mergedHeaders } : {}),
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
