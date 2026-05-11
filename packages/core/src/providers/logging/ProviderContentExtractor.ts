/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCall } from '../types.js';
import { debugLogger } from '../../utils/debugLogger.js';

/**
 * Utility class for extracting content and tool calls from provider-specific streaming responses
 */
export class ProviderContentExtractor {
  /**
   * Extract text content from a streaming chunk based on provider format
   */
  extractContentFromChunk(chunk: unknown): string {
    if (chunk == null || typeof chunk !== 'object') {
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
      debugLogger.warn('Error extracting content from chunk:', error);
      return '';
    }
  }

  /**
   * Extract tool calls from a streaming chunk based on provider format
   */
  extractToolCallsFromChunk(chunk: unknown): ToolCall[] {
    if (chunk == null || typeof chunk !== 'object') {
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
      debugLogger.warn('Error extracting tool calls from chunk:', error);
      return [];
    }
  }

  /**
   * Extracts a truthy text value, preserving old `(value as string) || ''` semantics.
   * Non-string truthy values pass through (cast to string); false, 0, NaN, '', null, undefined fall through.
   */
  private extractTruthyText(value: unknown): string | undefined {
    const isTruthy = Boolean(value);
    if (!isTruthy) return undefined;
    return value as string;
  }

  private extractGeminiContent(chunk: Record<string, unknown>): string {
    const candidates = chunk.candidates as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const candidate = candidates?.[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (candidate == null) return '';

    // Handle text content
    const content = candidate.content as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const parts = content?.parts as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (parts == null) return '';

    const textParts = parts
      .map((part: Record<string, unknown>) => this.extractTruthyText(part.text))
      .filter((text): text is string => text !== undefined);
    return textParts.join('');
  }

  private extractOpenAIContent(chunk: Record<string, unknown>): string {
    const choices = chunk.choices as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const choice = choices?.[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (choice == null) return '';

    // Handle streaming content
    if (choice.delta != null) {
      const delta = choice.delta as Record<string, unknown>;
      const content = this.extractTruthyText(delta.content);
      if (content !== undefined) {
        return content;
      }
    }

    // Handle complete content
    if (choice.message != null) {
      const message = choice.message as Record<string, unknown>;
      const content = this.extractTruthyText(message.content);
      if (content !== undefined) {
        return content;
      }
    }

    return '';
  }

  private extractDeltaText(chunk: Record<string, unknown>): string {
    const delta = chunk.delta as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    return (delta?.text as string) || '';
  }

  private extractAnthropicContent(chunk: Record<string, unknown>): string {
    // Handle different Anthropic event types
    switch (chunk.type) {
      case 'content_block_delta':
        return this.extractDeltaText(chunk);
      case 'content_block_start': {
        const contentBlock = chunk.content_block as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        return (contentBlock?.text as string) || '';
      }
      case 'message_delta':
        return this.extractDeltaText(chunk);
      default:
        return '';
    }
  }

  private extractGenericContent(chunk: Record<string, unknown>): string {
    // Try common content patterns
    const text = this.extractTruthyText(chunk.text);
    if (text !== undefined) {
      return text;
    }
    const content = this.extractTruthyText(chunk.content);
    if (content !== undefined) {
      return content;
    }
    const message = this.extractTruthyText(chunk.message);
    if (message !== undefined) {
      return message;
    }
    if (chunk.delta != null) {
      const delta = chunk.delta as Record<string, unknown>;
      const deltaText = this.extractTruthyText(delta.text);
      if (deltaText !== undefined) {
        return deltaText;
      }
    }

    return '';
  }

  private extractGeminiToolCalls(chunk: Record<string, unknown>): ToolCall[] {
    const candidates = chunk.candidates as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const candidate = candidates?.[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (candidate == null) return [];
    const content = candidate.content as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const parts = content?.parts as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (parts == null) return [];

    return parts
      .filter((part: Record<string, unknown>) => Boolean(part.functionCall))
      .map((part: Record<string, unknown>) => {
        const functionCall = part.functionCall as Record<string, unknown>;
        const id = functionCall.id as string | null | undefined;
        return {
          provider: 'gemini',
          name: functionCall.name as string,
          arguments: functionCall.args,
          id:
            id !== undefined && id !== null && id !== ''
              ? id
              : this.generateToolCallId(),
        };
      });
  }

  private extractOpenAIToolCalls(chunk: Record<string, unknown>): ToolCall[] {
    const choices = chunk.choices as Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const choice = choices?.[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (choice == null) return [];

    // Handle streaming tool calls
    if (choice.delta != null) {
      const delta = choice.delta as Record<string, unknown>;
      if (delta.tool_calls != null) {
        const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
        return toolCalls.map((call: Record<string, unknown>) => {
          const func = call.function as
            | Record<string, unknown>
            | null
            | undefined;
          return {
            provider: 'openai',
            name: func?.name as string,
            arguments: func?.arguments,
            id: call.id as string,
          };
        });
      }
    }

    // Handle complete tool calls
    if (choice.message != null) {
      const message = choice.message as Record<string, unknown>;
      if (message.tool_calls != null) {
        const messageToolCalls = message.tool_calls as Array<
          Record<string, unknown>
        >;
        return messageToolCalls.map((call: Record<string, unknown>) => {
          const func = call.function as Record<string, unknown>;
          const args = func.arguments as string | null | undefined;
          const parsedArgs =
            args !== undefined && args !== null && args !== '' ? args : '{}';
          return {
            provider: 'openai',
            name: func.name as string,
            arguments: JSON.parse(parsedArgs),
            id: call.id as string,
          };
        });
      }
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
