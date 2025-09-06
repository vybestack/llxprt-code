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
import { IProvider, IContent, ITool } from '../../types/index.js';
import { IProviderConfig, ToolFormat } from '../../config/types.js';
import { BaseProvider } from '../base.js';
import { DebugLogger } from '../../debug/index.js';
import { OAuthManager, IOAuthEndpoints } from '../../oauth/index.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import {
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

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
    super('OPENAI', apiKey, oauthManager);

    this.baseURL = baseURL;
    this.providerConfig = config;
    this.toolFormatter = new ToolFormatter(
      this.logger || new DebugLogger('llxprt:core:toolformatter'),
    );

    // Initialize OpenAI client
    this.openai = this.getClient();

    // Setup debug logger
    this.logger = new DebugLogger('llxprt:provider:openai');
  }

  /**
   * Initialize provider configuration from SettingsService
   */
  initializeConfig(): void {
    const settings = this.providerConfig?.getEphemeralSettings?.() || {};
    this.toolFormatOverride = settings['tool-format'] as ToolFormat | undefined;
    this.modelParams = settings['model-params'] as Record<string, unknown>;
  }

  /**
   * Get or create OpenAI client instance
   * Will use the API key from resolved auth
   * @returns OpenAI client instance
   */
  private getClient(): OpenAI {
    const resolvedKey = this.getResolvedAuthToken();
    const clientKey = `${this.baseURL}-${resolvedKey}`;

    // Return cached client if available and auth hasn't changed
    if (this._cachedClient && this._cachedClientKey === clientKey) {
      return this._cachedClient;
    }

    // Create new client with current auth
    this._cachedClient = new OpenAI({
      apiKey: resolvedKey || '',
      baseURL: this.baseURL,
    });
    this._cachedClientKey = clientKey;

    return this._cachedClient;
  }

  /**
   * Generate chat completion with IContent interface
   * Internally converts to OpenAI API format, but only yields IContent
   * @param contents Array of content blocks (text and tool_call)
   * @param tools Array of available tools
   * @param maxTokens Maximum tokens to generate
   * @param abortSignal Abort signal for cancellation
   * @param modelName Model name to use (optional)
   */
  async *generateChatCompletion(
    contents: IContent[],
    tools?: ITool[],
    maxTokens?: number,
    abortSignal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<IContent, void, unknown> {
    // Use provided model name or fallback to current model
    const model = modelName || this.currentModel;

    // Convert IContent to OpenAI messages format
    const messages = HistoryService.toOpenAIFormat(contents);

    // Format tools for API
    const formattedTools = tools
      ? tools.map((decl) => {
          // Get parameters schema (either JSON schema or Gemini schema if provided)
          const toolParameters =
            'parametersJsonSchema' in decl
              ? decl.parametersJsonSchema
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
      model,
      messages,
      tools: formattedTools,
      max_tokens: maxTokens,
      stream: true,
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
      return response;
    };

    let retryCount = 0;
    const maxRetries = 3;
    let response;

    while (retryCount <= maxRetries) {
      try {
        response = await makeApiCall();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
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

    if (!response) {
      throw new Error('Failed to get response after retries');
    }

    // Process streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    let accumulatedText = '';
    let accumulatedToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
      [];

    try {
      while (!abortSignal?.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);

        // Split chunk into lines (SSE format)
        const lines = chunk
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => line.trim());

        for (const line of lines) {
          // Each line is a separate SSE event in streaming mode
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix

            if (data === '[DONE]') {
              // Stream finished, emit any remaining text
              if (accumulatedText) {
                yield {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'text',
                      text: accumulatedText,
                    } as TextBlock,
                  ],
                } as IContent;
              }
              return;
            }

            let parsedData;
            try {
              parsedData = JSON.parse(data);
            } catch (_e) {
              // If parsing fails, skip this line
              continue;
            }

            const choice = parsedData.choices?.[0];
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
      }
    } finally {
      reader.releaseLock();
    }

    // Emit accumulated tool calls as IContent if any
    if (accumulatedToolCalls.length > 0) {
      const blocks: ToolCallBlock[] = [];
      const detectedFormat = this.detectToolFormat();

      for (const tc of accumulatedToolCalls) {
        if (!tc) continue;

        // Process tool parameters with double-escape handling
        const processedParameters = processToolParameters(
          tc.function.arguments,
          tc.function.name,
          detectedFormat,
        );

        blocks.push({
          type: 'tool_call',
          id: tc.id,
          name: tc.function.name,
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
      const settings = this.providerConfig
        ? this.providerConfig.getEphemeralSettings()
        : undefined;
      if (settings && settings['tool-format']) {
        return settings['tool-format'] as ToolFormat;
      }
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
      error.status === 200
    ) {
      return false;
    }

    // Retry on 429 rate limit errors or 5xx server errors
    const shouldRetry =
      (error &&
        typeof error === 'object' &&
        'status' in error &&
        (error.status === 429 ||
          (error.status >= 500 && error.status < 600))) ||
      false;

    return shouldRetry;
  }
}
