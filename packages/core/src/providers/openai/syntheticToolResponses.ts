/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IMessage, ContentGeneratorRole } from '../../index.js';
import { DebugLogger } from '../../debug/DebugLogger.js';

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
// Create logger instance for this module
const logger = new DebugLogger('llxprt:providers:openai:synthetic');

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
          // Use simpler content format for better compatibility with strict providers
          // Fireworks and Cerebras may reject complex JSON structures
          content: 'Tool execution cancelled by user',
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
    const syntheticResponseIds = new Set<string>();

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

    // Collect all tool response IDs (including synthetic ones)
    messages.forEach((msg) => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResponseIds.add(msg.tool_call_id);

        // Track synthetic responses separately for debugging
        if (
          (msg as IMessage & { _synthetic?: boolean })._synthetic ||
          msg.content === 'Tool execution cancelled by user'
        ) {
          syntheticResponseIds.add(msg.tool_call_id);
        }
      }
    });

    // Log if we found existing synthetic responses
    if (syntheticResponseIds.size > 0) {
      logger.debug(
        () =>
          `Found ${syntheticResponseIds.size} existing synthetic responses: ${Array.from(syntheticResponseIds).join(', ')}`,
      );
    }

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
    logger.debug(
      () => `patchMessageHistory called with ${messages.length} messages`,
    );
    logger.debug(
      () =>
        `Message roles: ${messages.map((m) => `${m.role}${m.tool_calls ? `(${m.tool_calls.length} tools)` : ''}${m.tool_call_id ? `(response to ${m.tool_call_id})` : ''}`).join(', ')}`,
    );

    // First identify missing tool responses from original messages
    const missingToolIds = this.identifyMissingToolResponses(messages);
    logger.debug(() => `Missing tool IDs: ${JSON.stringify(missingToolIds)}`);

    // Always create a deep copy to avoid mutation issues with immutable objects
    // This is critical for Cerebras/Qwen which may have JSONResponse objects
    const deepCopyMessages: IMessage[] = messages.map((msg) => {
      const copiedMsg: IMessage = {
        role: msg.role,
        content: msg.content,
      };

      // Copy optional properties if they exist
      if (msg.tool_call_id !== undefined)
        copiedMsg.tool_call_id = msg.tool_call_id;
      if (msg.id !== undefined) copiedMsg.id = msg.id;
      if (msg.usage !== undefined) copiedMsg.usage = { ...msg.usage };

      // Deep copy tool_calls if they exist
      if (msg.tool_calls) {
        copiedMsg.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      // Copy any additional properties that might exist (like _synthetic, _cancelled)
      // These are added by our synthetic response handler
      // Use Object.assign to preserve any extra properties without type errors
      Object.assign(copiedMsg, {
        ...('_synthetic' in msg
          ? {
              _synthetic: (msg as IMessage & { _synthetic?: boolean })
                ._synthetic,
            }
          : {}),
        ...('_cancelled' in msg
          ? {
              _cancelled: (msg as IMessage & { _cancelled?: boolean })
                ._cancelled,
            }
          : {}),
        ...('name' in msg
          ? { name: (msg as IMessage & { name?: string }).name }
          : {}),
      });

      return copiedMsg;
    });

    if (missingToolIds.length === 0) {
      return deepCopyMessages;
    }

    // Find the last assistant message with tool calls
    let lastAssistantIndex = -1;
    for (let i = deepCopyMessages.length - 1; i >= 0; i--) {
      if (
        deepCopyMessages[i].role === 'assistant' &&
        deepCopyMessages[i].tool_calls
      ) {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) {
      return deepCopyMessages;
    }

    // Extract tool names from the assistant message
    const toolNameMap = new Map<string, string>();
    const assistantMsg = deepCopyMessages[lastAssistantIndex];
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
    logger.debug(
      () => `Created ${syntheticResponses.length} synthetic responses`,
    );
    syntheticResponses.forEach((sr) => {
      logger.debug(
        () =>
          `Synthetic response: ${JSON.stringify({
            role: sr.role,
            tool_call_id: sr.tool_call_id,
            content: sr.content,
            _synthetic: (sr as IMessage & { _synthetic?: boolean })._synthetic,
            _cancelled: (sr as IMessage & { _cancelled?: boolean })._cancelled,
          })}`,
      );
    });

    // Insert synthetic responses right after the assistant message
    deepCopyMessages.splice(lastAssistantIndex + 1, 0, ...syntheticResponses);
    logger.debug(
      () => `Final message count after patching: ${deepCopyMessages.length}`,
    );

    return deepCopyMessages;
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
