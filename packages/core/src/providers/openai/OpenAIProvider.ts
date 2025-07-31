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

import { IProvider } from '../IProvider.js';
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

export class OpenAIProvider implements IProvider {
  name: string = 'openai';
  private openai: OpenAI;
  private currentModel: string = 'gpt-4.1';
  private apiKey: string;
  private baseURL?: string;
  private config?: IProviderConfig;
  private toolFormatter: ToolFormatter;
  private toolFormatOverride?: ToolFormat;
  private conversationCache: ConversationCache;

  constructor(apiKey: string, baseURL?: string, config?: IProviderConfig) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.config = config;
    this.toolFormatter = new ToolFormatter();
    this.conversationCache = new ConversationCache();

    this.openai = new OpenAI({
      apiKey,
      baseURL,
      // Allow browser environment for tests
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }

  private requiresTextToolCallParsing(): boolean {
    if (this.config?.enableTextToolCallParsing === false) {
      return false;
    }

    // Check if current tool format requires text-based parsing
    const currentFormat = this.getToolFormat();
    const textBasedFormats: ToolFormat[] = ['hermes', 'xml', 'llama'];
    if (textBasedFormats.includes(currentFormat)) {
      return true;
    }

    const configuredModels = this.config?.textToolCallModels || [];
    return configuredModels.includes(this.currentModel);
  }

  getToolFormat(): ToolFormat {
    // Check manual override first
    if (this.toolFormatOverride) {
      return this.toolFormatOverride;
    }

    // Check for settings override
    if (this.config?.providerToolFormatOverrides?.[this.name]) {
      return this.config.providerToolFormatOverrides[this.name] as ToolFormat;
    }

    // Auto-detect tool format based on model or base URL
    if (
      this.currentModel.includes('deepseek') ||
      this.baseURL?.includes('deepseek')
    ) {
      return 'deepseek';
    }
    if (this.currentModel.includes('qwen') || this.baseURL?.includes('qwen')) {
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
    if (this.config?.openaiResponsesEnabled === false) {
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
    // Check if API key is available
    if (!this.apiKey || this.apiKey.trim() === '') {
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

    // Build the request
    const request = buildResponsesRequest({
      model: this.currentModel,
      messages,
      tools: formattedTools,
      stream: options?.stream ?? true,
      conversationId: options?.conversationId,
      parentId: options?.parentId,
      tool_choice: options?.tool_choice,
    });

    // Make the API call
    const baseURL = this.baseURL || 'https://api.openai.com/v1';
    const responsesURL = `${baseURL}/responses`;

    const response = await fetch(responsesURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
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

        const retryResponse = await fetch(responsesURL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(retryRequest),
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

  async getModels(): Promise<IModel[]> {
    // Check if API key is available
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('OpenAI API key is required to fetch models');
    }

    try {
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
    // Check if API key is available
    if (!this.apiKey || this.apiKey.trim() === '') {
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

    // Format tools using ToolFormatter
    const formattedTools = tools
      ? this.toolFormatter.toProviderFormat(tools, currentToolFormat)
      : undefined;

    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
      tools: formattedTools as
        | OpenAI.Chat.Completions.ChatCompletionTool[]
        | undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
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

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;

        // Enhanced debug logging to understand streaming behavior
        if (process.env.DEBUG && this.currentModel.includes('qwen')) {
          console.log(`[OpenAIProvider/${this.currentModel}] Chunk:`, {
            content: delta.content,
            contentLength: delta.content.length,
            fullContentLength: fullContent.length,
            chunkIndex: chunk.choices[0]?.index,
          });
          // Check if this chunk contains repeated content
          const beforeAddition = fullContent.substring(
            0,
            fullContent.length - delta.content.length,
          );
          if (beforeAddition.endsWith(delta.content)) {
            console.log(
              `[OpenAIProvider/${this.currentModel}] WARNING: Chunk appears to be a repeat!`,
            );
          }
        }

        // For text-based models, don't yield content chunks yet
        if (!parser) {
          // Skip whitespace-only chunks for Qwen models to prevent extra spacing
          if (
            this.currentModel.includes('qwen') &&
            delta.content &&
            delta.content.trim() === ''
          ) {
            if (process.env.DEBUG) {
              console.log(
                `[OpenAIProvider/${this.currentModel}] Skipping whitespace-only chunk: ${JSON.stringify(delta.content)}`,
              );
            }
            continue;
          }
          yield {
            role: ContentGeneratorRole.ASSISTANT,
            content: delta.content,
          };
          hasStreamedContent = true;
        }
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
        if (process.env.DEBUG && this.currentModel.includes('qwen')) {
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
        const shouldOmitContent =
          hasStreamedContent && this.currentModel.includes('qwen');
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

  setModel(modelId: string): void {
    this.currentModel = modelId;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    // Create a new OpenAI client with the updated API key
    this.openai = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }

  setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, clear to default (undefined)
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;
    // Create a new OpenAI client with the updated (or cleared) base URL
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }

  setConfig(config: IProviderConfig): void {
    this.config = config;
  }

  setToolFormatOverride(format: ToolFormat | null): void {
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
  isPaidMode(): boolean {
    return true;
  }

  clearState(): void {
    // Clear the conversation cache to prevent tool call ID mismatches
    this.conversationCache.clear();
  }

  /**
   * Get the list of server tools supported by this provider
   */
  getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by OpenAI provider');
  }
}
