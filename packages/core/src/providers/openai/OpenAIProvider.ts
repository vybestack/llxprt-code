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
import { IContent } from '../../services/history/IContent.js';
import { ITool } from '../ITool.js';
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
    // Initialize base provider with auth configuration
    super(
      {
        name: 'openai',
        apiKey,
        baseURL,
        isOAuthEnabled: false,
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
   * Get or create OpenAI client instance
   * Will use the API key from resolved auth
   * @returns OpenAI client instance
   */
  private async getClient(): Promise<OpenAI> {
    const resolvedKey = await this.getAuthToken();
    // Use the unified getBaseURL() method from BaseProvider
    const baseURL = this.getBaseURL();
    const clientKey = `${baseURL}-${resolvedKey}`;

    // Return cached client if available and auth hasn't changed
    if (this._cachedClient && this._cachedClientKey === clientKey) {
      return this._cachedClient;
    }

    // Create new client with current auth
    this._cachedClient = new OpenAI({
      apiKey: resolvedKey || '',
      baseURL,
    });
    this._cachedClientKey = clientKey;

    return this._cachedClient;
  }

  /**
   * Check if OAuth is supported for this provider
   */
  protected supportsOAuth(): boolean {
    return false; // OpenAI provider doesn't support OAuth
  }

  override async getModels(): Promise<IModel[]> {
    // TODO: Implement model listing for OpenAI provider
    return [];
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
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
        parameters?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // Convert function declarations to ITool format for compatibility
    const convertedTools: ITool[] | undefined = tools?.map((toolGroup) => {
      // Use first function declaration from each group
      const func = toolGroup.functionDeclarations[0];
      return {
        type: 'function',
        function: {
          name: func.name,
          description: func.description || '',
          parameters: func.parameters || {},
        },
      };
    });

    const generator = this.generateChatCompletionImpl(
      contents,
      convertedTools,
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
              id: tc.id,
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
            tool_call_id: tr.callId,
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
    tools?: ITool[],
    maxTokens?: number,
    abortSignal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<IContent, void, unknown> {
    // Always look up model from SettingsService
    const model = modelName || this.getModel() || this.getDefaultModel();

    // Convert IContent to OpenAI messages format
    const messages = this.convertToOpenAIMessages(contents);

    // Format tools for API
    const formattedTools = tools
      ? tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.function.name,
            description: tool.function.description || '',
            parameters:
              (tool.function.parameters as Record<string, unknown>) || {},
          },
        }))
      : undefined;

    // Get auth token
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    // Build request
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages,
      tools: formattedTools,
      max_tokens: maxTokens,
      stream: true,
    };

    // Get OpenAI client
    const client = await this.getClient();

    // Wrap the API call with retry logic
    const makeApiCall = async () => {
      const response = await client.chat.completions.create(requestBody, {
        signal: abortSignal,
      });
      return response;
    };

    let retryCount = 0;
    const maxRetries = 3;
    let response:
      | OpenAI.Chat.Completions.ChatCompletion
      | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    while (retryCount <= maxRetries) {
      try {
        response = await makeApiCall();
        break; // Success, exit retry loop
      } catch (error) {
        if (retryCount === maxRetries) {
          throw error; // Max retries reached, re-throw error
        }
        retryCount++;
        this.logger.debug(
          () => `API call failed (attempt ${retryCount}), retrying...`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }
    }

    if (!response!) {
      throw new Error('Failed to get response after retries');
    }

    // Process streaming response
    let accumulatedText = '';
    const accumulatedToolCalls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }> = [];

    try {
      // Handle streaming response
      for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (abortSignal?.aborted) {
          break;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Handle text content
        const deltaContent = choice.delta?.content;
        if (deltaContent) {
          accumulatedText += deltaContent;
          // Emit text in chunks rather than waiting for full accumulation
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: accumulatedText,
              } as TextBlock,
            ],
          } as IContent;
          accumulatedText = ''; // Reset accumulated text after emitting
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
          id: tc.id,
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
