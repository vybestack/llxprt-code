/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IMessage, ContentGeneratorRole } from '../../index.js';

/**
 * Interface for cancelled tool information
 */
export interface CancelledToolInfo {
  toolCallId: string;
  toolName?: string;
  timestamp?: string;
}

/**
 * Creates synthetic tool responses for cancelled tool calls to maintain
 * API compliance with OpenAI's Responses format requirements.
 *
 * The OpenAI API requires that every tool_call in an assistant message
 * must have a corresponding tool message with matching tool_call_id.
 * When tools are cancelled (e.g., via ESC key), we need to create
 * synthetic responses to satisfy this requirement.
 */
export class SyntheticToolResponseHandler {
  /**
   * Creates synthetic tool responses for cancelled tools
   * @param cancelledTools Array of cancelled tool information
   * @returns Array of synthetic tool response messages
   */
  static createSyntheticResponses(
    cancelledTools: CancelledToolInfo[],
  ): IMessage[] {
    return cancelledTools.map(
      (tool) =>
        ({
          role: 'tool' as const,
          tool_call_id: tool.toolCallId,
          content: JSON.stringify({
            status: 'cancelled',
            message: 'Tool execution cancelled by user',
            error_type: 'user_interruption',
            tool_name: tool.toolName,
            timestamp: tool.timestamp || new Date().toISOString(),
          }),
          // Mark as synthetic for debugging/filtering
          _synthetic: true,
          _cancelled: true,
        }) as IMessage,
    );
  }

  /**
   * Identifies tool calls that need synthetic responses by comparing
   * assistant messages with tool_calls against existing tool responses
   * @param messages The conversation history
   * @returns Array of tool call IDs that need synthetic responses
   */
  static identifyMissingToolResponses(messages: IMessage[]): string[] {
    const toolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();

    // Collect all tool call IDs from assistant messages
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.forEach((toolCall) => {
          if (toolCall.id) {
            toolCallIds.add(toolCall.id);
          }
        });
      }
    });

    // Collect all tool response IDs
    messages.forEach((msg) => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResponseIds.add(msg.tool_call_id);
      }
    });

    // Find tool calls without responses
    const missingIds: string[] = [];
    toolCallIds.forEach((id) => {
      if (!toolResponseIds.has(id)) {
        missingIds.push(id);
      }
    });

    return missingIds;
  }

  /**
   * Patches a message history to include synthetic responses for any
   * tool calls that don't have corresponding tool responses
   * @param messages The original message history
   * @returns Patched message history with synthetic responses added
   */
  static patchMessageHistory(messages: IMessage[]): IMessage[] {
    const missingToolIds = this.identifyMissingToolResponses(messages);

    if (missingToolIds.length === 0) {
      return messages;
    }

    // Find the last assistant message with tool calls
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].tool_calls) {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) {
      return messages;
    }

    // Extract tool names from the assistant message
    const toolNameMap = new Map<string, string>();
    const assistantMsg = messages[lastAssistantIndex];
    if (assistantMsg.tool_calls) {
      assistantMsg.tool_calls.forEach((toolCall) => {
        if (toolCall.id && toolCall.function?.name) {
          toolNameMap.set(toolCall.id, toolCall.function.name);
        }
      });
    }

    // Create synthetic responses with tool names
    const cancelledTools: CancelledToolInfo[] = missingToolIds.map((id) => ({
      toolCallId: id,
      toolName: toolNameMap.get(id),
    }));

    const syntheticResponses = this.createSyntheticResponses(cancelledTools);

    // Insert synthetic responses right after the assistant message
    const patchedMessages = [...messages];
    patchedMessages.splice(lastAssistantIndex + 1, 0, ...syntheticResponses);

    return patchedMessages;
  }

  /**
   * Adds a user-facing cancellation notice to the message history
   * @param messages The message history
   * @param cancelledCount Number of tools that were cancelled
   * @returns Message history with cancellation notice added
   */
  static addCancellationNotice(
    messages: IMessage[],
    cancelledCount: number,
  ): IMessage[] {
    const notice: IMessage = {
      role: ContentGeneratorRole.ASSISTANT,
      content: `${cancelledCount} tool execution${cancelledCount > 1 ? 's were' : ' was'} cancelled. You can retry specific tools or continue with the conversation.`,
    };

    return [...messages, notice];
  }
}
