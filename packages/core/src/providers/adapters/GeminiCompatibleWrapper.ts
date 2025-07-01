/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Provider, ProviderMessage, ProviderTool } from '../types.js';
import {
  Content,
  GenerateContentResponse,
  GenerateContentConfig,
  Part,
  ContentListUnion,
} from '@google/genai';
import {
  GeminiEventType,
  ToolCallRequestInfo,
  ServerGeminiStreamEvent,
  ServerGeminiContentEvent,
  ServerGeminiToolCallRequestEvent,
  ServerGeminiUsageMetadataEvent,
} from '../../core/turn.js';

/**
 * Wrapper that makes any IProvider compatible with Gemini's ContentGenerator interface
 */

export class GeminiCompatibleWrapper {
  private readonly provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Convert Gemini tools format to provider tools format
   */
  private convertGeminiToolsToProviderTools(
    geminiTools: Array<{
      functionDeclarations?: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ): ProviderTool[] {
    const providerTools: ProviderTool[] = [];

    for (const tool of geminiTools) {
      if (tool.functionDeclarations) {
        // Gemini format has functionDeclarations array
        for (const func of tool.functionDeclarations) {
          providerTools.push({
            type: 'function' as const,
            function: {
              name: func.name,
              description: func.description || '',
              parameters: (func.parameters as Record<string, unknown>) ?? {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          });
        }
      }
    }

    return providerTools;
  }

  /**
   * Generate content using the wrapped provider (non-streaming)
   * @param params Parameters for content generation
   * @returns A promise resolving to a Gemini-formatted response
   */
  async generateContent(params: {
    model: string;
    contents: ContentListUnion;
    config?: GenerateContentConfig;
  }): Promise<GenerateContentResponse> {
    // Convert Gemini contents to provider messages
    const messages = this.convertContentsToMessages(params.contents);

    // Collect full response from provider stream
    const responseMessages: ProviderMessage[] = [];
    const stream = this.provider.generateChatCompletion(messages);

    for await (const chunk of stream) {
      responseMessages.push(chunk as ProviderMessage);
    }

    // Convert provider response to Gemini format
    return this.convertMessagesToResponse(responseMessages);
  }

  /**
   * Generate content using the wrapped provider (streaming)
   * @param params Parameters for content generation
   * @returns An async generator yielding Gemini-formatted responses
   */
  async *generateContentStream(params: {
    model: string;
    contents: ContentListUnion;
    config?: GenerateContentConfig;
  }): AsyncGenerator<GenerateContentResponse> {
    console.debug(
      '[GeminiCompatibleWrapper] generateContentStream called with model:',
      params.model,
    );
    console.debug(
      '[GeminiCompatibleWrapper] Using provider:',
      this.provider.name,
    );

    // Convert Gemini contents to provider messages
    let messages = this.convertContentsToMessages(params.contents);

    // Add system instruction if provided
    if (params.config?.systemInstruction) {
      console.log('[GeminiCompatibleWrapper] Adding system instruction');
      let systemContent: string;

      // Handle different systemInstruction formats
      if (typeof params.config.systemInstruction === 'string') {
        systemContent = params.config.systemInstruction;
      } else {
        // It's a ContentUnion - convert to string
        const systemMessages = this.convertContentsToMessages(
          params.config.systemInstruction,
        );
        systemContent = systemMessages.map((m) => m.content).join('\n');
      }

      messages = [
        {
          role: 'system' as const,
          content: systemContent,
        },
        ...messages,
      ];
    }

    console.debug(
      '[GeminiCompatibleWrapper] Converted messages:',
      JSON.stringify(messages, null, 2),
    );

    // Extract and convert tools from config if available
    let providerTools: ProviderTool[] | undefined;
    const geminiTools = (params.config as { tools?: unknown })?.tools;
    if (geminiTools && Array.isArray(geminiTools)) {
      console.log(
        '[GeminiCompatibleWrapper] Gemini tools provided:',
        geminiTools.length,
      );
      providerTools = this.convertGeminiToolsToProviderTools(geminiTools);
      console.log(
        '[GeminiCompatibleWrapper] Converted provider tools:',
        providerTools.length,
      );
      console.log(
        '[GeminiCompatibleWrapper] Tool names:',
        providerTools.map((t) => t.function?.name ?? '').join(', '),
      );
      if (providerTools.length > 0) {
        console.log(
          '[GeminiCompatibleWrapper] First tool details:',
          JSON.stringify(providerTools[0], null, 2),
        );
      }
    } else {
      console.log('[GeminiCompatibleWrapper] NO TOOLS PROVIDED IN CONFIG');
      console.log(
        '[GeminiCompatibleWrapper] Config keys:',
        Object.keys(params.config || {}),
      );
    }

    // Stream from provider and convert each chunk
    const stream = this.provider.generateChatCompletion(
      messages,
      providerTools,
    );

    for await (const chunk of stream) {
      console.debug(
        '[GeminiCompatibleWrapper] Received chunk from provider:',
        JSON.stringify(chunk, null, 2),
      );
      yield this.convertMessageToStreamResponse(chunk as ProviderMessage);
    }
  }

  /**
   * Adapts a provider's stream to Gemini event format
   * @param providerStream The provider-specific stream
   * @returns An async iterator of Gemini events
   */
  async *adaptStream(
    providerStream: AsyncIterableIterator<ProviderMessage>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent> {
    yield* this.adaptProviderStream(providerStream);
  }

  /**
   * Adapts the provider's stream format to Gemini's expected format
   * @param providerStream Stream from the provider
   * @returns Async iterator of Gemini events
   */
  private async *adaptProviderStream(
    providerStream: AsyncIterableIterator<ProviderMessage>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent> {
    for await (const message of providerStream) {
      // Emit content event if message has content
      if (message.content) {
        const contentEvent: ServerGeminiContentEvent = {
          type: GeminiEventType.Content,
          value: message.content,
        };
        yield contentEvent;
      }

      // Emit tool call events if message has tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(
          '[GeminiCompatibleWrapper] 🎯 CONVERTING TOOL CALLS TO EVENTS:',
          message.tool_calls.length,
        );
        for (const toolCall of message.tool_calls) {
          console.log(
            '[GeminiCompatibleWrapper] Tool call:',
            toolCall.function.name,
            toolCall.function.arguments,
          );
          const toolEvent: ServerGeminiToolCallRequestEvent = {
            type: GeminiEventType.ToolCallRequest,
            value: {
              callId: toolCall.id,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
              isClientInitiated: false,
            } as ToolCallRequestInfo,
          };
          yield toolEvent;
        }
      } else if (message.tool_calls !== undefined) {
        console.log('[GeminiCompatibleWrapper] ❌ Empty tool_calls array');
      }

      // Emit usage metadata event if message has usage data
      if (message.usage) {
        console.log(
          '[GeminiCompatibleWrapper] 📊 EMITTING USAGE EVENT:',
          JSON.stringify(
            {
              prompt_tokens: message.usage.prompt_tokens,
              completion_tokens: message.usage.completion_tokens,
              total_tokens: message.usage.total_tokens,
            },
            null,
            2,
          ),
        );
        const usageEvent: ServerGeminiUsageMetadataEvent = {
          type: GeminiEventType.UsageMetadata,
          value: {
            promptTokenCount: message.usage.prompt_tokens,
            candidatesTokenCount: message.usage.completion_tokens,
            totalTokenCount: message.usage.total_tokens,
          },
        };
        yield usageEvent;
      }
    }
  }

  /**
   * Convert Gemini ContentListUnion to provider ProviderMessage array
   */
  private convertContentsToMessages(
    contents: ContentListUnion,
  ): ProviderMessage[] {
    // Normalize ContentListUnion to Content[]
    let contentArray: Content[];

    // Debug logging for multiple tool responses
    if (Array.isArray(contents) && contents.length > 0) {
      const hasFunctionResponses = contents.some(
        (content) =>
          typeof content === 'object' &&
          content !== null &&
          'parts' in content &&
          Array.isArray(content.parts) &&
          content.parts.some((part) => 'functionResponse' in part),
      );
      if (hasFunctionResponses) {
        console.log(
          '[GeminiCompatibleWrapper] Processing contents with function responses:',
          contents.length,
          'items',
        );
      }
    }

    if (Array.isArray(contents)) {
      // If it's already an array, check if it's Content[] or PartUnion[]
      if (contents.length === 0) {
        contentArray = [];
      } else if (
        typeof contents[0] === 'object' &&
        contents[0] !== null &&
        'role' in contents[0]
      ) {
        // It's Content[]
        contentArray = contents as Content[];
      } else {
        // It's PartUnion[] - convert to Part[] and wrap in a single Content with user role
        const parts: Part[] = contents.map((item) =>
          typeof item === 'string' ? { text: item } : (item as Part),
        );

        // Special handling: check if all parts are functionResponses
        const allFunctionResponses = parts.every(
          (part) =>
            part && typeof part === 'object' && 'functionResponse' in part,
        );

        if (allFunctionResponses && parts.length > 1) {
          console.log(
            '[GeminiCompatibleWrapper] Multiple functionResponse parts detected, wrapping in single Content',
          );
        }

        contentArray = [
          {
            role: 'user',
            parts,
          },
        ];
      }
    } else if (typeof contents === 'string') {
      // It's a string - wrap in Part and Content
      contentArray = [
        {
          role: 'user',
          parts: [{ text: contents }],
        },
      ];
    } else if (
      typeof contents === 'object' &&
      contents !== null &&
      'role' in contents
    ) {
      // It's a single Content
      contentArray = [contents as Content];
    } else {
      // It's a single Part - wrap in Content with user role
      contentArray = [
        {
          role: 'user',
          parts: [contents as Part],
        },
      ];
    }

    const messages: ProviderMessage[] = [];

    for (const content of contentArray) {
      // Check for function responses (tool results)
      const functionResponses = (content.parts || []).filter(
        (
          part,
        ): part is Part & {
          functionResponse: {
            id: string;
            name: string;
            response: { error?: string; llmContent?: string; output?: string };
          };
        } => 'functionResponse' in part,
      );

      if (functionResponses.length > 0) {
        if (functionResponses.length > 1) {
          console.log(
            `[GeminiCompatibleWrapper] Processing ${functionResponses.length} function responses from single Content object`,
          );
        }
        // Convert each function response to a tool message
        for (const part of functionResponses) {
          console.log(
            `[GeminiCompatibleWrapper] Processing functionResponse part:`,
            JSON.stringify(part, null, 2),
          );
          const response = part.functionResponse.response;
          let content: string;

          if (typeof response === 'string') {
            content = response;
          } else if (response?.error) {
            content = `Error: ${response.error}`;
          } else if (response?.llmContent) {
            content = String(response.llmContent);
          } else if (response?.output) {
            content = String(response.output);
          } else {
            content = JSON.stringify(response);
          }

          const toolCallId = part.functionResponse.id;
          if (!toolCallId) {
            const errorDetails = {
              error: 'Missing tool_call_id in functionResponse',
              functionResponse: part.functionResponse,
              toolName: part.functionResponse.name,
              fullPart: part,
              context:
                'This error occurs when a tool response is missing the required ID that links it back to the original tool call. Every tool call from the model has a unique ID, and the response MUST include this same ID.',
              possibleCauses: [
                'Tool execution did not preserve the callId from the original request',
                'Tool response was manually created without including the ID',
                'The convertToFunctionResponse function failed to add the callId',
              ],
            };

            console.error(
              '[GeminiCompatibleWrapper] FATAL ERROR:',
              JSON.stringify(errorDetails, null, 2),
            );
            throw new Error(
              `Tool response for '${part.functionResponse.name}' is missing required tool_call_id. This ID must match the original tool call ID from the model. See console for full error details.`,
            );
          }

          messages.push({
            role: 'tool',
            content,
            tool_call_id: toolCallId,
            name: part.functionResponse.name,
          } as ProviderMessage);
        }
      } else {
        // Check for function calls (tool calls from the model)
        const functionCalls = (content.parts || []).filter(
          (
            part,
          ): part is Part & {
            functionCall: {
              id?: string;
              name: string;
              args?: Record<string, unknown>;
            };
          } => 'functionCall' in part,
        );

        // Regular text content
        const textParts = (content.parts || [])
          .filter((part): part is Part & { text: string } => 'text' in part)
          .map((part) => part.text);
        const combinedText = textParts.join('');

        // Map Gemini roles to provider roles
        const role = content.role === 'model' ? 'assistant' : content.role;

        const message: ProviderMessage = {
          role: role as 'user' | 'assistant' | 'system',
          content: combinedText,
        };

        // If this is an assistant message with function calls, add them
        if (role === 'assistant' && functionCalls.length > 0) {
          message.tool_calls = functionCalls.map((part) => ({
            id:
              part.functionCall.id ||
              `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'function' as const,
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          }));
        }

        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Convert provider messages to a single Gemini response
   */
  private convertMessagesToResponse(
    messages: ProviderMessage[],
  ): GenerateContentResponse {
    // Combine all messages into a single response
    const combinedContent = messages.map((m) => m.content || '').join('');
    const parts: Part[] = [];

    // Add text content
    if (combinedContent) {
      parts.push({ text: combinedContent });
    }

    // Add tool calls as function calls
    for (const message of messages) {
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          } as Part);
        }
      }
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
        },
      ],
    } as GenerateContentResponse;
  }

  /**
   * Convert a single provider message to a streaming Gemini response
   */
  private convertMessageToStreamResponse(
    message: ProviderMessage,
  ): GenerateContentResponse {
    const parts: Part[] = [];

    // Add text content if present
    if (message.content) {
      parts.push({ text: message.content });
    }

    // Add tool calls as function calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments),
            // Store the tool call ID in the functionCall for later retrieval
            id: toolCall.id,
          },
        } as Part);
      }
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
        },
      ],
    } as GenerateContentResponse;
  }
}
