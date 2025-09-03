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
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
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

  private requiresTextToolCallParsing(): boolean {
    if (this.providerConfig?.enableTextToolCallParsing === false) {
      return false;
    }

    // Check if current tool format requires text-based parsing
    const currentFormat = this.getToolFormat();
    const textBasedFormats: ToolFormat[] = ['hermes', 'xml', 'llama'];
    if (textBasedFormats.includes(currentFormat)) {
      return true;
    }

    const configuredModels = this.providerConfig?.textToolCallModels || [];
    return configuredModels.includes(this.currentModel);
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

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<IMessage> {
    // 1. Validate authentication and messages
    await this.validateRequestPreconditions(messages);

    // 2. Prepare request configuration
    const requestConfig = this.prepareApiRequest(messages, tools);

    // 3. Make API call with error handling
    const response = await this.executeApiCall(messages, tools, requestConfig);

    // 4. Process response based on streaming mode
    let processedData: {
      fullContent: string;
      accumulatedToolCalls: NonNullable<IMessage['tool_calls']>;
      hasStreamedContent: boolean;
      usageData?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      pendingWhitespace: string | null;
    } = {
      fullContent: '',
      accumulatedToolCalls: [],
      hasStreamedContent: false,
      usageData: undefined,
      pendingWhitespace: null,
    };

    if (requestConfig.streamingEnabled) {
      // Need to yield streaming content as it comes
      const streamResponse =
        response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

      try {
        for await (const chunk of streamResponse) {
          // Deep copy chunk to avoid immutable object errors with qwen models
          const chunkCopy = this.deepCopy(chunk);
          const delta = chunkCopy.choices?.[0]?.delta;

          if (delta?.content && !requestConfig.parser) {
            // Sanitize streaming content for qwen models
            const sanitizedContent = this.sanitizeJsonContent(delta.content);

            if (this.isUsingQwen()) {
              // Handle Qwen whitespace buffering inline for yielding
              // This is needed because we yield during streaming
              // We'll refactor this separately if needed
              const whitespaceResult = this.handleQwenStreamingWhitespace(
                { ...delta, content: sanitizedContent },
                processedData.pendingWhitespace,
                processedData.fullContent,
              );

              if (whitespaceResult.shouldYield) {
                // Deep copy before yielding to prevent immutable object errors
                yield this.deepCopy({
                  role: ContentGeneratorRole.ASSISTANT,
                  content: whitespaceResult.content,
                });
              }

              // Update our tracking of processed data
              processedData = {
                fullContent: whitespaceResult.updatedFullContent,
                accumulatedToolCalls: processedData.accumulatedToolCalls,
                hasStreamedContent:
                  processedData.hasStreamedContent ||
                  whitespaceResult.shouldYield,
                usageData: processedData.usageData,
                pendingWhitespace: whitespaceResult.updatedPendingWhitespace,
              };
            } else {
              // Deep copy before yielding to prevent immutable object errors
              yield this.deepCopy({
                role: ContentGeneratorRole.ASSISTANT,
                content: sanitizedContent,
              });
              processedData = {
                fullContent: processedData.fullContent + sanitizedContent,
                accumulatedToolCalls: processedData.accumulatedToolCalls,
                hasStreamedContent: true,
                usageData: processedData.usageData,
                pendingWhitespace: null,
              };
            }
          } else if (delta?.content) {
            // Parser mode - just accumulate, also sanitize
            const sanitizedContent = this.sanitizeJsonContent(delta.content);
            processedData = {
              fullContent: processedData.fullContent + sanitizedContent,
              accumulatedToolCalls: processedData.accumulatedToolCalls,
              hasStreamedContent: processedData.hasStreamedContent,
              usageData: processedData.usageData,
              pendingWhitespace: processedData.pendingWhitespace,
            };
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            // Deep copy tool calls before modifying to avoid immutable object errors
            const copiedToolCalls = this.deepCopy(delta.tool_calls);
            const accumulated: NonNullable<IMessage['tool_calls']> =
              this.deepCopy(processedData.accumulatedToolCalls);
            for (const toolCall of copiedToolCalls) {
              this.toolFormatter.accumulateStreamingToolCall(
                toolCall,
                accumulated,
                requestConfig.currentToolFormat,
              );
            }
            processedData = {
              ...processedData,
              accumulatedToolCalls: accumulated,
            };
          }

          // Check for usage data
          if (chunkCopy.usage) {
            processedData = {
              ...processedData,
              usageData: {
                prompt_tokens: chunkCopy.usage.prompt_tokens || 0,
                completion_tokens: chunkCopy.usage.completion_tokens || 0,
                total_tokens: chunkCopy.usage.total_tokens || 0,
              },
            };
          }
        }
      } catch (error) {
        // Handle JSONResponse error during streaming
        if (
          error &&
          String(error).includes('JSONResponse') &&
          this.isUsingQwen()
        ) {
          this.logger.debug(
            () =>
              '[Qwen] WARNING: JSONResponse error during streaming, attempting recovery',
          );

          // If we've already processed some data, yield what we have
          if (
            processedData.fullContent ||
            processedData.accumulatedToolCalls.length > 0
          ) {
            yield* this.processFinalResponse(
              processedData,
              requestConfig.parser,
            );
          } else {
            // No data processed, throw the error
            throw error;
          }
        } else {
          throw error;
        }
      }
    } else {
      // Non-streaming response
      processedData = this.processNonStreamingResponse(
        response as OpenAI.Chat.Completions.ChatCompletion,
      );

      // For non-streaming, yield content if no parser
      if (!requestConfig.parser && processedData.fullContent) {
        // Deep copy before yielding to prevent immutable object errors
        yield this.deepCopy({
          role: ContentGeneratorRole.ASSISTANT,
          content: processedData.fullContent,
        });
        processedData.hasStreamedContent = true;
      }
    }

    // 5. Flush pending whitespace if needed (for Qwen)
    if (
      processedData.pendingWhitespace &&
      this.isUsingQwen() &&
      !requestConfig.parser
    ) {
      this.logger.debug(
        () =>
          `Flushing trailing pending whitespace (len=${processedData.pendingWhitespace?.length ?? 0}) at stream end`,
      );
      // Deep copy before yielding to prevent immutable object errors
      yield this.deepCopy({
        role: ContentGeneratorRole.ASSISTANT,
        content: processedData.pendingWhitespace,
      });
      processedData.hasStreamedContent = true;
      processedData.fullContent += processedData.pendingWhitespace;
      processedData.pendingWhitespace = null;
    }

    // 6. Process and yield final results
    yield* this.processFinalResponse(processedData, requestConfig.parser);
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
   * Sanitize content that may contain control characters breaking JSON parsing
   * This is especially needed for qwen models that may return unescaped control chars
   */
  private sanitizeJsonContent(content: string): string {
    // Only apply sanitization for qwen models
    if (!this.isUsingQwen()) {
      return content;
    }

    // Check if content looks like it might be JSON (starts with { or [, contains quotes)
    const looksLikeJson =
      /^\s*[{[].*[\]}]\s*$/s.test(content) || /"[^"]*":\s*/.test(content);

    if (!looksLikeJson) {
      return content;
    }

    // Check for control characters that need sanitization
    let needsSanitization = false;
    for (let i = 0; i < content.length; i++) {
      const code = content.charCodeAt(i);
      if (
        (code >= 0x00 && code <= 0x08) ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      ) {
        needsSanitization = true;
        break;
      }
    }

    if (!needsSanitization) {
      return content;
    }

    this.logger.debug(
      () => '[Qwen] Sanitizing control characters in JSON content',
    );

    // Sanitize control characters while preserving valid JSON escape sequences
    const placeholder = '\uFFFD';

    // First protect existing valid escape sequences
    const protectedContent = content
      .replace(/\\n/g, `${placeholder}n`)
      .replace(/\\r/g, `${placeholder}r`)
      .replace(/\\t/g, `${placeholder}t`)
      .replace(/\\"/g, `${placeholder}"`)
      .replace(/\\\\/g, `${placeholder}\\`);

    // Replace actual control characters
    let sanitized = '';
    for (let i = 0; i < protectedContent.length; i++) {
      const char = protectedContent[i];
      const code = char.charCodeAt(0);

      if (char === '\n') {
        sanitized += '\\n';
      } else if (char === '\r') {
        sanitized += '\\r';
      } else if (char === '\t') {
        sanitized += '\\t';
      } else if (
        (code >= 0x00 && code <= 0x08) ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      ) {
        // Skip other control characters
        continue;
      } else {
        sanitized += char;
      }
    }

    // Restore protected escape sequences
    return sanitized
      .replace(new RegExp(`${placeholder}n`, 'g'), '\\n')
      .replace(new RegExp(`${placeholder}r`, 'g'), '\\r')
      .replace(new RegExp(`${placeholder}t`, 'g'), '\\t')
      .replace(new RegExp(`${placeholder}"`, 'g'), '\\"')
      .replace(new RegExp(`${placeholder}\\\\`, 'g'), '\\\\');
  }

  /**
   * Deep copy utility to prevent modifying immutable objects
   * Creates a proper deep copy of any JSON-serializable object
   */
  private deepCopy<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Handle primitive types
    if (typeof obj !== 'object') {
      return obj;
    }

    // Create deep copy via JSON serialization
    // This ensures complete isolation from original object
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      this.logger.debug(
        () => `Failed to deep copy object: ${error}. Returning original.`,
      );
      return obj;
    }
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
   * Get appropriate tool_choice value based on detected tool format
   * @param tools Array of tools (if any)
   * @returns Appropriate tool_choice value for the current format
   */
  private getToolChoiceForFormat(
    tools: ITool[] | undefined,
  ): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    // For all formats, use 'auto' (standard behavior)
    // Future enhancement: different formats may need different tool_choice values
    return 'auto';
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
   * Validate authentication and message preconditions for API calls
   */
  private async validateRequestPreconditions(
    messages: IMessage[],
  ): Promise<void> {
    // Check if API key is available (using resolved authentication)
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      const endpoint = this.baseURL || 'https://api.openai.com/v1';
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(generateOAuthEndpointMismatchError(endpoint, 'qwen'));
      }
      throw new Error('OpenAI API key is required to generate completions');
    }

    // Validate tool messages have required tool_call_id
    const toolMessages = messages.filter((msg) => msg.role === 'tool');
    const missingIds = toolMessages.filter((msg) => !msg.tool_call_id);

    if (missingIds.length > 0) {
      this.logger.error(
        () =>
          `FATAL: Tool messages missing tool_call_id: ${JSON.stringify(missingIds)}`,
      );
      throw new Error(
        `OpenAI API requires tool_call_id for all tool messages. Found ${missingIds.length} tool message(s) without IDs.`,
      );
    }
  }

  /**
   * Prepare API request configuration
   */
  private prepareApiRequest(
    messages: IMessage[],
    tools?: ITool[],
  ): {
    parser: GemmaToolCallParser | null;
    currentToolFormat: ToolFormat;
    formattedTools: unknown;
    finalStreamOptions: unknown;
    streamingEnabled: boolean;
  } {
    const parser = this.requiresTextToolCallParsing()
      ? new GemmaToolCallParser()
      : null;

    // Get current tool format (with override support)
    const currentToolFormat = this.getToolFormat();

    // Format tools using formatToolsForAPI method
    // Deep copy tools before formatting to prevent modifications to original
    const formattedTools = tools
      ? this.formatToolsForAPI(this.deepCopy(tools))
      : undefined;

    // Get stream_options from ephemeral settings (not model params)
    const streamOptions =
      this.providerConfig?.getEphemeralSettings?.()?.['stream-options'];

    // Default stream_options to { include_usage: true } unless explicitly set
    const finalStreamOptions =
      streamOptions !== undefined ? streamOptions : { include_usage: true };

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    return {
      parser,
      currentToolFormat,
      formattedTools,
      finalStreamOptions,
      streamingEnabled,
    };
  }

  /**
   * Execute API call with error handling
   */
  private async executeApiCall(
    messages: IMessage[],
    tools: ITool[] | undefined,
    requestConfig: {
      formattedTools: unknown;
      finalStreamOptions: unknown;
      streamingEnabled: boolean;
    },
  ): Promise<unknown> {
    // Get resolved authentication and update client if needed
    await this.updateClientWithResolvedAuth();

    this.logger.debug(
      () =>
        `About to make API call with model: ${this.currentModel}, baseURL: ${this.openai.baseURL}, apiKey: ${this.openai.apiKey?.substring(0, 10)}..., streaming: ${requestConfig.streamingEnabled}, messages (${messages.length} total): ${messages
          .map(
            (m) =>
              `${m.role}${m.role === 'system' ? ` (length: ${m.content?.length})` : ''}`,
          )
          .join(', ')}`,
    );

    try {
      // Log the formatted tools to debug the issue
      if (requestConfig.formattedTools) {
        this.logger.debug(
          () =>
            `Formatted tools being sent to API: ${JSON.stringify(requestConfig.formattedTools, null, 2)}`,
        );
      }

      // Build request params with exact order from original
      const apiParams = {
        model: this.currentModel,
        messages:
          messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        stream: requestConfig.streamingEnabled,
        ...(requestConfig.streamingEnabled && requestConfig.finalStreamOptions
          ? { stream_options: requestConfig.finalStreamOptions }
          : {}),
        tools: requestConfig.formattedTools as
          | OpenAI.Chat.Completions.ChatCompletionTool[]
          | undefined,
        tool_choice: this.getToolChoiceForFormat(tools),
        ...this.modelParams,
      };

      // For qwen models, we may need to handle the response differently
      // as they sometimes return immutable JSONResponse objects
      if (this.isUsingQwen() && requestConfig.streamingEnabled) {
        try {
          const response = await this.openai.chat.completions.create(apiParams);

          // If we get a JSONResponse object, we need to handle it specially
          // This is a workaround for qwen models that return Python JSONResponse objects
          // Check if response has asyncIterator using 'in' operator
          if (
            response &&
            typeof response === 'object' &&
            !(Symbol.asyncIterator in response)
          ) {
            this.logger.debug(
              () =>
                '[Qwen] Received non-iterable response, attempting to convert',
            );

            // Try to convert the response to an async iterable
            // This is a workaround for the JSONResponse immutability issue
            const chunks = Array.isArray(response) ? response : [response];
            return {
              async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                  yield chunk;
                }
              },
            } as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
          }

          return response;
        } catch (error) {
          // If the error is about JSONResponse, try a non-streaming fallback
          if (error && String(error).includes('JSONResponse')) {
            this.logger.debug(
              () =>
                '[Qwen] WARNING: JSONResponse error detected, falling back to non-streaming mode',
            );

            // Retry without streaming
            const nonStreamParams = {
              ...apiParams,
              stream: false,
              stream_options: undefined,
            };

            const response =
              await this.openai.chat.completions.create(nonStreamParams);

            // Convert non-streaming response to streaming format
            return {
              async *[Symbol.asyncIterator]() {
                // Yield the response as a single chunk
                yield response;
              },
            };
          }
          throw error;
        }
      }

      return await this.openai.chat.completions.create(apiParams);
    } catch (error) {
      this.handleApiError(error, messages);
      throw error; // Re-throw after logging
    }
  }

  /**
   * Handle and log API errors
   */
  private handleApiError(error: unknown, messages: IMessage[]): void {
    const errorStatus =
      (error as { status?: number })?.status ||
      (error as { response?: { status?: number } })?.response?.status;
    const errorLabel = errorStatus === 400 ? '[API Error 400]' : '[API Error]';

    this.logger.error(
      () =>
        `${errorLabel} Error caught in API call:\n` +
        `  Error: ${error}\n` +
        `  Type: ${(error as Error)?.constructor?.name}\n` +
        `  Status: ${errorStatus}\n` +
        `  Response data: ${JSON.stringify((error as { response?: { data?: unknown } })?.response?.data, null, 2)}`,
    );

    // Log the last few messages to understand what's being sent
    if (errorStatus === 400) {
      // Log additional diagnostics for 400 errors
      const hasPendingToolCalls = messages.some((msg, idx) => {
        if (msg.role === 'assistant' && msg.tool_calls) {
          // Check if there's a matching tool response
          const toolCallIds = msg.tool_calls.map((tc) => tc.id);
          const hasResponses = toolCallIds.every((id) =>
            messages
              .slice(idx + 1)
              .some((m) => m.role === 'tool' && m.tool_call_id === id),
          );
          return !hasResponses;
        }
        return false;
      });

      this.logger.error(
        () =>
          `${errorLabel} Last 5 messages being sent:\n` +
          `  Has pending tool calls without responses: ${hasPendingToolCalls}`,
      );
      const lastMessages = messages.slice(-5);
      lastMessages.forEach((msg, idx) => {
        this.logger.error(
          () =>
            `  [${messages.length - 5 + idx}] ${msg.role}${msg.tool_call_id ? ` (tool response for ${msg.tool_call_id})` : ''}${msg.tool_calls ? ` (${msg.tool_calls.length} tool calls)` : ''}`,
        );
        if (msg.tool_calls) {
          msg.tool_calls.forEach((tc) => {
            this.logger.error(
              () => `    - Tool call: ${tc.id} -> ${tc.function.name}`,
            );
          });
        }
      });
    }
  }

  /**
   * Process non-streaming response
   */
  private processNonStreamingResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): {
    fullContent: string;
    accumulatedToolCalls: NonNullable<IMessage['tool_calls']>;
    hasStreamedContent: boolean;
    usageData?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    pendingWhitespace: string | null;
  } {
    // Deep copy the response to avoid any immutable object errors
    // This is especially important for qwen models which may return immutable JSONResponse objects
    const responseCopy = this.deepCopy(response);
    const choice = responseCopy.choices[0];
    let fullContent = '';
    const accumulatedToolCalls: NonNullable<IMessage['tool_calls']> = [];
    let usageData:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | undefined;

    if (choice?.message.content) {
      // Sanitize content for qwen models that may have control characters
      fullContent = this.sanitizeJsonContent(choice.message.content);
    }

    if (choice?.message.tool_calls) {
      // Tool calls are already from the copied response, no need to deep copy again
      // Convert tool calls to the standard format
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type === 'function' && toolCall.function) {
          // Don't fix double stringification here - it's handled later in the final processing
          accumulatedToolCalls.push({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          });
        }
      }
    }

    if (responseCopy.usage) {
      usageData = {
        prompt_tokens: responseCopy.usage.prompt_tokens,
        completion_tokens: responseCopy.usage.completion_tokens,
        total_tokens: responseCopy.usage.total_tokens,
      };
    }

    return {
      fullContent,
      accumulatedToolCalls,
      hasStreamedContent: false, // Non-streaming never has streamed content
      usageData,
      pendingWhitespace: null,
    };
  }

  /**
   * Process and build final response messages
   */
  private *processFinalResponse(
    processedData: {
      fullContent: string;
      accumulatedToolCalls: NonNullable<IMessage['tool_calls']>;
      hasStreamedContent: boolean;
      usageData?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      pendingWhitespace: string | null;
    },
    parser: GemmaToolCallParser | null,
  ): Generator<IMessage> {
    const {
      fullContent,
      accumulatedToolCalls,
      hasStreamedContent,
      usageData,
      pendingWhitespace,
    } = processedData;

    // Flush any remaining pending whitespace for Qwen
    let finalFullContent = fullContent;
    if (pendingWhitespace && this.isUsingQwen() && !parser) {
      this.logger.debug(
        () =>
          `Flushing trailing pending whitespace (len=${pendingWhitespace?.length ?? 0}) at stream end`,
      );
      finalFullContent += pendingWhitespace;
    }

    // After stream ends, parse text-based tool calls if needed
    if (parser && finalFullContent) {
      const { cleanedContent, toolCalls } = parser.parse(finalFullContent);

      if (toolCalls.length > 0) {
        // Convert to standard format
        const standardToolCalls = toolCalls.map((tc, index) => ({
          id: `call_${Date.now()}_${index}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));

        // Deep copy before emitting to prevent modifications to immutable objects
        yield this.deepCopy({
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          tool_calls: standardToolCalls,
          usage: usageData,
        });
      } else {
        // No tool calls found, yield cleaned content
        // Deep copy before emitting to prevent modifications to immutable objects
        yield this.deepCopy({
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          usage: usageData,
        });
      }
    } else {
      // Standard OpenAI tool call handling
      if (accumulatedToolCalls.length > 0) {
        // Deep copy tool calls before processing to avoid modifying immutables
        const copiedToolCalls = this.deepCopy(accumulatedToolCalls);
        // Process tool calls with Qwen-specific fixes if needed
        const fixedToolCalls = this.processQwenToolCalls(copiedToolCalls);

        if (this.isUsingQwen()) {
          this.logger.debug(
            () =>
              `Final message with tool calls: ${JSON.stringify({
                contentLength: finalFullContent.length,
                content:
                  finalFullContent.substring(0, 200) +
                  (finalFullContent.length > 200 ? '...' : ''),
                toolCallCount: accumulatedToolCalls.length,
                hasStreamedContent,
              })}`,
          );
        }

        // Build the final message based on provider-specific requirements
        const finalMessage = this.buildFinalToolCallMessage(
          hasStreamedContent,
          finalFullContent,
          fixedToolCalls,
          usageData,
        );
        // Deep copy before yielding to prevent immutable object errors
        yield this.deepCopy(finalMessage);
      } else if (usageData) {
        // Always emit usage data so downstream consumers can update stats
        // Deep copy before emitting to prevent modifications to immutable objects
        yield this.deepCopy({
          role: ContentGeneratorRole.ASSISTANT,
          content: '',
          usage: usageData,
        });
      }
    }
  }

  /**
   * Handle Qwen-specific whitespace buffering during streaming
   * @param delta The stream delta containing content
   * @param pendingWhitespace Current buffered whitespace
   * @param fullContent Accumulated full content
   * @returns Object with updated state and whether to yield content
   */
  private handleQwenStreamingWhitespace(
    delta: { content?: string | null },
    pendingWhitespace: string | null,
    fullContent: string,
  ): {
    shouldYield: boolean;
    content: string;
    updatedPendingWhitespace: string | null;
    updatedFullContent: string;
  } {
    if (!delta.content) {
      return {
        shouldYield: false,
        content: '',
        updatedPendingWhitespace: pendingWhitespace,
        updatedFullContent: fullContent,
      };
    }

    const isWhitespaceOnly = delta.content.trim() === '';

    if (isWhitespaceOnly) {
      // Buffer whitespace-only chunk
      const newPendingWhitespace = (pendingWhitespace || '') + delta.content;
      this.logger.debug(
        () =>
          `[Whitespace Buffering] Buffered whitespace-only chunk (len=${delta.content?.length ?? 0}). pendingWhitespace now len=${newPendingWhitespace?.length ?? 0}`,
      );
      return {
        shouldYield: false,
        content: '',
        updatedPendingWhitespace: newPendingWhitespace,
        updatedFullContent: fullContent + delta.content,
      };
    }

    // Non-whitespace content - flush any pending whitespace first
    if (pendingWhitespace) {
      this.logger.debug(
        () =>
          `Flushing pending whitespace (len=${pendingWhitespace?.length ?? 0}) before non-empty chunk`,
      );
      return {
        shouldYield: true,
        content: pendingWhitespace + delta.content,
        updatedPendingWhitespace: null,
        updatedFullContent: fullContent + pendingWhitespace + delta.content,
      };
    }

    return {
      shouldYield: true,
      content: delta.content,
      updatedPendingWhitespace: null,
      updatedFullContent: fullContent + delta.content,
    };
  }

  /**
   * Process tool calls for Qwen models, fixing double stringification
   * @param toolCalls The tool calls to process
   * @returns Processed tool calls with fixes applied
   */
  private processQwenToolCalls(
    toolCalls: NonNullable<IMessage['tool_calls']>,
  ): NonNullable<IMessage['tool_calls']> {
    if (!this.isUsingQwen()) {
      return toolCalls;
    }

    this.logger.debug(
      () =>
        `[Qwen Fix] Processing ${toolCalls.length} tool calls for double-stringification fix`,
    );

    return toolCalls.map((toolCall, index) => {
      this.logger.debug(
        () =>
          `[Qwen Fix] Tool call ${index}: ${JSON.stringify({
            name: toolCall.function.name,
            argumentsType: typeof toolCall.function.arguments,
            argumentsLength: toolCall.function.arguments?.length,
            argumentsSample: toolCall.function.arguments?.substring(0, 100),
          })}`,
      );
      return this.fixQwenDoubleStringification(toolCall);
    });
  }

  /**
   * Determine how to yield the final message with tool calls based on provider quirks
   * @param hasStreamedContent Whether content was already streamed
   * @param fullContent The complete content
   * @param toolCalls The tool calls to include
   * @param usageData Optional usage statistics
   * @returns The message to yield
   */
  private buildFinalToolCallMessage(
    hasStreamedContent: boolean,
    fullContent: string,
    toolCalls: NonNullable<IMessage['tool_calls']>,
    usageData?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
  ): IMessage {
    const isCerebras = this.baseURL?.toLowerCase().includes('cerebras.ai');

    if (isCerebras) {
      this.logger.debug(
        () =>
          '[Cerebras] Special handling for Cerebras provider after tool responses',
        {
          hasStreamedContent,
          willSendSpace: hasStreamedContent,
        },
      );
    }

    const shouldOmitContent =
      hasStreamedContent && this.isUsingQwen() && !isCerebras;

    this.logger.debug(
      () => '[Tool Call Handling] Deciding how to yield tool calls',
      {
        hasStreamedContent,
        isUsingQwen: this.isUsingQwen(),
        isCerebras,
        shouldOmitContent,
        fullContentLength: fullContent.length,
        toolCallCount: toolCalls?.length || 0,
      },
    );

    if (shouldOmitContent || (isCerebras && hasStreamedContent)) {
      // Send just a space to prevent stream stopping or duplication
      if (isCerebras && hasStreamedContent) {
        this.logger.debug(
          () =>
            '[Cerebras] Sending minimal space content to prevent duplication',
        );
      }
      return {
        role: ContentGeneratorRole.ASSISTANT,
        content: ' ',
        tool_calls: toolCalls,
        usage: usageData,
      };
    }

    // Include full content with tool calls
    return {
      role: ContentGeneratorRole.ASSISTANT,
      content: fullContent || '',
      tool_calls: toolCalls,
      usage: usageData,
    };
  }

  /**
   * Fix Qwen's double stringification of tool call arguments
   * Qwen models stringify array/object values WITHIN the JSON arguments
   * @param toolCall The tool call to fix
   * @returns The fixed tool call or the original if no fix is needed
   */
  private fixQwenDoubleStringification(
    toolCall: NonNullable<IMessage['tool_calls']>[0],
  ): NonNullable<IMessage['tool_calls']>[0] {
    if (
      !toolCall.function.arguments ||
      typeof toolCall.function.arguments !== 'string'
    ) {
      return toolCall;
    }

    try {
      // First, parse the arguments to get the JSON object
      const parsedArgs = JSON.parse(toolCall.function.arguments);
      let hasNestedStringification = false;

      // Check each property to see if it's a stringified array/object/number
      const fixedArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsedArgs)) {
        if (typeof value === 'string') {
          const trimmed = value.trim();

          // Check if it's a stringified number (integer or float)
          if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const numValue = trimmed.includes('.')
              ? parseFloat(trimmed)
              : parseInt(trimmed, 10);
            fixedArgs[key] = numValue;
            hasNestedStringification = true;
            this.logger.debug(
              () =>
                `[Qwen Fix] Fixed stringified number in property '${key}' for ${toolCall.function.name}: "${value}" -> ${numValue}`,
            );
          }
          // Check if it looks like a stringified array or object
          // Also check for Python-style dictionaries with single quotes
          else if (
            (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'))
          ) {
            try {
              // Try to parse it as JSON
              const nestedParsed = JSON.parse(value);
              fixedArgs[key] = nestedParsed;
              hasNestedStringification = true;
              this.logger.debug(
                () =>
                  `[Qwen Fix] Fixed nested stringification in property '${key}' for ${toolCall.function.name}`,
              );
            } catch {
              // Try to convert Python-style to JSON (single quotes to double quotes)
              try {
                const jsonified = value
                  .replace(/'/g, '"')
                  .replace(/: True/g, ': true')
                  .replace(/: False/g, ': false')
                  .replace(/: None/g, ': null');
                const nestedParsed = JSON.parse(jsonified);
                fixedArgs[key] = nestedParsed;
                hasNestedStringification = true;
                this.logger.debug(
                  () =>
                    `[Qwen Fix] Fixed Python-style nested stringification in property '${key}' for ${toolCall.function.name}`,
                );
              } catch {
                // Not valid JSON even after conversion, keep as string
                fixedArgs[key] = value;
              }
            }
          } else {
            fixedArgs[key] = value;
          }
        } else {
          fixedArgs[key] = value;
        }
      }

      if (hasNestedStringification) {
        this.logger.debug(
          () =>
            `[Qwen Fix] Fixed nested double-stringification for ${toolCall.function.name}`,
        );
        return {
          ...toolCall,
          function: {
            ...toolCall.function,
            arguments: JSON.stringify(fixedArgs),
          },
        };
      }
    } catch (_e) {
      // If parsing fails, check for old-style double-stringification
      if (
        toolCall.function.arguments.startsWith('"') &&
        toolCall.function.arguments.endsWith('"')
      ) {
        try {
          // Old fix: entire arguments were double-stringified
          const parsedArgs = JSON.parse(toolCall.function.arguments);
          this.logger.debug(
            () =>
              `[Qwen Fix] Fixed whole-argument double-stringification for ${toolCall.function.name}`,
          );
          return {
            ...toolCall,
            function: {
              ...toolCall.function,
              arguments: JSON.stringify(parsedArgs),
            },
          };
        } catch {
          // Leave as-is if we can't parse
        }
      }
    }

    // No fix needed
    this.logger.debug(
      () =>
        `[Qwen Fix] No double-stringification detected for ${toolCall.function.name}, keeping original`,
    );
    return toolCall;
  }
}
