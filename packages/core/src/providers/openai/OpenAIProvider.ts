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

import { IModel } from '../IModel.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import OpenAI from 'openai';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from './RESPONSES_API_MODELS.js';
import { ConversationCache } from './ConversationCache.js';
import {
  estimateMessagesTokens,
  estimateRemoteTokens,
} from './estimateRemoteTokens.js';
// ConversationContext removed - using inline conversation ID generation
import {
  parseResponsesStream,
  parseErrorResponse,
} from './parseResponsesStream.js';
import { buildResponsesRequest } from './buildResponsesRequest.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import {
  isQwenEndpoint,
  generateOAuthEndpointMismatchError,
} from '../../config/endpoints.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

export class OpenAIProvider extends BaseProvider {
  private openai: OpenAI;
  private currentModel: string =
    process.env.LLXPRT_DEFAULT_MODEL || 'llama3-70b-8192';
  private baseURL?: string;
  private providerConfig?: IProviderConfig;
  private toolFormatter: ToolFormatter;
  private toolFormatOverride?: ToolFormat;
  private conversationCache: ConversationCache;
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
    // Enable OAuth if: 1) we have an oauth manager, and 2) either the baseURL is a Qwen endpoint OR no baseURL/apiKey is provided
    const shouldEnableQwenOAuth =
      !!oauthManager &&
      (isQwenEndpoint(baseURL || '') ||
        (!baseURL && (!apiKey || apiKey === '')) ||
        baseURL === 'https://portal.qwen.ai/v1');

    if (process.env.DEBUG) {
      console.log(
        `[OpenAI Constructor] baseURL: ${baseURL}, apiKey: ${apiKey?.substring(0, 10) || 'none'}, oauthManager: ${!!oauthManager}, shouldEnableQwenOAuth: ${shouldEnableQwenOAuth}`,
      );
    }

    const baseConfig: BaseProviderConfig = {
      name: 'openai',
      apiKey,
      baseURL,
      cliKey: !apiKey || apiKey === '' ? undefined : apiKey, // Don't set cliKey if no API key to allow OAuth
      envKeyNames: ['OPENAI_API_KEY'],
      isOAuthEnabled: shouldEnableQwenOAuth,
      oauthProvider: shouldEnableQwenOAuth ? 'qwen' : undefined,
      oauthManager,
    };

    super(baseConfig);

    this.baseURL = baseURL;
    this.providerConfig = config;
    this.toolFormatter = new ToolFormatter();
    this.conversationCache = new ConversationCache();

    // Initialize from SettingsService
    this.initializeFromSettings().catch((error) => {
      if (process.env.DEBUG) {
        console.warn(
          'Failed to initialize OpenAI provider from SettingsService:',
          error,
        );
      }
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
   * Helper method to determine if we're using Cerebras
   */
  private isCerebras(): boolean {
    // Check if baseURL contains cerebras.ai
    if (this.baseURL?.toLowerCase().includes('cerebras.ai')) {
      return true;
    }
    // Check if model name contains cerebras
    if (this.currentModel?.toLowerCase().includes('cerebras')) {
      return true;
    }
    // Check for specific Cerebras model names that might be used
    const cerebrasModels = ['qwen-3-coder-480b'];
    return cerebrasModels.some(
      (model) =>
        this.currentModel?.toLowerCase() === model.toLowerCase() &&
        this.baseURL?.includes('cerebras'),
    );
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

    // Debug logging
    if (process.env.DEBUG) {
      console.log(
        `[OpenAI] updateClientWithResolvedAuth - OAuth enabled: ${this.isOAuthEnabled()}, OAuth provider: ${this.baseProviderConfig.oauthProvider}, baseURL: ${this.baseURL}, resolvedKey: ${resolvedKey?.substring(0, 10)}...`,
      );
    }

    if (
      this.isOAuthEnabled() &&
      this.baseProviderConfig.oauthProvider === 'qwen'
    ) {
      // Get the OAuth token to check for resource_url
      const oauthManager = this.baseProviderConfig.oauthManager;
      if (oauthManager?.getOAuthToken) {
        const oauthToken = await oauthManager.getOAuthToken('qwen');
        if (process.env.DEBUG) {
          console.log(
            `[OpenAI] OAuth token retrieved, resource_url: ${oauthToken?.resource_url}, access_token: ${oauthToken?.access_token?.substring(0, 10)}...`,
          );
        }
        if (oauthToken?.resource_url) {
          // Use the resource_url from the OAuth token
          effectiveBaseURL = `https://${oauthToken.resource_url}/v1`;
          if (process.env.DEBUG) {
            console.log(
              `[OpenAI] Using Qwen OAuth endpoint: ${effectiveBaseURL}`,
            );
          }
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

  private shouldUseResponses(model: string): boolean {
    // Check env flag override (highest priority)
    if (process.env.OPENAI_RESPONSES_DISABLE === 'true') {
      return false;
    }

    // Check settings override - if explicitly set to false, always respect that
    if (this.providerConfig?.openaiResponsesEnabled === false) {
      return false;
    }

    // Never use Responses API for non-OpenAI providers (those with custom base URLs)
    const baseURL = this.baseURL || 'https://api.openai.com/v1';
    if (baseURL !== 'https://api.openai.com/v1') {
      return false;
    }

    // Default: Check if model starts with any of the responses API model prefixes
    return RESPONSES_API_MODELS.some((responsesModel) =>
      model.startsWith(responsesModel),
    );
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
      const endpoint = this.baseURL || 'https://api.openai.com/v1';
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(generateOAuthEndpointMismatchError(endpoint, 'qwen'));
      }
      throw new Error('OpenAI API key is required to make API calls');
    }

    // Remove the stateful mode error to allow O3 to work with conversation IDs

    // Check context usage and warn if getting close to limit
    if (options?.conversationId && options?.parentId) {
      const contextInfo = this.estimateContextUsage(
        options.conversationId,
        options.parentId,
        messages,
      );

      // Warn if less than 4k tokens remaining
      if (contextInfo.tokensRemaining < 4000) {
        if (process.env.DEBUG) {
          console.warn(
            `[OpenAI] Warning: Only ${contextInfo.tokensRemaining} tokens remaining ` +
              `(${contextInfo.contextUsedPercent.toFixed(1)}% context used). ` +
              `Consider starting a new conversation.`,
          );
        }
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
      './syntheticToolResponses.js'
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
    });

    // Make the API call
    const baseURL = this.baseURL || 'https://api.openai.com/v1';
    const responsesURL = `${baseURL}/responses`;

    // Ensure proper UTF-8 encoding for the request body
    // This is crucial for handling multibyte characters (e.g., Japanese, Chinese)
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
        if (process.env.DEBUG) {
          console.warn(
            '[OpenAI] Context length exceeded, invalidating cache and retrying stateless...',
          );
        }

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
        });

        // Ensure proper UTF-8 encoding for retry request as well
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

          // Update the parentId in the context as soon as we get a message ID
          if (message.id) {
            // ConversationContext.setParentId(message.id);
            // TODO: Handle parent ID updates when ConversationContext is available
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

    // CEREBRAS FIX: Handle potential array response from Cerebras
    // If Cerebras returns an array of responses, aggregate them
    if (this.isCerebras() && Array.isArray(data)) {
      if (process.env.DEBUG) {
        console.log(
          '[OpenAIProvider/Cerebras] Detected array response, aggregating...',
        );
      }
      const aggregatedContent: string[] = [];
      let aggregatedToolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }> = [];
      let aggregatedUsage:
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          }
        | undefined = undefined;

      for (const item of data as OpenAIResponse[]) {
        if (item.choices?.[0]?.message?.content) {
          aggregatedContent.push(item.choices[0].message.content);
        }
        if (item.choices?.[0]?.message?.tool_calls) {
          aggregatedToolCalls = item.choices[0].message.tool_calls;
        }
        if (item.usage) {
          aggregatedUsage = item.usage;
        }
      }

      const message: IMessage = {
        role: ContentGeneratorRole.ASSISTANT,
        content: aggregatedContent.join(''),
      };

      if (aggregatedToolCalls.length > 0) {
        message.tool_calls = aggregatedToolCalls;
      }

      if (aggregatedUsage) {
        message.usage = {
          prompt_tokens: aggregatedUsage.prompt_tokens || 0,
          completion_tokens: aggregatedUsage.completion_tokens || 0,
          total_tokens: aggregatedUsage.total_tokens || 0,
        };
      }

      resultMessages.push(message);
      // Convert to async iterator for consistent return type
      return (async function* () {
        for (const msg of resultMessages) {
          yield msg;
        }
      })();
    }

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
      if (process.env.DEBUG) {
        console.error('Error fetching models from OpenAI:', error);
      }
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
    // Check if API key is available (using resolved authentication)
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      const endpoint = this.baseURL || 'https://api.openai.com/v1';
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(generateOAuthEndpointMismatchError(endpoint, 'qwen'));
      }
      throw new Error('OpenAI API key is required to generate completions');
    }

    // Check if we should use responses endpoint
    if (this.shouldUseResponses(this.currentModel)) {
      // Generate conversation IDs inline (would normally come from application context)
      const conversationId = undefined;
      const parentId = undefined;

      yield* await this.callResponsesEndpoint(messages, tools, {
        stream: true,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        stateful: false, // Always stateless for Phase 22-01
        conversationId,
        parentId,
      });
      return;
    }

    // Validate tool messages have required tool_call_id
    const toolMessages = messages.filter((msg) => msg.role === 'tool');
    const missingIds = toolMessages.filter((msg) => !msg.tool_call_id);

    if (missingIds.length > 0) {
      if (process.env.DEBUG) {
        console.error(
          '[OpenAIProvider] FATAL: Tool messages missing tool_call_id:',
          missingIds,
        );
      }
      throw new Error(
        `OpenAI API requires tool_call_id for all tool messages. Found ${missingIds.length} tool message(s) without IDs.`,
      );
    }

    const parser = this.requiresTextToolCallParsing()
      ? new GemmaToolCallParser()
      : null;

    // Get current tool format (with override support)
    const currentToolFormat = this.getToolFormat();

    // Format tools using formatToolsForAPI method
    const formattedTools = tools ? this.formatToolsForAPI(tools) : undefined;

    // Get stream_options from ephemeral settings (not model params)
    const streamOptions =
      this.providerConfig?.getEphemeralSettings?.()?.['stream-options'];

    // Default stream_options to { include_usage: true } unless explicitly set
    const finalStreamOptions =
      streamOptions !== undefined ? streamOptions : { include_usage: true };

    // Get resolved authentication and update client if needed
    await this.updateClientWithResolvedAuth();

    if (process.env.DEBUG) {
      console.log(
        `[OpenAI] About to make API call with model: ${this.currentModel}, baseURL: ${this.openai.baseURL}, apiKey: ${this.openai.apiKey?.substring(0, 10)}...`,
      );
    }

    // Build request params with exact order from original
    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      ...(finalStreamOptions !== null
        ? { stream_options: finalStreamOptions }
        : {}),
      tools: formattedTools as
        | OpenAI.Chat.Completions.ChatCompletionTool[]
        | undefined,
      tool_choice: this.getToolChoiceForFormat(tools),
      ...this.modelParams,
    });

    let fullContent = '';
    const accumulatedToolCalls: NonNullable<IMessage['tool_calls']> = [];
    let hasStreamedContent = false;
    let usageData:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | undefined;

    // For Qwen streaming, buffer whitespace-only chunks to preserve spacing across chunk boundaries
    let pendingWhitespace: string | null = null;

    // CEREBRAS ALTERNATIVE: If Cerebras is severely broken, aggregate all chunks first
    // Uncomment this block if the delta conversion above doesn't work
    /*
    if (this.isCerebras()) {
      const contentParts: string[] = [];
      let aggregatedToolCalls: any[] = [];
      let finalUsageData: any = undefined;
      
      for await (const chunk of stream) {
        // Handle both message and delta formats
        const message = chunk.choices?.[0]?.message || chunk.choices?.[0]?.delta;
        if (message?.content) {
          contentParts.push(message.content);
        }
        if (message?.tool_calls) {
          // For streaming, tool calls might be incremental or complete
          aggregatedToolCalls = message.tool_calls;
        }
        if (chunk.usage) {
          finalUsageData = {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
          };
        }
      }
      
      // Yield single reconstructed message
      yield {
        role: ContentGeneratorRole.ASSISTANT,
        content: contentParts.join(''),
        tool_calls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
        usage: finalUsageData,
      };
      return;
    }
    */

    for await (const chunk of stream) {
      // CEREBRAS FIX: Detect and fix malformed streaming chunks
      // Cerebras sends full message format instead of delta format in streaming
      interface CerebrasChunk {
        id?: string;
        object?: string;
        created?: number;
        model?: string;
        choices: Array<{
          delta?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              type: 'function';
              function: {
                name: string;
                arguments: string;
              };
              index: number;
            }>;
            role?: string;
          };
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              type: 'function';
              function: {
                name: string;
                arguments: string;
              };
            }>;
            role?: string;
          };
          index: number;
          finish_reason: string | null;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      }

      const cerebrasChunk = chunk as CerebrasChunk;
      if (
        this.isCerebras() &&
        cerebrasChunk.choices?.[0]?.message &&
        !cerebrasChunk.choices[0].delta
      ) {
        if (process.env.DEBUG) {
          console.log(
            '[OpenAIProvider/Cerebras] Converting malformed chunk from message to delta format',
          );
        }
        // Convert full message format to delta format
        const message = cerebrasChunk.choices[0].message;
        chunk.choices[0].delta = {
          content: message.content,
          tool_calls: message.tool_calls?.map((tc, index) => ({
            ...tc,
            index,
          })),
          role: message.role as 'system' | 'user' | 'assistant' | 'tool',
        };
        // Remove the message field to prevent confusion
        delete (cerebrasChunk.choices[0] as { message?: unknown }).message;
      }

      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        // Enhanced debug logging to understand streaming behavior
        if (process.env.DEBUG && this.isUsingQwen()) {
          console.log(`[OpenAIProvider/${this.currentModel}] Chunk:`, {
            content: delta.content,
            contentLength: delta.content.length,
            isWhitespaceOnly: delta.content.trim() === '',
            chunkIndex: chunk.choices[0]?.index,
          });
        }

        // For text-based models, don't yield content chunks yet
        if (!parser) {
          if (this.isUsingQwen()) {
            const isWhitespaceOnly = delta.content.trim() === '';
            if (isWhitespaceOnly) {
              // Buffer whitespace-only chunk
              pendingWhitespace = (pendingWhitespace || '') + delta.content;
              if (process.env.DEBUG) {
                console.log(
                  `[OpenAIProvider/${this.currentModel}] Buffered whitespace-only chunk (len=${delta.content.length}). pendingWhitespace now len=${pendingWhitespace.length}`,
                );
              }
              continue;
            } else if (pendingWhitespace) {
              // Flush buffered whitespace before non-empty chunk to preserve spacing
              if (process.env.DEBUG) {
                console.log(
                  `[OpenAIProvider/${this.currentModel}] Flushing pending whitespace (len=${pendingWhitespace.length}) before non-empty chunk`,
                );
              }
              yield {
                role: ContentGeneratorRole.ASSISTANT,
                content: pendingWhitespace,
              };
              hasStreamedContent = true;
              fullContent += pendingWhitespace;
              pendingWhitespace = null;
            }
          }

          yield {
            role: ContentGeneratorRole.ASSISTANT,
            content: delta.content,
          };
          hasStreamedContent = true;
        }

        fullContent += delta.content;
      }

      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          this.toolFormatter.accumulateStreamingToolCall(
            toolCall,
            accumulatedToolCalls,
            currentToolFormat,
          );
        }
      }

      // Check for usage data in the chunk
      if (chunk.usage) {
        usageData = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }
    }

    // Flush any remaining pending whitespace for Qwen
    if (pendingWhitespace && this.isUsingQwen() && !parser) {
      if (process.env.DEBUG) {
        console.log(
          `[OpenAIProvider/${this.currentModel}] Flushing trailing pending whitespace (len=${pendingWhitespace.length}) at stream end`,
        );
      }
      yield {
        role: ContentGeneratorRole.ASSISTANT,
        content: pendingWhitespace,
      };
      hasStreamedContent = true;
      fullContent += pendingWhitespace;
      pendingWhitespace = null;
    }

    // After stream ends, parse text-based tool calls if needed
    if (parser && fullContent) {
      const { cleanedContent, toolCalls } = parser.parse(fullContent);

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

        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          tool_calls: standardToolCalls,
          usage: usageData,
        };
      } else {
        // No tool calls found, yield cleaned content
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          usage: usageData,
        };
      }
    } else {
      // Standard OpenAI tool call handling
      if (accumulatedToolCalls.length > 0) {
        if (process.env.DEBUG && this.isUsingQwen()) {
          console.log(
            `[OpenAIProvider/${this.currentModel}] Final message with tool calls:`,
            {
              contentLength: fullContent.length,
              content:
                fullContent.substring(0, 200) +
                (fullContent.length > 200 ? '...' : ''),
              toolCallCount: accumulatedToolCalls.length,
              hasStreamedContent,
            },
          );
        }
        // For Qwen models, don't duplicate content if we've already streamed it
        const shouldOmitContent = hasStreamedContent && this.isUsingQwen();
        if (shouldOmitContent) {
          // Only yield tool calls with empty content to avoid duplication
          yield {
            role: ContentGeneratorRole.ASSISTANT,
            content: '',
            tool_calls: accumulatedToolCalls,
            usage: usageData,
          };
        } else {
          // Include full content with tool calls
          yield {
            role: ContentGeneratorRole.ASSISTANT,
            content: fullContent || '',
            tool_calls: accumulatedToolCalls,
            usage: usageData,
          };
        }
      } else if (usageData) {
        // Always emit usage data so downstream consumers can update stats
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: '',
          usage: usageData,
        };
      }
    }
  }

  override setModel(modelId: string): void {
    // Update SettingsService as the source of truth
    this.setModelInSettings(modelId).catch((error) => {
      if (process.env.DEBUG) {
        console.warn('Failed to persist model to SettingsService:', error);
      }
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
      if (process.env.DEBUG) {
        console.warn('Failed to get model from SettingsService:', error);
      }
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
    return process.env.LLXPRT_DEFAULT_MODEL || 'llama3-70b-8192';
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey?.(apiKey);

    // Persist to SettingsService if available
    this.setApiKeyInSettings(apiKey).catch((error) => {
      if (process.env.DEBUG) {
        console.warn('Failed to persist API key to SettingsService:', error);
      }
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
      if (process.env.DEBUG) {
        console.warn('Failed to persist base URL to SettingsService:', error);
      }
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
   * Estimates the remote context usage for the current conversation
   * @param conversationId The conversation ID
   * @param parentId The parent message ID
   * @param promptMessages The messages being sent in the current prompt
   * @returns Context usage information including remote tokens
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
   * @returns The conversation cache
   */
  getConversationCache(): ConversationCache {
    return this.conversationCache;
  }

  /**
   * OpenAI always requires payment (API key)
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
      if (process.env.DEBUG) {
        console.warn(
          'Failed to persist model params to SettingsService:',
          error,
        );
      }
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

      if (process.env.DEBUG) {
        console.log(
          `[OpenAI] Initialized from SettingsService - model: ${this.currentModel}, baseURL: ${this.baseURL}, params:`,
          this.modelParams,
        );
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          'Failed to initialize OpenAI provider from SettingsService:',
          error,
        );
      }
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
      if (process.env.DEBUG) {
        console.warn(
          'Failed to detect tool format from SettingsService:',
          error,
        );
      }

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
}
