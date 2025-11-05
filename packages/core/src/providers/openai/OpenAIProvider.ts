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
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { IContent } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { OAuthManager } from '../../auth/precedence.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import {
  ToolCallBlock,
  TextBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { IModel } from '../IModel.js';
import { IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { filterOpenAIRequestParams } from './openaiRequestParams.js';

export class OpenAIProvider extends BaseProvider implements IProvider {
  override readonly name: string = 'openai';
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
    let isQwenEndpoint = false;
    if (baseURL) {
      try {
        const hostname = new URL(baseURL).hostname.toLowerCase();
        isQwenEndpoint =
          hostname === 'dashscope.aliyuncs.com' ||
          hostname.endsWith('.dashscope.aliyuncs.com') ||
          hostname === 'api.qwen.com' ||
          hostname.endsWith('.qwen.com');
      } catch {
        const lowered = baseURL.toLowerCase();
        isQwenEndpoint =
          lowered.includes('dashscope.aliyuncs.com') ||
          lowered.includes('api.qwen.com') ||
          lowered.includes('qwen.com');
      }
    }
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

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002
    // No constructor-captured state - all values sourced from normalized options per call
  }

  /**
   * Create HTTP/HTTPS agents with socket configuration for local AI servers
   * Returns undefined if no socket settings are configured
   *
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Now sources ephemeral settings from call options instead of provider config
   */
  private createHttpAgents(
    options?: NormalizedGenerateChatOptions,
  ): { httpAgent: http.Agent; httpsAgent: https.Agent } | undefined {
    // Get socket configuration from call options or fallback to provider config
    const settingsFromInvocation = options?.invocation?.ephemerals;
    const settings =
      settingsFromInvocation ??
      this.providerConfig?.getEphemeralSettings?.() ??
      {};

    // Check if any socket settings are explicitly configured
    const hasSocketSettings =
      'socket-timeout' in settings ||
      'socket-keepalive' in settings ||
      'socket-nodelay' in settings;

    // Only create custom agents if socket settings are configured
    if (!hasSocketSettings) {
      return undefined;
    }

    // Socket configuration with defaults for when settings ARE configured
    const socketTimeout = (settings['socket-timeout'] as number) || 60000; // 60 seconds default
    const socketKeepAlive = settings['socket-keepalive'] !== false; // true by default
    const socketNoDelay = settings['socket-nodelay'] !== false; // true by default

    // Create HTTP agent with socket options
    const httpAgent = new http.Agent({
      keepAlive: socketKeepAlive,
      keepAliveMsecs: 1000,
      timeout: socketTimeout,
    });

    // Create HTTPS agent with socket options
    const httpsAgent = new https.Agent({
      keepAlive: socketKeepAlive,
      keepAliveMsecs: 1000,
      timeout: socketTimeout,
    });

    // Apply TCP_NODELAY if enabled (reduces latency for local servers)
    if (socketNoDelay) {
      const originalCreateConnection = httpAgent.createConnection;
      httpAgent.createConnection = function (options, callback) {
        const socket = originalCreateConnection.call(this, options, callback);
        if (socket instanceof net.Socket) {
          socket.setNoDelay(true);
        }
        return socket;
      };

      const originalHttpsCreateConnection = httpsAgent.createConnection;
      httpsAgent.createConnection = function (options, callback) {
        const socket = originalHttpsCreateConnection.call(
          this,
          options,
          callback,
        );
        if (socket instanceof net.Socket) {
          socket.setNoDelay(true);
        }
        return socket;
      };
    }

    return { httpAgent, httpsAgent };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Extract model parameters from normalized options instead of settings service
   */
  private extractModelParamsFromOptions(
    options: NormalizedGenerateChatOptions,
  ): Record<string, unknown> | undefined {
    const providerSettings =
      options.settings?.getProviderSettings(this.name) ?? {};
    const configEphemerals = options.invocation?.ephemerals ?? {};

    const filteredProviderParams = filterOpenAIRequestParams(providerSettings);
    const filteredEphemeralParams = filterOpenAIRequestParams(configEphemerals);

    if (!filteredProviderParams && !filteredEphemeralParams) {
      return undefined;
    }

    return {
      ...(filteredProviderParams ?? {}),
      ...(filteredEphemeralParams ?? {}),
    };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Resolve runtime key from normalized options for client scoping
   */
  private resolveRuntimeKey(options: NormalizedGenerateChatOptions): string {
    if (options.runtime?.runtimeId) {
      return options.runtime.runtimeId;
    }

    const metadataRuntimeId = options.metadata?.runtimeId;
    if (typeof metadataRuntimeId === 'string' && metadataRuntimeId.trim()) {
      return metadataRuntimeId.trim();
    }

    const callId = options.settings.get('call-id');
    if (typeof callId === 'string' && callId.trim()) {
      return `call:${callId.trim()}`;
    }

    return 'openai.runtime.unscoped';
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

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * Instantiates a fresh OpenAI client per call to preserve stateless behaviour.
   */
  private instantiateClient(
    authToken: string,
    baseURL?: string,
    agents?: { httpAgent: http.Agent; httpsAgent: https.Agent },
  ): OpenAI {
    const clientOptions: Record<string, unknown> = {
      apiKey: authToken || '',
      maxRetries: 0,
    };

    if (baseURL && baseURL.trim() !== '') {
      clientOptions.baseURL = baseURL;
    }

    if (agents) {
      clientOptions.httpAgent = agents.httpAgent;
      clientOptions.httpsAgent = agents.httpsAgent;
    }

    return new OpenAI(
      clientOptions as unknown as ConstructorParameters<typeof OpenAI>[0],
    );
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * Creates a client scoped to the active runtime metadata without caching.
   */
  protected async getClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    const authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    if (!authToken) {
      throw new Error(
        `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).")`,
      );
    }
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;
    const agents = this.createHttpAgents(options);
    return this.instantiateClient(authToken, baseURL, agents);
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
    try {
      // Always try to fetch models, regardless of auth status
      // Local endpoints often work without authentication
      const authToken = await this.getAuthToken();
      const baseURL = this.getBaseURL();
      const agents = this.createHttpAgents();
      const client = this.instantiateClient(authToken, baseURL, agents);
      const response = await client.models.list();
      const models: IModel[] = [];

      for await (const model of response) {
        // Filter out non-chat models (embeddings, audio, image, vision, DALL·E, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          models.push({
            id: model.id,
            name: model.id,
            provider: 'openai',
            supportedToolFormats: ['openai'],
          });
        }
      }

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
    return [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo-preview',
        name: 'GPT-4.2 Turbo Preview',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo',
        name: 'GPT-4.2 Turbo',
        provider: 'openai',
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
   * Normalize tool IDs from various formats to OpenAI format
   * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
   */
  private normalizeToOpenAIToolId(id: string): string {
    // If already in OpenAI format, return as-is
    if (id.startsWith('call_')) {
      return id;
    }

    // For history format, extract the UUID and add OpenAI prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return 'call_' + uuid;
    }

    // For Anthropic format, extract the UUID and add OpenAI prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'call_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'call_' + id;
  }

  /**
   * Normalize tool IDs from OpenAI format to history format
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
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
    const runtimeKey = this.resolveRuntimeKey(options);
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
   * Convert IContent array to OpenAI ChatCompletionMessageParam array
   */
  private convertToOpenAIMessages(
    contents: IContent[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const content of contents) {
      if (content.speaker === 'human') {
        // Convert human messages to user messages
        const textBlocks = content.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const text = textBlocks.map((b) => b.text).join('\n');
        if (text) {
          messages.push({
            role: 'user',
            content: text,
          });
        }
      } else if (content.speaker === 'ai') {
        // Convert AI messages
        const textBlocks = content.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCalls = content.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        if (toolCalls.length > 0) {
          // Assistant message with tool calls
          const text = textBlocks.map((b) => b.text).join('\n');
          messages.push({
            role: 'assistant',
            content: text || null,
            tool_calls: toolCalls.map((tc) => ({
              id: this.normalizeToOpenAIToolId(tc.id),
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.parameters === 'string'
                    ? tc.parameters
                    : JSON.stringify(tc.parameters),
              },
            })),
          });
        } else if (textBlocks.length > 0) {
          // Plain assistant message
          const text = textBlocks.map((b) => b.text).join('\n');
          messages.push({
            role: 'assistant',
            content: text,
          });
        }
      } else if (content.speaker === 'tool') {
        // Convert tool responses
        const toolResponses = content.blocks.filter(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock[];
        for (const tr of toolResponses) {
          messages.push({
            role: 'tool',
            content:
              typeof tr.result === 'string'
                ? tr.result
                : JSON.stringify(tr.result),
            tool_call_id: this.normalizeToOpenAIToolId(tr.callId),
          });
        }
      }
    }

    return messages;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Internal implementation for chat completion using normalized options
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

    // Convert IContent to OpenAI messages format
    const messages = this.convertToOpenAIMessages(contents);

    // Detect the tool format to use (once at the start of the method)
    const detectedFormat = this.detectToolFormat();

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

    // Convert Gemini format tools to the detected format
    let formattedTools = toolFormatter.convertGeminiToFormat(
      tools,
      detectedFormat,
    ) as
      | Array<{
          type: 'function';
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>
      | undefined;

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
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      model,
      toolNamesArg,
    );

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
      requestBody.tools = JSON.parse(JSON.stringify(formattedTools));
      requestBody.tool_choice = 'auto';
    }

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-002
     * Extract per-call request overrides from normalized options instead of cached state
     */
    const requestOverrides = this.extractModelParamsFromOptions(options);
    if (requestOverrides) {
      if (logger.enabled) {
        logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
          overrideKeys: Object.keys(requestOverrides),
        });
      }
      Object.assign(requestBody, requestOverrides);
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

    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Request body preview`, {
        model: requestBody.model,
        hasStop: 'stop' in requestBody,
        hasMaxTokens: 'max_tokens' in requestBody,
        hasResponseFormat: 'response_format' in requestBody,
        overrideKeys: requestOverrides ? Object.keys(requestOverrides) : [],
      });
    }

    try {
      response = await retryWithBackoff(
        () =>
          client.chat.completions.create(requestBody, {
            ...(abortSignal ? { signal: abortSignal } : {}),
            ...(customHeaders ? { headers: customHeaders } : {}),
          }),
        {
          maxAttempts: maxRetries,
          initialDelayMs,
          shouldRetry: this.shouldRetryResponse.bind(this),
          trackThrottleWaitTime: this.throttleTracker,
        },
      );
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
        (enhancedError as Error & { originalError?: unknown }).originalError =
          error;
        throw enhancedError;
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

    // Check if response is streaming or not
    if (streamingEnabled) {
      // Process streaming response
      let _accumulatedText = '';
      const accumulatedToolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }> = [];

      // Buffer for accumulating text chunks for providers that need it
      let textBuffer = '';
      // Use the same detected format from earlier for consistency
      // Buffer text for Qwen format providers to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen';

      // Track token usage from streaming chunks
      let streamingUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      try {
        // Handle streaming response
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
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

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            logger.debug(
              () =>
                `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
              {
                model,
                finishReason: choice.finish_reason,
                hasAccumulatedText: _accumulatedText.length > 0,
                hasAccumulatedTools: accumulatedToolCalls.length > 0,
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

            // Flush any buffered text when stream finishes
            if (textBuffer.length > 0) {
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: textBuffer,
                  } as TextBlock,
                ],
              } as IContent;
              textBuffer = '';
            }
          }

          // Handle text content - buffer for Qwen format, emit immediately for others
          const deltaContent = choice.delta?.content;
          if (deltaContent) {
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

              // Emit buffered text when we have a complete sentence or paragraph
              // Look for natural break points
              if (
                textBuffer.includes('\n') ||
                textBuffer.endsWith('. ') ||
                textBuffer.endsWith('! ') ||
                textBuffer.endsWith('? ') ||
                textBuffer.length > 100
              ) {
                yield {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'text',
                      text: textBuffer,
                    } as TextBlock,
                  ],
                } as IContent;
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

          // Handle tool calls
          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls && deltaToolCalls.length > 0) {
            for (const deltaToolCall of deltaToolCalls) {
              if (deltaToolCall.index === undefined) continue;

              // Initialize or update accumulated tool call
              if (!accumulatedToolCalls[deltaToolCall.index]) {
                accumulatedToolCalls[deltaToolCall.index] = {
                  id: deltaToolCall.id || '',
                  type: 'function',
                  function: {
                    name: deltaToolCall.function?.name || '',
                    arguments: '',
                  },
                };
              }

              const tc = accumulatedToolCalls[deltaToolCall.index];
              if (tc) {
                if (deltaToolCall.id) tc.id = deltaToolCall.id;
                if (deltaToolCall.function?.name)
                  tc.function.name = deltaToolCall.function.name;
                if (deltaToolCall.function?.arguments) {
                  tc.function.arguments += deltaToolCall.function.arguments;
                }
              }
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

                let targetIndex = index;
                const annotated =
                  toolCall as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                    index?: number;
                  };
                if (typeof annotated.index === 'number') {
                  targetIndex = annotated.index;
                } else if (toolCall.id) {
                  const matchIndex = accumulatedToolCalls.findIndex(
                    (existing) => existing && existing.id === toolCall.id,
                  );
                  if (matchIndex >= 0) {
                    targetIndex = matchIndex;
                  }
                }

                if (!accumulatedToolCalls[targetIndex]) {
                  accumulatedToolCalls[targetIndex] = {
                    id: toolCall.id || '',
                    type: 'function',
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: '',
                    },
                  };
                }

                const target = accumulatedToolCalls[targetIndex];
                if (toolCall.id) {
                  target.id = toolCall.id;
                }
                if (toolCall.function?.name) {
                  target.function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments !== undefined) {
                  target.function.arguments = toolCall.function.arguments ?? '';
                }
              },
            );
          }
        }
      } catch (error) {
        if (abortSignal?.aborted) {
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

      // Flush any remaining buffered text
      if (textBuffer.length > 0) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: textBuffer,
            } as TextBlock,
          ],
        } as IContent;
        textBuffer = '';
      }

      // Emit accumulated tool calls as IContent if any
      if (accumulatedToolCalls.length > 0) {
        const blocks: ToolCallBlock[] = [];
        // Use the same detected format from earlier for consistency

        for (const tc of accumulatedToolCalls) {
          if (!tc) continue;

          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            tc.function.arguments || '',
            tc.function.name || '',
            detectedFormat,
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(tc.id),
            name: tc.function.name || '',
            parameters: processedParameters,
          });
        }

        if (blocks.length > 0) {
          const toolCallsContent: IContent = {
            speaker: 'ai',
            blocks,
          };

          // Add usage metadata if we captured it from streaming
          if (streamingUsage) {
            toolCallsContent.metadata = {
              usage: {
                promptTokens: streamingUsage.prompt_tokens || 0,
                completionTokens: streamingUsage.completion_tokens || 0,
                totalTokens:
                  streamingUsage.total_tokens ||
                  (streamingUsage.prompt_tokens || 0) +
                    (streamingUsage.completion_tokens || 0),
              },
            };
          }

          yield toolCallsContent;
        }
      }

      // If we have usage information but no tool calls, emit a metadata-only response
      if (streamingUsage && accumulatedToolCalls.length === 0) {
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
            },
          },
        } as IContent;
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

      // Handle text content
      if (choice.message?.content) {
        blocks.push({
          type: 'text',
          text: choice.message.content,
        } as TextBlock);
      }

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        // Use the same detected format from earlier for consistency

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              toolCall.function.arguments || '',
              toolCall.function.name || '',
              detectedFormat,
            );

            blocks.push({
              type: 'tool_call',
              id: this.normalizeToHistoryToolId(toolCall.id),
              name: toolCall.function.name || '',
              parameters: processedParameters,
            } as ToolCallBlock);
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
          responseContent.metadata = {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
            },
          };
        }

        yield responseContent;
      } else if (completion.usage) {
        // Emit metadata-only response if no content blocks but have usage info
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
            },
          },
        } as IContent;
      }
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Memoization of model parameters disabled for stateless provider
   */
  setModelParams(_params: Record<string, unknown> | undefined): void {
    throw new Error(
      'ProviderCacheError("Attempted to memoize model parameters for openai")',
    );
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets model parameters from SettingsService per call (stateless)
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
        'baseUrl',
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
   * Get the tool format for this provider using normalized options
   * @returns The tool format to use
   */
  override getToolFormat(): string {
    const format = this.detectToolFormat();
    const logger = new DebugLogger('llxprt:provider:openai');
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  /**
   * Detects the tool call format based on the model being used
   * @returns The detected tool format ('openai' or 'qwen')
   */
  private detectToolFormat(): ToolFormat {
    // Auto-detect based on model name if set to 'auto' or not set
    const modelName = (this.getModel() || this.getDefaultModel()).toLowerCase();
    const logger = new DebugLogger('llxprt:provider:openai');

    // Check for GLM-4 models (glm-4, glm-4.5, glm-4.6, glm-4-5, etc.)
    if (modelName.includes('glm-4')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for GLM-4.x model: ${modelName}`,
      );
      return 'qwen';
    }

    // Check for qwen models
    if (modelName.includes('qwen')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for Qwen model: ${modelName}`,
      );
      return 'qwen';
    }

    // Default to 'openai' format
    logger.debug(() => `Using default 'openai' format for model: ${modelName}`);
    return 'openai';
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
    const logger = new DebugLogger('llxprt:provider:openai');

    // Don't retry if we're streaming chunks - just continue processing
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 200
    ) {
      return false;
    }

    // Check OpenAI SDK v5 error structure
    let status: number | undefined;

    // OpenAI SDK v5 error structure
    if (error && typeof error === 'object' && 'status' in error) {
      status = (error as { status?: number }).status;
    }

    // Also check error.response?.status for axios-style errors
    if (!status && error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response && typeof response === 'object' && 'status' in response) {
        status = response.status;
      }
    }

    // Also check error message for 429
    if (!status && error instanceof Error) {
      if (error.message.includes('429')) {
        status = 429;
      }
    }

    // Log what we're seeing
    logger.debug(() => `shouldRetryResponse checking error:`, {
      hasError: !!error,
      errorType: error?.constructor?.name,
      status,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
    });

    // Retry on 429 rate limit errors or 5xx server errors
    const shouldRetry = Boolean(
      status === 429 || status === 503 || status === 504,
    );

    if (shouldRetry) {
      logger.debug(() => `Will retry request due to status ${status}`);
    }

    return shouldRetry;
  }
}
