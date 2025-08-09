/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCall } from '../types.js';

/**
 * Utility class for extracting content and tool calls from provider-specific streaming responses
 */
export class ProviderContentExtractor {
  /**
   * Extract text content from a streaming chunk based on provider format
   */
  extractContentFromChunk(chunk: unknown): string {
    if (!chunk || typeof chunk !== 'object') {
      return '';
    }

    try {
      // Handle Gemini format
      if (
        'candidates' in chunk &&
        Array.isArray((chunk as Record<string, unknown>).candidates)
      ) {
        return this.extractGeminiContent(chunk);
      }

      // Handle OpenAI format
      if (
        'choices' in chunk &&
        Array.isArray((chunk as Record<string, unknown>).choices)
      ) {
        return this.extractOpenAIContent(chunk);
      }

      // Handle Anthropic format
      if ('type' in chunk) {
        return this.extractAnthropicContent(chunk as Record<string, unknown>);
      }

      // Fallback: try to extract any text content
      return this.extractGenericContent(chunk as Record<string, unknown>);
    } catch (error) {
      console.warn('Error extracting content from chunk:', error);
      return '';
    }
  }

  /**
   * Extract tool calls from a streaming chunk based on provider format
   */
  extractToolCallsFromChunk(chunk: unknown): ToolCall[] {
    if (!chunk || typeof chunk !== 'object') {
      return [];
    }

    try {
      // Handle Gemini function calls
      if ('candidates' in chunk) {
        return this.extractGeminiToolCalls(chunk as Record<string, unknown>);
      }

      // Handle OpenAI function calls
      if ('choices' in chunk) {
        return this.extractOpenAIToolCalls(chunk as Record<string, unknown>);
      }

      // Handle Anthropic tool use
      if ('type' in chunk) {
        return this.extractAnthropicToolCalls(chunk as Record<string, unknown>);
      }

      return [];
    } catch (error) {
      console.warn('Error extracting tool calls from chunk:', error);
      return [];
    }
  }

  private extractGeminiContent(chunk: Record<string, unknown>): string {
    const candidates = chunk.candidates as Array<Record<string, unknown>>;
    const candidate = candidates?.[0];
    if (!candidate) return '';

    // Handle text content
    const content = candidate.content as Record<string, unknown>;
    const parts = content?.parts as Array<Record<string, unknown>>;
    if (parts) {
      const textParts = parts
        .filter((part: Record<string, unknown>) => part.text)
        .map((part: Record<string, unknown>) => part.text as string);
      return textParts.join('');
    }

    return '';
  }

  private extractOpenAIContent(chunk: Record<string, unknown>): string {
    const choices = chunk.choices as Array<Record<string, unknown>>;
    const choice = choices?.[0];
    if (!choice) return '';

    // Handle streaming content
    const delta = choice.delta as Record<string, unknown>;
    if (delta?.content) {
      return delta.content as string;
    }

    // Handle complete content
    const message = choice.message as Record<string, unknown>;
    if (message?.content) {
      return message.content as string;
    }

    return '';
  }

  private extractAnthropicContent(chunk: Record<string, unknown>): string {
    // Handle different Anthropic event types
    switch (chunk.type) {
      case 'content_block_delta': {
        const delta = chunk.delta as Record<string, unknown>;
        return (delta?.text as string) || '';
      }
      case 'content_block_start': {
        const contentBlock = chunk.content_block as Record<string, unknown>;
        return (contentBlock?.text as string) || '';
      }
      case 'message_delta': {
        const delta = chunk.delta as Record<string, unknown>;
        return (delta?.text as string) || '';
      }
      default:
        return '';
    }
  }

  private extractGenericContent(chunk: Record<string, unknown>): string {
    // Try common content patterns
    if (chunk.text) return chunk.text as string;
    if (chunk.content) return chunk.content as string;
    if (chunk.message) return chunk.message as string;
    const delta = chunk.delta as Record<string, unknown>;
    if (delta?.text) return delta.text as string;

    return '';
  }

  private extractGeminiToolCalls(chunk: Record<string, unknown>): ToolCall[] {
    const candidates = chunk.candidates as Array<Record<string, unknown>>;
    const candidate = candidates?.[0];
    if (!candidate) return [];
    const content = candidate.content as Record<string, unknown>;
    const parts = content?.parts as Array<Record<string, unknown>>;
    if (!parts) return [];

    return parts
      .filter((part: Record<string, unknown>) => part.functionCall)
      .map((part: Record<string, unknown>) => ({
        provider: 'gemini',
        name: (part.functionCall as Record<string, unknown>).name as string,
        arguments: (part.functionCall as Record<string, unknown>).args,
        id:
          ((part.functionCall as Record<string, unknown>).id as string) ||
          this.generateToolCallId(),
      }));
  }

  private extractOpenAIToolCalls(chunk: Record<string, unknown>): ToolCall[] {
    const choices = chunk.choices as Array<Record<string, unknown>>;
    const choice = choices?.[0];
    if (!choice) return [];

    // Handle streaming tool calls
    const delta = choice.delta as Record<string, unknown>;
    const toolCalls = delta?.tool_calls as Array<Record<string, unknown>>;
    if (toolCalls) {
      return toolCalls.map((call: Record<string, unknown>) => ({
        provider: 'openai',
        name: (call.function as Record<string, unknown>)?.name as string,
        arguments: (call.function as Record<string, unknown>)?.arguments,
        id: call.id as string,
      }));
    }

    // Handle complete tool calls
    const message = choice.message as Record<string, unknown>;
    const messageToolCalls = message?.tool_calls as Array<
      Record<string, unknown>
    >;
    if (messageToolCalls) {
      return messageToolCalls.map((call: Record<string, unknown>) => ({
        provider: 'openai',
        name: (call.function as Record<string, unknown>).name as string,
        arguments: JSON.parse(
          ((call.function as Record<string, unknown>).arguments as string) ||
            '{}',
        ),
        id: call.id as string,
      }));
    }

    return [];
  }

  private extractAnthropicToolCalls(
    chunk: Record<string, unknown>,
  ): ToolCall[] {
    if (chunk.type === 'tool_use') {
      return [
        {
          provider: 'anthropic',
          name: chunk.name as string,
          arguments: chunk.input,
          id: chunk.id as string,
        },
      ];
    }

    return [];
  }

  private generateToolCallId(): string {
    return `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
