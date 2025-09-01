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
 * OpenAI Responses API Provider
 * This provider exclusively uses the OpenAI /responses endpoint
 * for models that support it (o1, o3, etc.)
 */
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from '../openai/RESPONSES_API_MODELS.js';
import { ConversationCache } from '../openai/ConversationCache.js';
import {
  estimateMessagesTokens,
  estimateRemoteTokens,
} from '../openai/estimateRemoteTokens.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from '../openai/parseResponsesStream.js';
import { buildResponsesRequest } from '../openai/buildResponsesRequest.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

export class OpenAIResponsesProvider extends BaseProvider {
  private logger: DebugLogger;
  private currentModel: string = 'o3-mini';
  private baseURL: string;
  private toolFormatter: ToolFormatter;
  private conversationCache: ConversationCache;
  private modelParams?: Record<string, unknown>;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    _config?: IProviderConfig,
  ) {
    const baseConfig: BaseProviderConfig = {
      name: 'openai-responses',
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1',
      envKeyNames: ['OPENAI_API_KEY'],
      isOAuthEnabled: false,
      oauthProvider: undefined,
      oauthManager: undefined,
    };

    super(baseConfig);

    this.logger = new DebugLogger('llxprt:providers:openai-responses');
    this.logger.debug(
      () =>
        `Constructor - baseURL: ${baseURL || 'https://api.openai.com/v1'}, apiKey: ${apiKey?.substring(0, 10) || 'none'}`,
    );
    this.baseURL = baseURL || 'https://api.openai.com/v1';
    this.toolFormatter = new ToolFormatter();
    this.conversationCache = new ConversationCache();

    // Initialize from SettingsService
    this.initializeFromSettings().catch((error) => {
      this.logger.debug(
        () => `Failed to initialize from SettingsService: ${error}`,
      );
    });

    // Set default model for responses API
    if (
      process.env.LLXPRT_DEFAULT_MODEL &&
      RESPONSES_API_MODELS.some((m) =>
        process.env.LLXPRT_DEFAULT_MODEL!.startsWith(m),
      )
    ) {
      this.currentModel = process.env.LLXPRT_DEFAULT_MODEL;
    }
  }

  /**
   * This provider does not support OAuth
   */
  protected supportsOAuth(): boolean {
    return false;
  }

  override getToolFormat(): ToolFormat {
    // Always use OpenAI format for responses API
    return 'openai';
  }

  private async callResponsesEndpoint(
    messages: IMessage[],
    tools?: ITool[],
    options?: {
      stream?: boolean;
      conversationId?: string;
      parentId?: string;
      tool_choice?: string | object;
      stateful?: boolean;
    },
  ): Promise<AsyncIterableIterator<IMessage>> {
    // Check if API key is available (using resolved authentication)
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      throw new Error('OpenAI API key is required to make API calls');
    }

    // Check context usage and warn if getting close to limit
    if (options?.conversationId && options?.parentId) {
      const contextInfo = this.estimateContextUsage(
        options.conversationId,
        options.parentId,
        messages,
      );

      // Warn if less than 4k tokens remaining
      if (contextInfo.tokensRemaining < 4000) {
        this.logger.debug(
          () =>
            `Warning: Only ${contextInfo.tokensRemaining} tokens remaining (${contextInfo.contextUsedPercent.toFixed(1)}% context used). Consider starting a new conversation.`,
        );
      }
    }

    // Check cache for existing conversation
    if (options?.conversationId && options?.parentId) {
      const cachedMessages = this.conversationCache.get(
        options.conversationId,
        options.parentId,
      );
      if (cachedMessages) {
        // Return cached messages as an async iterable
        return (async function* () {
          for (const message of cachedMessages) {
            yield message;
          }
        })();
      }
    }

    // Format tools for Responses API
    const formattedTools = tools
      ? this.toolFormatter.toResponsesTool(tools)
      : undefined;

    // Patch messages to include synthetic responses for cancelled tools
    const { SyntheticToolResponseHandler } = await import(
      '../openai/syntheticToolResponses.js'
    );
    const patchedMessages =
      SyntheticToolResponseHandler.patchMessageHistory(messages);

    // Build the request
    const request = buildResponsesRequest({
      model: this.currentModel,
      messages: patchedMessages,
      tools: formattedTools,
      stream: options?.stream ?? true,
      conversationId: options?.conversationId,
      parentId: options?.parentId,
      tool_choice: options?.tool_choice,
      ...(this.modelParams || {}),
    });

    // Make the API call
    const responsesURL = `${this.baseURL}/responses`;

    // Ensure proper UTF-8 encoding for the request body
    const requestBody = JSON.stringify(request);
    const bodyBlob = new Blob([requestBody], {
      type: 'application/json; charset=utf-8',
    });

    const response = await fetch(responsesURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: bodyBlob,
    });

    // Handle errors
    if (!response.ok) {
      const errorBody = await response.text();

      // Handle 422 context_length_exceeded error
      if (
        response.status === 422 &&
        errorBody.includes('context_length_exceeded')
      ) {
        this.logger.debug(
          () =>
            'Context length exceeded, invalidating cache and retrying stateless...',
        );

        // Invalidate the cache for this conversation
        if (options?.conversationId && options?.parentId) {
          this.conversationCache.invalidate(
            options.conversationId,
            options.parentId,
          );
        }

        // Retry without conversation context (pure stateless)
        const retryRequest = buildResponsesRequest({
          model: this.currentModel,
          messages,
          tools: formattedTools,
          stream: options?.stream ?? true,
          // Omit conversationId and parentId for stateless retry
          tool_choice: options?.tool_choice,
          ...(this.modelParams || {}),
        });

        const retryRequestBody = JSON.stringify(retryRequest);
        const retryBodyBlob = new Blob([retryRequestBody], {
          type: 'application/json; charset=utf-8',
        });

        const retryResponse = await fetch(responsesURL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: retryBodyBlob,
        });

        if (!retryResponse.ok) {
          const retryErrorBody = await retryResponse.text();
          throw parseErrorResponse(
            retryResponse.status,
            retryErrorBody,
            this.name,
          );
        }

        // Use the retry response
        return this.handleResponsesApiResponse(
          retryResponse,
          messages,
          undefined, // No conversation context on retry
          undefined,
          options?.stream !== false,
        );
      }

      throw parseErrorResponse(response.status, errorBody, this.name);
    }

    // Handle the response
    return this.handleResponsesApiResponse(
      response,
      messages,
      options?.conversationId,
      options?.parentId,
      options?.stream !== false,
    );
  }

  private async handleResponsesApiResponse(
    response: Response,
    messages: IMessage[],
    conversationId: string | undefined,
    parentId: string | undefined,
    isStreaming: boolean,
  ): Promise<AsyncIterableIterator<IMessage>> {
    // Handle streaming response
    if (isStreaming && response.body) {
      const collectedMessages: IMessage[] = [];
      const cache = this.conversationCache;

      return (async function* () {
        for await (const message of parseResponsesStream(response.body!)) {
          // Collect messages for caching
          if (message.content || message.tool_calls) {
            collectedMessages.push(message);
          } else if (message.usage && collectedMessages.length === 0) {
            // If we only got a usage message with no content, add a placeholder
            collectedMessages.push({
              role: ContentGeneratorRole.ASSISTANT,
              content: '',
            });
          }

          yield message;
        }

        // Cache the collected messages with token count
        if (conversationId && parentId && collectedMessages.length > 0) {
          // Get previous accumulated tokens
          const previousTokens = cache.getAccumulatedTokens(
            conversationId,
            parentId,
          );

          // Calculate tokens for this request (messages + response)
          const requestTokens = estimateMessagesTokens(messages);
          const responseTokens = estimateMessagesTokens(collectedMessages);
          const totalTokensForRequest = requestTokens + responseTokens;

          // Update cache with new accumulated total
          cache.set(
            conversationId,
            parentId,
            collectedMessages,
            previousTokens + totalTokensForRequest,
          );
        }
      })();
    }

    // Handle non-streaming response
    interface OpenAIResponse {
      choices?: Array<{
        message: {
          role: string;
          content?: string;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }

    const data = (await response.json()) as OpenAIResponse;
    const resultMessages: IMessage[] = [];

    if (data.choices && data.choices.length > 0) {
      const choice = data.choices[0];
      const message: IMessage = {
        role: choice.message.role as ContentGeneratorRole,
        content: choice.message.content || '',
      };

      if (choice.message.tool_calls) {
        message.tool_calls = choice.message.tool_calls;
      }

      if (data.usage) {
        message.usage = {
          prompt_tokens: data.usage.prompt_tokens || 0,
          completion_tokens: data.usage.completion_tokens || 0,
          total_tokens: data.usage.total_tokens || 0,
        };
      }

      resultMessages.push(message);
    }

    // Cache the result with token count
    if (conversationId && parentId && resultMessages.length > 0) {
      // Get previous accumulated tokens
      const previousTokens = this.conversationCache.getAccumulatedTokens(
        conversationId,
        parentId,
      );

      // Calculate tokens for this request
      const requestTokens = estimateMessagesTokens(messages);
      const responseTokens = estimateMessagesTokens(resultMessages);
      const totalTokensForRequest = requestTokens + responseTokens;

      // Update cache with new accumulated total
      this.conversationCache.set(
        conversationId,
        parentId,
        resultMessages,
        previousTokens + totalTokensForRequest,
      );
    }

    return (async function* () {
      for (const message of resultMessages) {
        yield message;
      }
    })();
  }

  override async getModels(): Promise<IModel[]> {
    // Return models that support the responses API
    return [
      {
        id: 'o1',
        name: 'o1',
        provider: 'openai-responses',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'o1-preview',
        name: 'o1-preview',
        provider: 'openai-responses',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'o1-mini',
        name: 'o1-mini',
        provider: 'openai-responses',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        provider: 'openai-responses',
        supportedToolFormats: ['openai'],
      },
    ];
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<IMessage> {
    // Check if API key is available
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      throw new Error('OpenAI API key is required to generate completions');
    }

    // Always use responses endpoint
    const conversationId = undefined;
    const parentId = undefined;

    yield* await this.callResponsesEndpoint(messages, tools, {
      stream: true,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stateful: false, // Always stateless for now
      conversationId,
      parentId,
    });
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
    // Return the default model for responses API
    return 'o3-mini';
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey?.(apiKey);

    // Persist to SettingsService if available
    this.setApiKeyInSettings(apiKey).catch((error) => {
      this.logger.debug(
        () => `Failed to persist API key to SettingsService: ${error}`,
      );
    });
  }

  override setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, use default
    this.baseURL =
      baseUrl && baseUrl.trim() !== '' ? baseUrl : 'https://api.openai.com/v1';

    // Persist to SettingsService if available
    this.setBaseUrlInSettings(this.baseURL).catch((error) => {
      this.logger.debug(
        () => `Failed to persist base URL to SettingsService: ${error}`,
      );
    });

    // Call base provider implementation
    super.setBaseUrl?.(baseUrl);
  }

  override setConfig(_config: IProviderConfig): void {
    // Config not used by this provider
  }

  override setToolFormatOverride(format: ToolFormat | null): void {
    // Responses API only supports OpenAI format
    if (format && format !== 'openai') {
      this.logger.debug(
        () =>
          `Warning: Responses API only supports OpenAI tool format, ignoring override to ${format}`,
      );
    }
  }

  /**
   * Estimates the remote context usage for the current conversation
   */
  estimateContextUsage(
    conversationId: string | undefined,
    parentId: string | undefined,
    promptMessages: IMessage[],
  ) {
    const promptTokens = estimateMessagesTokens(promptMessages);

    return estimateRemoteTokens(
      this.currentModel,
      this.conversationCache,
      conversationId,
      parentId,
      promptTokens,
    );
  }

  /**
   * Get the conversation cache instance
   */
  getConversationCache(): ConversationCache {
    return this.conversationCache;
  }

  /**
   * OpenAI Responses API always requires payment (API key)
   */
  override isPaidMode(): boolean {
    return true;
  }

  override clearState(): void {
    // Clear the conversation cache to prevent tool call ID mismatches
    this.conversationCache.clear();
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
    throw new Error('Server tools not supported by OpenAI Responses provider');
  }

  /**
   * Set model parameters to be included in API calls
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
      if (
        savedModel &&
        RESPONSES_API_MODELS.some((m) => savedModel.startsWith(m))
      ) {
        this.currentModel = savedModel;
      }

      // Load saved base URL if available
      const savedBaseUrl = await this.getBaseUrlFromSettings();
      if (savedBaseUrl !== undefined) {
        this.baseURL = savedBaseUrl || 'https://api.openai.com/v1';
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
          `Failed to initialize OpenAI Responses provider from SettingsService: ${error}`,
      );
    }
  }

  /**
   * Check if the provider is authenticated using any available method
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }
}
