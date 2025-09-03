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

import type { IMessage } from '../../providers/IMessage.js';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from './IContent.js';
import { ContentGeneratorRole } from '../../providers/ContentGeneratorRole.js';
import { ContentConverters } from './ContentConverters.js';
import { DebugLogger } from '../../debug/index.js';

/**
 * Extended ToolCallBlock interface to store original provider ID
 */
interface ExtendedToolCallBlock extends ToolCallBlock {
  originalId?: string; // Store original provider ID for reverse mapping
}

/**
 * Converts between IMessage (OpenAI/Anthropic format) and IContent (history format).
 * Implements tool ID normalization to prevent provider switching issues.
 */
export class MessageConverters {
  private static logger = new DebugLogger('llxprt:message-converters');

  /**
   * Normalize any tool ID to history format (hist_tool_*)
   * This ensures consistent ID format across all providers
   */
  private static normalizeToolId(
    id: string | undefined,
    generateId?: () => string,
  ): string {
    if (!id) {
      // No ID provided, generate a new one
      return generateId
        ? generateId()
        : `hist_tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // If already normalized, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // Convert provider-specific formats to normalized format
    // Just replace the prefix with hist_tool_
    if (id.startsWith('call_')) {
      return id.replace('call_', 'hist_tool_');
    } else if (id.startsWith('toolu_')) {
      return id.replace('toolu_', 'hist_tool_');
    } else {
      // For SHORT IDs or unknown formats, prefix with hist_tool_
      return `hist_tool_${id}`;
    }
  }

  /**
   * Convert IMessage to IContent with history IDs
   * @param message - The provider message to convert
   * @param provider - Provider name ('openai', 'anthropic', 'gemini')
   * @param generateId - Optional callback to generate history IDs (from HistoryService)
   */
  static toIContent(
    message: IMessage,
    provider: string,
    generateId?: () => string,
  ): IContent {
    // Determine speaker based on role
    let speaker: 'human' | 'ai' | 'tool';
    if (
      message.role === ContentGeneratorRole.USER ||
      message.role === 'system'
    ) {
      speaker = 'human'; // System messages are treated as human for history purposes
    } else if (message.role === ContentGeneratorRole.ASSISTANT) {
      speaker = 'ai';
    } else if (message.role === ContentGeneratorRole.TOOL) {
      speaker = 'tool';
    } else {
      // Default fallback
      speaker = 'ai';
    }

    const blocks: ContentBlock[] = [];

    // Add text content if present (but not for tool messages)
    if (message.content && message.content.trim() && speaker !== 'tool') {
      const textBlock: TextBlock = {
        type: 'text',
        text: message.content,
      };
      blocks.push(textBlock);
    }

    // Handle tool calls (from AI messages)
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        // Normalize the tool call ID to history format
        const historyId = this.normalizeToolId(toolCall.id, generateId);

        // Parse parameters
        let parameters: unknown = {};
        try {
          parameters = JSON.parse(toolCall.function.arguments);
        } catch (_error) {
          this.logger.debug(
            `Failed to parse tool call arguments: ${toolCall.function.arguments}`,
          );
          parameters = { raw_arguments: toolCall.function.arguments };
        }

        const toolCallBlock: ExtendedToolCallBlock = {
          type: 'tool_call',
          id: historyId,
          name: toolCall.function.name,
          parameters,
          originalId: toolCall.id, // Store original for reference
        };

        blocks.push(toolCallBlock);
      }
    }

    // Handle tool responses (from tool messages)
    // Note: Gemini may send empty string for tool_call_id, so check role instead
    if (speaker === 'tool' && message.role === 'tool') {
      // Normalize the tool response ID to match the call
      const callId = this.normalizeToolId(message.tool_call_id, generateId);

      const toolResponseBlock: ToolResponseBlock = {
        type: 'tool_response',
        callId,
        toolName: message.tool_name || 'unknown',
        result: message.content,
      };

      blocks.push(toolResponseBlock);
    }

    return {
      speaker,
      blocks,
      metadata: {
        provider,
        usage: message.usage
          ? {
              promptTokens: message.usage.prompt_tokens,
              completionTokens: message.usage.completion_tokens,
              totalTokens: message.usage.total_tokens,
            }
          : undefined,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Convert IContent to OpenAI format with simple ID transformation
   * @param content - The IContent to convert
   * @param idMap - Optional map from history IDs to provider IDs (for backwards compatibility)
   */
  static toOpenAIMessage(
    content: IContent,
    idMap?: Map<string, string>,
  ): IMessage {
    // Determine role
    let role: ContentGeneratorRole | 'system';
    if (content.speaker === 'human') {
      role = ContentGeneratorRole.USER;
    } else if (content.speaker === 'ai') {
      role = ContentGeneratorRole.ASSISTANT;
    } else if (content.speaker === 'tool') {
      role = ContentGeneratorRole.TOOL;
    } else {
      role = 'system';
    }

    // Build message content
    let messageContent = '';
    const toolCalls: IMessage['tool_calls'] = [];
    let toolCallId: string | undefined;
    let toolName: string | undefined;

    for (const block of content.blocks) {
      switch (block.type) {
        case 'text':
          messageContent += block.text;
          break;

        case 'tool_call': {
          const toolCallBlock = block as ToolCallBlock;

          // CRITICAL BUG FIX: Simple format transformation, not complex mapping
          // Transform hist_tool_* to call_* for OpenAI
          let openAIId: string;
          if (idMap) {
            // Use provided mapping if available (backwards compatibility)
            const mappedId = idMap.get(toolCallBlock.id);
            openAIId = mappedId || this.transformToOpenAIId(toolCallBlock.id);
          } else {
            // Simple transformation: hist_tool_* -> call_*
            openAIId = this.transformToOpenAIId(toolCallBlock.id);
          }

          toolCalls.push({
            id: openAIId,
            type: 'function',
            function: {
              name: toolCallBlock.name,
              arguments: JSON.stringify(toolCallBlock.parameters),
            },
          });
          break;
        }

        case 'tool_response': {
          const toolResponseBlock = block as ToolResponseBlock;
          // Transform hist_tool_* to call_* for OpenAI
          let openAIId: string;
          if (idMap && idMap.has(toolResponseBlock.callId)) {
            openAIId = idMap.get(toolResponseBlock.callId)!;
          } else {
            openAIId = this.transformToOpenAIId(toolResponseBlock.callId);
          }
          toolCallId = openAIId;
          toolName = toolResponseBlock.toolName;
          if (typeof toolResponseBlock.result === 'string') {
            messageContent += toolResponseBlock.result;
          } else {
            messageContent += JSON.stringify(toolResponseBlock.result);
          }
          break;
        }

        case 'code':
          messageContent += `\`\`\`${block.language || ''}\n${block.code}\n\`\`\``;
          break;

        case 'thinking':
          // Skip thinking blocks in OpenAI format
          break;

        default:
          // Skip unknown block types
          break;
      }
    }

    const message: IMessage = {
      role,
      content: messageContent,
      usage: content.metadata?.usage
        ? {
            prompt_tokens: content.metadata.usage.promptTokens,
            completion_tokens: content.metadata.usage.completionTokens,
            total_tokens: content.metadata.usage.totalTokens,
          }
        : undefined,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    if (toolCallId) {
      message.tool_call_id = toolCallId;
    }

    if (toolName) {
      message.tool_name = toolName;
    }

    return message;
  }

  /**
   * Transform history ID to OpenAI format
   * Simple deterministic transformation: hist_tool_* -> call_*
   */
  private static transformToOpenAIId(historyId: string): string {
    if (!historyId || historyId === '') {
      // Generate a new OpenAI-style ID if empty
      return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Simple transformation: replace hist_tool_ prefix with call_
    if (historyId.startsWith('hist_tool_')) {
      // Use a hash of the history ID for deterministic transformation
      const suffix = historyId.substring('hist_tool_'.length);
      return `call_${suffix}`;
    }

    // If already in OpenAI format, return as-is
    if (historyId.startsWith('call_')) {
      return historyId;
    }

    // Fallback: prefix with call_
    return `call_${historyId}`;
  }

  /**
   * Transform history ID to Anthropic format
   * Simple deterministic transformation: hist_tool_* -> toolu_*
   */
  private static transformToAnthropicId(historyId: string): string {
    if (!historyId || historyId === '') {
      // Generate a new Anthropic-style ID if empty
      return `toolu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Simple transformation: replace hist_tool_ prefix with toolu_
    if (historyId.startsWith('hist_tool_')) {
      // Use a hash of the history ID for deterministic transformation
      const suffix = historyId.substring('hist_tool_'.length);
      return `toolu_${suffix}`;
    }

    // If already in Anthropic format, return as-is
    if (historyId.startsWith('toolu_')) {
      return historyId;
    }

    // Fallback: prefix with toolu_
    return `toolu_${historyId}`;
  }

  /**
   * Convert IContent to Gemini format
   * Simply uses ContentConverters since Gemini is the base format
   * @param content - The IContent to convert
   */
  static toGeminiMessage(content: IContent): unknown {
    // For Gemini, we can use ContentConverters directly
    // since it already handles IContent -> Gemini conversion
    return ContentConverters.toGeminiContent(content);
  }

  /**
   * Convert IContent to Anthropic format
   * @param content - The IContent to convert
   * @param idMap - Optional map from history IDs to provider IDs (for backwards compatibility)
   */
  static toAnthropicMessage(
    content: IContent,
    idMap?: Map<string, string>,
  ): IMessage {
    // Build message content and structure similar to OpenAI
    const role: ContentGeneratorRole | 'system' =
      content.speaker === 'human'
        ? ContentGeneratorRole.USER
        : content.speaker === 'ai'
          ? ContentGeneratorRole.ASSISTANT
          : content.speaker === 'tool'
            ? ContentGeneratorRole.USER // Anthropic uses 'user' for tool results
            : content.speaker === 'system'
              ? 'system'
              : ContentGeneratorRole.USER;

    // For Anthropic, we need to build content array
    const anthropicContent: unknown[] = [];
    let toolCallId: string | undefined;

    for (const block of content.blocks) {
      switch (block.type) {
        case 'text':
          anthropicContent.push({
            type: 'text',
            text: block.text,
          });
          break;

        case 'tool_call': {
          const toolCallBlock = block as ToolCallBlock;
          // Transform hist_tool_* to toolu_* for Anthropic
          let anthropicId: string;
          if (idMap && idMap.has(toolCallBlock.id)) {
            anthropicId = idMap.get(toolCallBlock.id)!;
          } else {
            anthropicId = this.transformToAnthropicId(toolCallBlock.id);
          }

          anthropicContent.push({
            type: 'tool_use',
            id: anthropicId,
            name: toolCallBlock.name,
            input: toolCallBlock.parameters,
          });
          break;
        }

        case 'tool_response': {
          const toolResponseBlock = block as ToolResponseBlock;
          // Transform hist_tool_* to toolu_* for Anthropic
          let anthropicId: string;
          if (idMap && idMap.has(toolResponseBlock.callId)) {
            anthropicId = idMap.get(toolResponseBlock.callId)!;
          } else {
            anthropicId = this.transformToAnthropicId(toolResponseBlock.callId);
          }

          anthropicContent.push({
            type: 'tool_result',
            tool_use_id: anthropicId,
            content:
              typeof toolResponseBlock.result === 'string'
                ? toolResponseBlock.result
                : JSON.stringify(toolResponseBlock.result),
          });
          toolCallId = anthropicId; // Store for message-level field
          break;
        }

        case 'code':
          anthropicContent.push({
            type: 'text',
            text: `\`\`\`${block.language || ''}\n${block.code}\n\`\`\``,
          });
          break;

        default:
          // Skip unknown block types
          break;
      }
    }

    const message: IMessage = {
      role,
      content: anthropicContent as unknown as string, // Type assertion for IMessage compatibility
      usage: content.metadata?.usage
        ? {
            prompt_tokens: content.metadata.usage.promptTokens,
            completion_tokens: content.metadata.usage.completionTokens,
            total_tokens: content.metadata.usage.totalTokens,
          }
        : undefined,
    };

    // Add tool_call_id at message level if this is a tool response
    if (content.speaker === 'tool' && toolCallId) {
      message.tool_call_id = toolCallId;
    }

    return message;
  }
}
