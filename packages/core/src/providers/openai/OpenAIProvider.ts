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
import { BaseProvider } from '../BaseProvider.js';
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

export class OpenAIProvider extends BaseProvider implements IProvider {
  override readonly name: string = 'openai';
  private logger: DebugLogger;
  private toolFormatter: ToolFormatter;

  private _cachedClient?: OpenAI;
  private _cachedClientKey?: string;

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
    const isQwenEndpoint = !!(
      baseURL &&
      (baseURL.includes('dashscope.aliyuncs.com') ||
        baseURL.includes('api.qwen.com') ||
        baseURL.includes('qwen'))
    );

    // Initialize base provider with auth configuration
    super(
      {
        name: 'openai',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'], // Support environment variable fallback
        isOAuthEnabled: isQwenEndpoint && !!oauthManager,
        oauthProvider: isQwenEndpoint ? 'qwen' : undefined,
        oauthManager,
      },
      config,
    );

    this.toolFormatter = new ToolFormatter();
    // new DebugLogger('llxprt:core:toolformatter'), // TODO: Fix ToolFormatter constructor

    // Setup debug logger
    this.logger = new DebugLogger('llxprt:provider:openai');
  }

  /**
   * Create HTTP/HTTPS agents with socket configuration for local AI servers
   * Returns undefined if no socket settings are configured
   */
  private createHttpAgents():
    | { httpAgent: http.Agent; httpsAgent: https.Agent }
    | undefined {
    // Get socket configuration from ephemeral settings
    const settings = this.providerConfig?.getEphemeralSettings?.() || {};

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
   * Get or create OpenAI client instance
   * Will use the API key from resolved auth
   * @returns OpenAI client instance
   */
  private async getClient(): Promise<OpenAI> {
    const resolvedKey = await this.getAuthToken();
    // Use the unified getBaseURL() method from BaseProvider
    const baseURL = this.getBaseURL();
    const clientKey = `${baseURL}-${resolvedKey}`;

    // Clear cache if we have no valid auth (e.g., after logout)
    if (!resolvedKey && this._cachedClient) {
      this._cachedClient = undefined;
      this._cachedClientKey = undefined;
    }

    // Return cached client if available and auth hasn't changed
    if (this._cachedClient && this._cachedClientKey === clientKey) {
      return this._cachedClient;
    }

    // Create HTTP agents with socket configuration (if configured)
    const agents = this.createHttpAgents();

    // Build client options - OpenAI SDK accepts httpAgent/httpsAgent at runtime
    // even though they're not in the TypeScript definitions
    const baseOptions = {
      apiKey: resolvedKey || '',
      baseURL,
    };

    // Add socket configuration if available
    const clientOptions = agents
      ? {
          ...baseOptions,
          httpAgent: agents.httpAgent,
          httpsAgent: agents.httpsAgent,
        }
      : baseOptions;

    // Create new client with current auth and optional socket configuration
    // Cast to unknown then to the expected type to bypass TypeScript's structural checking
    this._cachedClient = new OpenAI(
      clientOptions as unknown as ConstructorParameters<typeof OpenAI>[0],
    );
    this._cachedClientKey = clientKey;

    return this._cachedClient;
  }

  /**
   * Check if OAuth is supported for this provider
   * Qwen endpoints support OAuth, standard OpenAI does not
   */
  protected supportsOAuth(): boolean {
    const baseURL = this.getBaseURL();

    // Check if this is a Qwen endpoint that supports OAuth
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
      const client = await this.getClient();
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
      this.logger.debug(() => `Error fetching models from OpenAI: ${error}`);
      // Return a hardcoded list as fallback
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    return [];
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
   * Clear the cached OpenAI client
   * Should be called when authentication state changes (e.g., after logout)
   */
  public clearClientCache(): void {
    this._cachedClient = undefined;
    this._cachedClientKey = undefined;
  }

  override getServerTools(): string[] {
    // TODO: Implement server tools for OpenAI provider
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
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
   * Generate chat completion with IContent interface
   * Internally converts to OpenAI API format, but only yields IContent
   * @param contents Array of content blocks (text and tool_call)
   * @param tools Array of available tools
   */
  override async *generateChatCompletion(
    contents: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // Debug log what we receive
    if (this.logger.enabled) {
      this.logger.debug(
        () => `[OpenAIProvider] generateChatCompletion received tools:`,
        {
          hasTools: !!tools,
          toolsLength: tools?.length,
          toolsType: typeof tools,
          isArray: Array.isArray(tools),
          firstToolName: tools?.[0]?.functionDeclarations?.[0]?.name,
          toolsStructure: tools ? 'available' : 'undefined',
        },
      );
    }

    // Pass tools directly in Gemini format - they'll be converted in generateChatCompletionImpl
    const generator = this.generateChatCompletionImpl(
      contents,
      tools,
      undefined,
      undefined,
      undefined,
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
   * Internal implementation for chat completion
   */
  private async *generateChatCompletionImpl(
    contents: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
    maxTokens?: number,
    abortSignal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<IContent, void, unknown> {
    // Always look up model from SettingsService
    const model = modelName || this.getModel() || this.getDefaultModel();

    // Convert IContent to OpenAI messages format
    const messages = this.convertToOpenAIMessages(contents);

    // Convert Gemini format tools directly to OpenAI format using the new method
    const formattedTools = this.toolFormatter.convertGeminiToOpenAI(tools);

    // Debug log the conversion result
    if (this.logger.enabled) {
      this.logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
        inputHadTools: !!tools,
        inputToolsLength: tools?.length,
        outputHasTools: !!formattedTools,
        outputToolsLength: formattedTools?.length,
        outputToolNames: formattedTools?.map((t) => t.function.name),
      });
    }

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Get the system prompt
    const userMemory = this.globalConfig?.getUserMemory
      ? this.globalConfig.getUserMemory()
      : '';
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      model,
      undefined,
    );

    // Add system prompt as the first message in the array
    const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Build request - only include tools if they exist and are not empty
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      ...(formattedTools && formattedTools.length > 0
        ? {
            tools: formattedTools,
            // Add tool_choice for Qwen/Cerebras to ensure proper tool calling
            tool_choice: 'auto',
          }
        : {}),
      max_tokens: maxTokens,
      stream: streamingEnabled,
    };

    // Debug log request summary for Cerebras/Qwen
    if (
      this.logger.enabled &&
      (model.toLowerCase().includes('qwen') ||
        this.getBaseURL()?.includes('cerebras'))
    ) {
      this.logger.debug(
        () => `Request to ${this.getBaseURL()} for model ${model}:`,
        {
          baseURL: this.getBaseURL(),
          model,
          streamingEnabled,
          hasTools: 'tools' in requestBody,
          toolCount: formattedTools?.length || 0,
          messageCount: messages.length,
          toolsInRequest:
            'tools' in requestBody ? requestBody.tools?.length : 'not included',
        },
      );
    }

    // Get OpenAI client
    const client = await this.getClient();

    // Get retry settings from ephemeral settings
    const ephemeralSettings =
      this.providerConfig?.getEphemeralSettings?.() || {};
    const maxRetries =
      (ephemeralSettings['retries'] as number | undefined) ?? 6; // Default for OpenAI
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000; // Default for OpenAI

    // Wrap the API call with retry logic using centralized retry utility
    const response = await retryWithBackoff(
      () =>
        client.chat.completions.create(requestBody, { signal: abortSignal }),
      {
        maxAttempts: maxRetries,
        initialDelayMs,
        maxDelayMs: 30000, // 30 seconds
        shouldRetry: this.shouldRetryResponse.bind(this),
      },
    );

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
      const detectedFormat = this.detectToolFormat();
      // Buffer text for Qwen format providers to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen';

      try {
        // Handle streaming response
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          if (abortSignal?.aborted) {
            break;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            this.logger.debug(
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
              this.logger.debug(
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
              this.logger.debug(
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
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          throw error;
        } else {
          this.logger.error('Error processing streaming response:', error);
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
        const detectedFormat = this.detectToolFormat();

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
          yield {
            speaker: 'ai',
            blocks,
          } as IContent;
        }
      }
    } else {
      // Handle non-streaming response
      const completion = response as OpenAI.Chat.Completions.ChatCompletion;
      const choice = completion.choices?.[0];

      if (!choice) {
        throw new Error('No choices in completion response');
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
        const detectedFormat = this.detectToolFormat();

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
        yield {
          speaker: 'ai',
          blocks,
        } as IContent;
      }
    }
  }

  /**
   * Detects the tool call format based on the model being used
   * @returns The detected tool format ('openai' or 'qwen')
   */
  private detectToolFormat(): ToolFormat {
    try {
      // Try to get format from SettingsService if available
      const settings = this.providerConfig?.getEphemeralSettings?.();
      if (settings && settings['tool-format']) {
        return settings['tool-format'] as ToolFormat;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );
    }

    // Fallback detection without SettingsService - always look up current model
    const modelName = (this.getModel() || this.getDefaultModel()).toLowerCase();

    if (modelName.includes('glm-4.5') || modelName.includes('glm-4-5')) {
      return 'qwen';
    }

    if (modelName.includes('qwen')) {
      return 'qwen';
    }

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
   * Determines whether a response should be retried based on error codes
   * @param error The error object from the API response
   * @returns true if the request should be retried, false otherwise
   */
  shouldRetryResponse(error: unknown): boolean {
    // Don't retry if we're streaming chunks - just continue processing
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 200
    ) {
      return false;
    }

    // Retry on 429 rate limit errors or 5xx server errors
    const shouldRetry = Boolean(
      error &&
        typeof error === 'object' &&
        'status' in error &&
        ((error as { status?: number }).status === 429 ||
          (((error as { status?: number }).status as number) >= 500 &&
            ((error as { status?: number }).status as number) < 600)),
    );

    return shouldRetry;
  }
}
