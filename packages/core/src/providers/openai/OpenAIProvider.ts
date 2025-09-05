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
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { ITool } from '../ITool.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import OpenAI from 'openai';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import {
  isQwenEndpoint,
  generateOAuthEndpointMismatchError,
} from '../../config/endpoints.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import { retryWithBackoff } from '../../utils/retry.js';
import {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
} from '../../services/history/IContent.js';

export class OpenAIProvider extends BaseProvider {
  private logger: DebugLogger;
  private openai: OpenAI;
  private currentModel: string = process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
  private baseURL?: string;
  private providerConfig?: IProviderConfig;
  private toolFormatter: ToolFormatter;
  private toolFormatOverride?: ToolFormat;
  private modelParams?: Record<string, unknown>;
  private _cachedClient?: OpenAI;
  private _cachedClientKey?: string;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Initialize base provider with auth configuration
    // Check if we should enable OAuth for Qwen
    // Check OAuth enablement from OAuth manager if available
    let shouldEnableQwenOAuth = false;
    if (oauthManager) {
      // Check if OAuth is enabled for qwen in the OAuth manager (from settings)
      const manager = oauthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        shouldEnableQwenOAuth = manager.isOAuthEnabled('qwen');
      }

      // Also enable if this looks like a Qwen endpoint
      if (!shouldEnableQwenOAuth) {
        shouldEnableQwenOAuth =
          isQwenEndpoint(baseURL || '') ||
          (!baseURL && (!apiKey || apiKey === '')) ||
          baseURL === 'https://portal.qwen.ai/v1';
      }
    }

    const baseConfig: BaseProviderConfig = {
      name: 'openai',
      apiKey,
      baseURL,
      envKeyNames: ['OPENAI_API_KEY'],
      isOAuthEnabled: shouldEnableQwenOAuth,
      oauthProvider: shouldEnableQwenOAuth ? 'qwen' : undefined,
      oauthManager,
    };

    super(baseConfig);

    this.logger = new DebugLogger('llxprt:providers:openai');
    this.logger.debug(
      () =>
        `Constructor - baseURL: ${baseURL}, apiKey: ${apiKey?.substring(0, 10) || 'none'}, oauthManager: ${!!oauthManager}, shouldEnableQwenOAuth: ${shouldEnableQwenOAuth}`,
    );
    this.baseURL = baseURL;
    this.providerConfig = config;
    this.toolFormatter = new ToolFormatter();

    // Initialize from SettingsService
    this.initializeFromSettings().catch((error) => {
      this.logger.debug(
        () => `Failed to initialize from SettingsService: ${error}`,
      );
    });

    // Set appropriate default model based on the provider
    if (shouldEnableQwenOAuth || isQwenEndpoint(baseURL || '')) {
      // Default to Qwen model when using Qwen endpoints
      this.currentModel = 'qwen3-coder-plus';
    } else if (process.env.LLXPRT_DEFAULT_MODEL) {
      // Use environment variable if set
      this.currentModel = process.env.LLXPRT_DEFAULT_MODEL;
    }

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: apiKey || 'placeholder', // OpenAI client requires a string, use placeholder if OAuth will be used
      // Allow browser environment if explicitly configured
      dangerouslyAllowBrowser: config?.allowBrowserEnvironment || false,
    };
    // Only include baseURL if it's defined
    if (baseURL) {
      clientOptions.baseURL = baseURL;
    }
    this.openai = new OpenAI(clientOptions);
    this._cachedClientKey = apiKey; // Track the initial key used

    // Cached client reserved for future optimization
    void this._cachedClient;
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Only support Qwen OAuth for Qwen endpoints
    // Use baseProviderConfig.baseURL if this.baseURL not set yet (during constructor)
    const baseURL =
      this.baseURL ||
      this.baseProviderConfig.baseURL ||
      'https://api.openai.com/v1';
    return isQwenEndpoint(baseURL);
  }

  /**
   * Helper method to determine if we're using Qwen (via OAuth or direct endpoint)
   */
  private isUsingQwen(): boolean {
    // Check if we're using qwen format based on tool format detection
    const toolFormat = this.detectToolFormat();
    return toolFormat === 'qwen';
  }

  /**
   * Update the OpenAI client with resolved authentication if needed
   */
  private async updateClientWithResolvedAuth(): Promise<void> {
    const resolvedKey = await this.getAuthToken();
    if (!resolvedKey) {
      // Provide specific error message based on endpoint validation
      const endpoint = this.baseURL || 'https://api.openai.com/v1';
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(generateOAuthEndpointMismatchError(endpoint, 'qwen'));
      }
      throw new Error('No authentication available for OpenAI API calls');
    }

    // Check if we're using Qwen OAuth and need to update the baseURL
    let effectiveBaseURL = this.baseURL;

    this.logger.debug(
      () =>
        `updateClientWithResolvedAuth - OAuth enabled: ${this.isOAuthEnabled()}, OAuth provider: ${this.baseProviderConfig.oauthProvider}, baseURL: ${this.baseURL}, resolvedKey: ${resolvedKey?.substring(0, 10)}...`,
    );

    if (
      this.isOAuthEnabled() &&
      this.baseProviderConfig.oauthProvider === 'qwen'
    ) {
      // Get the OAuth token to check for resource_url
      const oauthManager = this.baseProviderConfig.oauthManager;
      if (oauthManager?.getOAuthToken) {
        const oauthToken = await oauthManager.getOAuthToken('qwen');
        this.logger.debug(
          () =>
            `OAuth token retrieved:\n` +
            `  resource_url: ${oauthToken?.resource_url}\n` +
            `  access_token: ${oauthToken?.access_token?.substring(0, 10)}...`,
        );
        if (oauthToken?.resource_url) {
          // Use the resource_url from the OAuth token
          effectiveBaseURL = `https://${oauthToken.resource_url}/v1`;
          this.logger.debug(
            () => `Using Qwen OAuth endpoint: ${effectiveBaseURL}`,
          );
        }
      }
    }

    // Only update client if the key or URL has changed
    if (
      this._cachedClientKey !== resolvedKey ||
      this.baseURL !== effectiveBaseURL
    ) {
      const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
        apiKey: resolvedKey,
        // Allow browser environment if explicitly configured
        dangerouslyAllowBrowser:
          this.providerConfig?.allowBrowserEnvironment || false,
      };
      // Only include baseURL if it's defined
      if (effectiveBaseURL) {
        clientOptions.baseURL = effectiveBaseURL;
      }

      this.openai = new OpenAI(clientOptions);
      this._cachedClientKey = resolvedKey;
      // Update the baseURL to track changes
      if (effectiveBaseURL !== this.baseURL) {
        this.baseURL = effectiveBaseURL;
      }
    }
  }

  override getToolFormat(): ToolFormat {
    // Check manual override first
    if (this.toolFormatOverride) {
      return this.toolFormatOverride;
    }

    // Check for settings override
    if (this.providerConfig?.providerToolFormatOverrides?.[this.name]) {
      return this.providerConfig.providerToolFormatOverrides[
        this.name
      ] as ToolFormat;
    }

    // Auto-detect tool format based on model or base URL
    if (
      this.currentModel.includes('deepseek') ||
      this.baseURL?.includes('deepseek')
    ) {
      return 'deepseek';
    }

    // Check for Qwen - including OAuth authenticated Qwen
    if (this.isUsingQwen()) {
      return 'qwen';
    }

    // Default to OpenAI format
    return 'openai';
  }

  override async getModels(): Promise<IModel[]> {
    // Check if API key is available (using resolved authentication)
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      const endpoint = this.baseURL || 'https://api.openai.com/v1';
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(generateOAuthEndpointMismatchError(endpoint, 'qwen'));
      }
      throw new Error('OpenAI API key is required to fetch models');
    }

    try {
      // Get resolved authentication and update client if needed
      await this.updateClientWithResolvedAuth();

      const response = await this.openai.models.list();
      const models: IModel[] = [];

      for await (const model of response) {
        // Filter out non-chat models (embeddings, audio, image, moderation, DALL·E, etc.)
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
      this.logger.debug(() => `Error fetching models from OpenAI: ${error}`);
      // Return a hardcoded list as fallback
      // Check if this is a Qwen endpoint
      if (isQwenEndpoint(this.baseURL || '')) {
        return [
          {
            id: 'qwen3-coder-plus',
            name: 'qwen3-coder-plus',
            provider: 'openai',
            supportedToolFormats: ['openai'],
          },
        ];
      }

      // Default OpenAI models
      return [
        {
          id: 'gpt-4o',
          name: 'gpt-4o',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-4o-mini',
          name: 'gpt-4o-mini',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-4-turbo',
          name: 'gpt-4-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'gpt-3.5-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
      ];
    }
  }

  override setModel(modelId: string): void {
    // Update SettingsService as the source of truth
    this.setModelInSettings(modelId).catch((error) => {
      this.logger.debug(
        () => `Failed to persist model to SettingsService: ${error}`,
      );
    });
    // Keep local cache for performance
    this.currentModel = modelId;
  }

  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = getSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (providerSettings.model) {
        return providerSettings.model as string;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    // Fall back to cached value or default
    return this.currentModel || this.getDefaultModel();
  }

  override getDefaultModel(): string {
    // Return the default model for this provider
    // This can be overridden based on configuration or endpoint
    if (this.isUsingQwen()) {
      return 'qwen3-coder-plus';
    }
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey(apiKey);

    // Persist to SettingsService if available
    this.setApiKeyInSettings(apiKey).catch((error) => {
      this.logger.debug(
        () => `Failed to persist API key to SettingsService: ${error}`,
      );
    });

    // Create a new OpenAI client with the updated API key
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey,
      dangerouslyAllowBrowser:
        this.providerConfig?.allowBrowserEnvironment || false,
    };
    // Only include baseURL if it's defined
    if (this.baseURL) {
      clientOptions.baseURL = this.baseURL;
    }
    this.openai = new OpenAI(clientOptions);
    this._cachedClientKey = apiKey; // Update cached key
  }

  override setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, clear to default (undefined)
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;

    // Persist to SettingsService if available
    this.setBaseUrlInSettings(this.baseURL).catch((error) => {
      this.logger.debug(
        () => `Failed to persist base URL to SettingsService: ${error}`,
      );
    });

    // Update OAuth configuration based on endpoint validation
    // Enable OAuth for Qwen endpoints if we have an OAuth manager
    const shouldEnableQwenOAuth =
      !!this.baseProviderConfig.oauthManager &&
      (isQwenEndpoint(this.baseURL || '') ||
        this.baseURL === 'https://portal.qwen.ai/v1');

    this.updateOAuthConfig(
      shouldEnableQwenOAuth,
      shouldEnableQwenOAuth ? 'qwen' : undefined,
      this.baseProviderConfig.oauthManager, // Pass the existing OAuth manager
    );

    // Call base provider implementation
    super.setBaseUrl?.(baseUrl);

    // Create a new OpenAI client with the updated (or cleared) base URL
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      // Use existing key or empty string as placeholder
      apiKey: this._cachedClientKey || 'placeholder',
      dangerouslyAllowBrowser:
        this.providerConfig?.allowBrowserEnvironment || false,
    };
    // Only include baseURL if it's defined
    if (this.baseURL) {
      clientOptions.baseURL = this.baseURL;
    }
    this.openai = new OpenAI(clientOptions);
    // Clear cached key to force re-resolution on next API call
    this._cachedClientKey = undefined;
  }

  override setConfig(config: IProviderConfig): void {
    this.providerConfig = config;
  }

  override setToolFormatOverride(format: ToolFormat | null): void {
    this.toolFormatOverride = format || undefined;
  }

  /**
   * OpenAI always requires payment (API key)
   */
  override isPaidMode(): boolean {
    return true;
  }

  override clearState(): void {
    // No state to clear in base OpenAI provider
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  override async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by OpenAI provider');
  }

  /**
   * Set model parameters to be included in API calls
   * @param params Parameters to merge with existing, or undefined to clear all
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
    } else {
      this.modelParams = { ...this.modelParams, ...params };
    }

    // Persist to SettingsService if available
    this.setModelParamsInSettings(this.modelParams).catch((error) => {
      this.logger.debug(
        () => `Failed to persist model params to SettingsService: ${error}`,
      );
    });
  }

  /**
   * Get current model parameters
   * @returns Current parameters or undefined if not set
   */
  override getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  /**
   * Generate chat completion with IContent interface
   * Internally converts to OpenAI API format, but only yields IContent
   */
  async *generateChatCompletion(
    content: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // Convert IContent directly to OpenAI API format (no IMessage!)
    const apiMessages: Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
      tool_call_id?: string;
    }> = [];

    for (const c of content) {
      if (c.speaker === 'human') {
        const textBlock = c.blocks.find((b) => b.type === 'text') as
          | TextBlock
          | undefined;
        apiMessages.push({
          role: 'user',
          content: textBlock?.text || '',
        });
      } else if (c.speaker === 'ai') {
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        const contentText = textBlocks.map((b) => b.text).join('');
        const toolCalls =
          toolCallBlocks.length > 0
            ? toolCallBlocks.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.parameters),
                },
              }))
            : undefined;

        apiMessages.push({
          role: 'assistant',
          content: contentText || null,
          tool_calls: toolCalls,
        });
      } else if (c.speaker === 'tool') {
        const toolResponseBlock = c.blocks.find(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock | undefined;
        if (!toolResponseBlock) {
          throw new Error('Tool content must have a tool_response block');
        }

        apiMessages.push({
          role: 'tool',
          content: JSON.stringify(toolResponseBlock.result),
          tool_call_id: toolResponseBlock.callId,
        });
      } else {
        throw new Error(`Unknown speaker type: ${c.speaker}`);
      }
    }

    // Debug log the converted messages
    this.logger.debug(
      () =>
        `Converted messages for OpenAI API: ${JSON.stringify(apiMessages, null, 2)}`,
    );

    // Convert Gemini format tools to OpenAI format
    // Handle both legacy 'parameters' and new 'parametersJsonSchema' formats
    const apiTools = tools
      ? tools[0].functionDeclarations.map((decl) => {
          // Support both old 'parameters' and new 'parametersJsonSchema' formats
          // DeclarativeTool uses parametersJsonSchema, while legacy tools use parameters
          const toolParameters =
            'parametersJsonSchema' in decl
              ? (decl as { parametersJsonSchema?: unknown })
                  .parametersJsonSchema
              : decl.parameters;

          return {
            type: 'function' as const,
            function: {
              name: decl.name,
              description: decl.description || '',
              parameters: toolParameters || {},
            },
          };
        })
      : undefined;

    // Get auth token
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    // Build request
    const requestBody = {
      model: this.currentModel || 'gpt-4o-mini',
      messages: apiMessages,
      ...(apiTools && { tools: apiTools }),
      stream: true,
      ...(this.modelParams || {}),
    };

    // Wrap the API call with retry logic
    const makeApiCall = async () => {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Create an error object that matches what we check for in isRetryableError
        const error = new Error(`OpenAI API error: ${errorText}`) as Error & {
          status?: number;
          error?: unknown;
        };
        error.status = response.status;

        // Try to parse the error response
        try {
          const errorObj = JSON.parse(errorText);
          error.error = errorObj;
        } catch {
          // If not JSON, keep as text
        }

        this.logger.debug(
          () =>
            `API call error in generateChatCompletion: status=${response.status}, error=${errorText}`,
        );

        throw error;
      }

      return response;
    };

    // Use retry logic with longer delays for rate limits
    const response = await retryWithBackoff(makeApiCall, {
      shouldRetry: (error: Error) => {
        const shouldRetry = this.isRetryableError(error);
        this.logger.debug(
          () =>
            `Retry decision in generateChatCompletion: shouldRetry=${shouldRetry}, error=${String(error).substring(0, 200)}`,
        );
        return shouldRetry;
      },
      maxAttempts: 6, // Allow up to 6 attempts (initial + 5 retries)
      initialDelayMs: 4000, // Start with 4 seconds for 429 errors
      maxDelayMs: 65000, // Allow up to 65 seconds delay
    });

    // Parse streaming response and emit IContent
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    const accumulatedToolCalls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.content) {
            // Emit text content immediately as IContent
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: delta.content }],
            } as IContent;
          }

          if (delta?.tool_calls) {
            // Accumulate tool calls
            for (const toolCall of delta.tool_calls) {
              if (toolCall.index !== undefined) {
                if (!accumulatedToolCalls[toolCall.index]) {
                  accumulatedToolCalls[toolCall.index] = {
                    id: toolCall.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                }
                const tc = accumulatedToolCalls[toolCall.index];
                if (toolCall.id) tc.id = toolCall.id;
                if (toolCall.function?.name)
                  tc.function.name = toolCall.function.name;
                if (toolCall.function?.arguments)
                  tc.function.arguments += toolCall.function.arguments;
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON lines
          this.logger.debug(() => `Failed to parse SSE line: ${e}`);
        }
      }
    }

    // Emit accumulated tool calls as IContent if any
    if (accumulatedToolCalls.length > 0) {
      const blocks: ToolCallBlock[] = [];
      for (const tc of accumulatedToolCalls) {
        if (!tc) continue;
        try {
          blocks.push({
            type: 'tool_call',
            id: tc.id,
            name: tc.function.name,
            parameters: JSON.parse(tc.function.arguments),
          });
        } catch (_e) {
          // If parsing fails, emit with string parameters
          blocks.push({
            type: 'tool_call',
            id: tc.id,
            name: tc.function.name,
            parameters: tc.function.arguments,
          } as ToolCallBlock);
        }
      }

      if (blocks.length > 0) {
        yield {
          speaker: 'ai',
          blocks,
        } as IContent;
      }
    }
  }
  /**
   * Initialize provider configuration from SettingsService
   */
  private async initializeFromSettings(): Promise<void> {
    try {
      // Load saved model if available
      const savedModel = await this.getModelFromSettings();
      if (savedModel) {
        this.currentModel = savedModel;
      }

      // Load saved base URL if available
      const savedBaseUrl = await this.getBaseUrlFromSettings();
      if (savedBaseUrl !== undefined) {
        this.baseURL = savedBaseUrl;
      }

      // Load saved model parameters if available
      const savedParams = await this.getModelParamsFromSettings();
      if (savedParams) {
        this.modelParams = savedParams;
      }

      this.logger.debug(
        () =>
          `Initialized from SettingsService - model: ${this.currentModel}, baseURL: ${this.baseURL}, params: ${JSON.stringify(this.modelParams)}`,
      );
    } catch (error) {
      this.logger.debug(
        () =>
          `Failed to initialize OpenAI provider from SettingsService: ${error}`,
      );
    }
  }

  /**
   * Check if the provider is authenticated using any available method
   * Uses the base provider's isAuthenticated implementation
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }

  /**
   * Detect the appropriate tool format for the current model/configuration
   * @returns The detected tool format
   */
  detectToolFormat(): ToolFormat {
    try {
      const settingsService = getSettingsService();

      // First check SettingsService for toolFormat override in provider settings
      // Note: This is synchronous access to cached settings, not async
      const currentSettings = settingsService['settings'];
      const providerSettings = currentSettings?.providers?.[this.name];
      const toolFormatOverride = providerSettings?.toolFormat as
        | ToolFormat
        | 'auto'
        | undefined;

      // If explicitly set to a specific format (not 'auto'), use it
      if (toolFormatOverride && toolFormatOverride !== 'auto') {
        return toolFormatOverride;
      }

      // Auto-detect based on model name if set to 'auto' or not set
      const modelName = this.currentModel.toLowerCase();

      // Check for GLM-4.5 models (glm-4.5, glm-4-5)
      if (modelName.includes('glm-4.5') || modelName.includes('glm-4-5')) {
        return 'qwen';
      }

      // Check for qwen models
      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      // Default to 'openai' format
      return 'openai';
    } catch (error) {
      this.logger.debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );

      // Fallback detection without SettingsService
      const modelName = this.currentModel.toLowerCase();

      if (modelName.includes('glm-4.5') || modelName.includes('glm-4-5')) {
        return 'qwen';
      }

      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      return 'openai';
    }
  }

  /**
   * Format tools for API based on detected tool format
   * @param tools Array of tools to format
   * @returns Formatted tools for API consumption
   */
  formatToolsForAPI(tools: ITool[]): unknown {
    // For now, always use OpenAI format through OpenRouter
    // TODO: Investigate if OpenRouter needs special handling for GLM/Qwen
    // const detectedFormat = this.detectToolFormat();
    // if (detectedFormat === 'qwen') {
    //   // Convert OpenAI format to Qwen format: {name, description, parameters} without type/function wrapper
    //   return tools.map((tool) => ({
    //     name: tool.function.name,
    //     description: tool.function.description,
    //     parameters: tool.function.parameters,
    //   }));
    // }

    // For all formats, use the existing ToolFormatter
    return this.toolFormatter.toProviderFormat(tools, 'openai');
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
   * Determines if an error should trigger a retry
   */
  private isRetryableError(error: Error | unknown): boolean {
    // Check for OpenAI SDK specific error types
    // The OpenAI SDK throws specific error classes for different error types
    if (error && typeof error === 'object') {
      const errorName = (error as Error).constructor?.name;

      // Check for OpenAI SDK RateLimitError or InternalServerError
      if (
        errorName === 'RateLimitError' ||
        errorName === 'InternalServerError'
      ) {
        this.logger.debug(
          () => `Retryable OpenAI SDK error detected: ${errorName}`,
        );
        return true;
      }

      // Check for status property (OpenAI APIError has a status property)
      if ('status' in error) {
        const status = (error as { status: number }).status;
        // Retry on 429 (rate limit) and 5xx errors
        if (status === 429 || (status >= 500 && status < 600)) {
          this.logger.debug(
            () => `Retryable error detected - status: ${status}`,
          );
          return true;
        }
      }

      // Check for nested error object (some OpenAI errors have error.error structure)
      if (
        'error' in error &&
        typeof (error as { error: unknown }).error === 'object'
      ) {
        const nestedError = (
          error as { error: { code?: string; type?: string } }
        ).error;
        if (
          nestedError?.code === 'token_quota_exceeded' ||
          nestedError?.type === 'too_many_tokens_error' ||
          nestedError?.code === 'rate_limit_exceeded'
        ) {
          this.logger.debug(
            () =>
              `Retryable error detected from error code: ${nestedError.code || nestedError.type}`,
          );
          return true;
        }
      }
    }

    // Check error message for rate limit indicators
    const errorMessage = String(error).toLowerCase();
    const retryablePatterns = [
      'rate limit',
      'rate_limit',
      'quota_exceeded',
      'too_many_tokens',
      'too many requests',
      '429',
      'overloaded',
      'server_error',
      'service_unavailable',
      'internal server error',
      '500',
      '502',
      '503',
      '504',
    ];

    const shouldRetry = retryablePatterns.some((pattern) =>
      errorMessage.includes(pattern),
    );

    if (shouldRetry) {
      this.logger.debug(
        () => `Retryable error detected from message pattern: ${errorMessage}`,
      );
    }

    return shouldRetry;
  }

  /**
   * Process tool calls for Qwen models, fixing double stringification
   * @param toolCalls The tool calls to process
   * @returns Processed tool calls with fixes applied
   */
}
