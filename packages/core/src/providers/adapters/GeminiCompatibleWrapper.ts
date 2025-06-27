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
} from '../../core/turn.js';

/**
 * Wrapper that makes any IProvider compatible with Gemini's ContentGenerator interface
 */
export class GeminiCompatibleWrapper {
  constructor(private readonly provider: Provider) {}

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
    const messages = this.convertContentsToMessages(params.contents);
    console.debug(
      '[GeminiCompatibleWrapper] Converted messages:',
      JSON.stringify(messages, null, 2),
    );

    // Extract tools from config if available
    const tools = (params.config as { tools?: ProviderTool[] })?.tools || undefined;
    if (tools) {
      console.debug('[GeminiCompatibleWrapper] Tools provided:', tools.length);
    }

    // Stream from provider and convert each chunk
    const stream = this.provider.generateChatCompletion(messages, tools);

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
        for (const toolCall of message.tool_calls) {
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
      }
    }
  }

  /**
   * Convert Gemini ContentListUnion to provider ProviderMessage array
   */
  private convertContentsToMessages(contents: ContentListUnion): ProviderMessage[] {
    // Normalize ContentListUnion to Content[]
    let contentArray: Content[];

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

    return contentArray.map((content) => {
      // Combine all text parts into a single content string
      const textParts = (content.parts || [])
        .filter((part): part is Part & { text: string } => 'text' in part)
        .map((part) => part.text);
      const combinedText = textParts.join('');

      // Map Gemini roles to provider roles
      const role = content.role === 'model' ? 'assistant' : content.role;

      return {
        role: role as 'user' | 'assistant' | 'system',
        content: combinedText,
      };
    });
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
