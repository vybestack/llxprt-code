/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IContent,
  type ToolCallBlock,
  type ToolResponseBlock,
} from '../../services/history/IContent.js';
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
  ): IContent[] {
    return cancelledTools.map((tool) => ({
      speaker: 'tool' as const,
      blocks: [
        {
          type: 'tool_response',
          callId: tool.toolCallId,
          toolName: tool.toolName || 'unknown',
          result: 'Tool execution cancelled by user',
          error: 'Cancelled by user',
        } as ToolResponseBlock,
      ],
      metadata: {
        synthetic: true,
        reason: 'cancelled_by_user',
      },
    }));
  }

  /**
   * Identifies tool calls that need synthetic responses by comparing
   * assistant messages with tool_calls against existing tool responses
   * @param messages The conversation history
   * @returns Array of tool call IDs that need synthetic responses
   */
  static identifyMissingToolResponses(messages: IContent[]): string[] {
    const toolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();
    const syntheticResponseIds = new Set<string>();

    // Collect all tool call IDs from AI messages
    messages.forEach((msg) => {
      if (msg.speaker === 'ai') {
        msg.blocks.forEach((block) => {
          if (block.type === 'tool_call') {
            const toolCallBlock = block as ToolCallBlock;
            if (toolCallBlock.id) {
              toolCallIds.add(toolCallBlock.id);
            }
          }
        });
      }
    });

    // Collect all tool response IDs (including synthetic ones)
    messages.forEach((msg) => {
      if (msg.speaker === 'tool') {
        msg.blocks.forEach((block) => {
          if (block.type === 'tool_response') {
            const toolResponseBlock = block as ToolResponseBlock;
            toolResponseIds.add(toolResponseBlock.callId);

            // Track synthetic responses separately for debugging
            if (
              msg.metadata?.synthetic ||
              toolResponseBlock.result === 'Tool execution cancelled by user'
            ) {
              syntheticResponseIds.add(toolResponseBlock.callId);
            }
          }
        });
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
  static patchMessageHistory(messages: IContent[]): IContent[] {
    // Defensive: normalize any malformed call IDs in history so downstream
    // providers always see canonical hist_tool_* IDs.
    //
    // We have seen cases where a cancellation path injects a tool response with
    // callId like "call_..." (or other non-hist IDs). If that callId isn't
    // normalized consistently with the corresponding tool_call.id, the next
    // /responses request can 400 because a function_call_output references a
    // call_id that has no matching function_call.
    //
    // Since IContent canonical storage is hist_tool_*, normalize both tool_call
    // and tool_response IDs to hist_tool_* up-front.
    const normalizedMessages: IContent[] = messages.map((msg) => ({
      ...msg,
      blocks: msg.blocks.map((block) => {
        if (block.type === 'tool_call') {
          const tc = block as ToolCallBlock;
          const id = tc.id;
          if (!id) return tc;
          if (id.startsWith('hist_tool_')) return tc;

          if (id.startsWith('call_')) {
            return {
              ...tc,
              id: `hist_tool_${id.substring('call_'.length)}`,
            } as ToolCallBlock;
          }

          if (id.startsWith('toolu_')) {
            return {
              ...tc,
              id: `hist_tool_${id.substring('toolu_'.length)}`,
            } as ToolCallBlock;
          }

          return { ...tc, id: `hist_tool_${id}` } as ToolCallBlock;
        }
        if (block.type === 'tool_response') {
          const tr = block as ToolResponseBlock;
          const callId = tr.callId;
          if (callId.startsWith('hist_tool_')) return tr;

          if (callId.startsWith('call_')) {
            return {
              ...tr,
              callId: `hist_tool_${callId.substring('call_'.length)}`,
            } as ToolResponseBlock;
          }
          if (callId.startsWith('toolu_')) {
            return {
              ...tr,
              callId: `hist_tool_${callId.substring('toolu_'.length)}`,
            } as ToolResponseBlock;
          }

          return { ...tr, callId: `hist_tool_${callId}` } as ToolResponseBlock;
        }
        return block;
      }),
    }));

    logger.debug(
      () =>
        `patchMessageHistory called with ${normalizedMessages.length} messages`,
    );
    logger.debug(
      () =>
        `Message speakers: ${normalizedMessages
          .map((m) => {
            const toolCalls = m.blocks.filter(
              (b) => b.type === 'tool_call',
            ).length;
            const toolResponses = m.blocks.filter(
              (b) => b.type === 'tool_response',
            ).length;
            return `${m.speaker}${toolCalls > 0 ? `(${toolCalls} tools)` : ''}${toolResponses > 0 ? `(${toolResponses} responses)` : ''}`;
          })
          .join(', ')}`,
    );

    // First identify missing tool responses from normalized messages
    const missingToolIds =
      this.identifyMissingToolResponses(normalizedMessages);
    logger.debug(() => `Missing tool IDs: ${JSON.stringify(missingToolIds)}`);

    // Always create a deep copy to avoid mutation issues with immutable objects
    const deepCopyMessages: IContent[] = normalizedMessages.map((msg) => ({
      speaker: msg.speaker,
      blocks: msg.blocks.map((block) => {
        // Deep copy each block
        if (block.type === 'tool_call') {
          const tcBlock = block as ToolCallBlock;
          return {
            type: 'tool_call',
            id: tcBlock.id,
            name: tcBlock.name,
            parameters: JSON.parse(JSON.stringify(tcBlock.parameters)),
            description: tcBlock.description,
          } as ToolCallBlock;
        } else if (block.type === 'tool_response') {
          const trBlock = block as ToolResponseBlock;
          return {
            type: 'tool_response',
            callId: trBlock.callId,
            toolName: trBlock.toolName,
            result: JSON.parse(JSON.stringify(trBlock.result)),
            error: trBlock.error,
            isComplete: trBlock.isComplete,
          } as ToolResponseBlock;
        } else {
          // For other block types, use structured cloning
          return JSON.parse(JSON.stringify(block));
        }
      }),
      metadata: msg.metadata
        ? JSON.parse(JSON.stringify(msg.metadata))
        : undefined,
    }));

    if (missingToolIds.length === 0) {
      return deepCopyMessages;
    }

    // Find the last AI message with tool calls
    let lastAIIndex = -1;
    for (let i = deepCopyMessages.length - 1; i >= 0; i--) {
      if (
        deepCopyMessages[i].speaker === 'ai' &&
        deepCopyMessages[i].blocks.some((b) => b.type === 'tool_call')
      ) {
        lastAIIndex = i;
        break;
      }
    }

    if (lastAIIndex === -1) {
      return deepCopyMessages;
    }

    // Extract tool names from the AI message
    const toolNameMap = new Map<string, string>();
    const aiMsg = deepCopyMessages[lastAIIndex];
    aiMsg.blocks.forEach((block) => {
      if (block.type === 'tool_call') {
        const toolCallBlock = block as ToolCallBlock;
        if (toolCallBlock.id && toolCallBlock.name) {
          toolNameMap.set(toolCallBlock.id, toolCallBlock.name);
        }
      }
    });

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
            speaker: sr.speaker,
            blocks: sr.blocks,
            synthetic: sr.metadata?.synthetic,
          })}`,
      );
    });

    // Insert synthetic responses right after the AI message
    deepCopyMessages.splice(lastAIIndex + 1, 0, ...syntheticResponses);
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
    messages: IContent[],
    cancelledCount: number,
  ): IContent[] {
    const notice: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: `${cancelledCount} tool execution${cancelledCount > 1 ? 's were' : ' was'} cancelled. You can retry specific tools or continue with the conversation.`,
        },
      ],
    };

    return [...messages, notice];
  }
}
