/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IContent,
  type ContentBlock,
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

// Create logger instance for this module
const logger = new DebugLogger('llxprt:providers:openai:synthetic');

function normalizeToolCallId(id: string): string {
  if (!id) return id;
  if (id.startsWith('hist_tool_')) return id;
  if (id.startsWith('call_')) {
    return `hist_tool_${id.substring('call_'.length)}`;
  }
  if (id.startsWith('toolu_')) {
    return `hist_tool_${id.substring('toolu_'.length)}`;
  }
  return `hist_tool_${id}`;
}

function normalizeToolResponseCallId(callId: string): string {
  if (!callId) return callId;
  if (callId.startsWith('hist_tool_')) return callId;
  if (callId.startsWith('call_')) {
    return `hist_tool_${callId.substring('call_'.length)}`;
  }
  if (callId.startsWith('toolu_')) {
    return `hist_tool_${callId.substring('toolu_'.length)}`;
  }
  return `hist_tool_${callId}`;
}

function normalizeToolCallBlock(tc: ToolCallBlock): ToolCallBlock {
  return { ...tc, id: normalizeToolCallId(tc.id) };
}

function normalizeToolResponseBlock(tr: ToolResponseBlock): ToolResponseBlock {
  return { ...tr, callId: normalizeToolResponseCallId(tr.callId) };
}

function normalizeBlockIds(block: ContentBlock): ContentBlock {
  if (block.type === 'tool_call') {
    return normalizeToolCallBlock(block);
  }
  if (block.type === 'tool_response') {
    return normalizeToolResponseBlock(block);
  }
  return block;
}

function normalizeMessageIds(messages: IContent[]): IContent[] {
  return messages.map((msg) => ({
    ...msg,
    blocks: msg.blocks.map(normalizeBlockIds),
  }));
}

function deepCopyToolCallBlock(tcBlock: ToolCallBlock): ToolCallBlock {
  return {
    type: 'tool_call',
    id: tcBlock.id,
    name: tcBlock.name,
    parameters: JSON.parse(JSON.stringify(tcBlock.parameters)),
    description: tcBlock.description,
  };
}

function deepCopyToolResponseBlock(
  trBlock: ToolResponseBlock,
): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId: trBlock.callId,
    toolName: trBlock.toolName,
    result: JSON.parse(JSON.stringify(trBlock.result)),
    error: trBlock.error,
    isComplete: trBlock.isComplete,
  };
}

function deepCopyBlock(block: ContentBlock): ContentBlock {
  if (block.type === 'tool_call') {
    return deepCopyToolCallBlock(block);
  }
  if (block.type === 'tool_response') {
    return deepCopyToolResponseBlock(block);
  }
  return JSON.parse(JSON.stringify(block));
}

function deepCopyMessages(messages: IContent[]): IContent[] {
  return messages.map((msg) => ({
    speaker: msg.speaker,
    blocks: msg.blocks.map(deepCopyBlock),
    metadata: msg.metadata
      ? JSON.parse(JSON.stringify(msg.metadata))
      : undefined,
  }));
}

function logNormalizedMessages(normalizedMessages: IContent[]): void {
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
}

function findLastAiToolCallIndex(messages: IContent[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (
      messages[i].speaker === 'ai' &&
      messages[i].blocks.some((b) => b.type === 'tool_call')
    ) {
      return i;
    }
  }
  return -1;
}

function buildToolNameMap(aiMessage: IContent): Map<string, string> {
  const toolNameMap = new Map<string, string>();
  aiMessage.blocks.forEach((block) => {
    if (block.type === 'tool_call' && block.id && block.name) {
      toolNameMap.set(block.id, block.name);
    }
  });
  return toolNameMap;
}

function collectToolCallIds(messages: IContent[]): Set<string> {
  const toolCallIds = new Set<string>();
  messages.forEach((msg) => {
    if (msg.speaker === 'ai') {
      msg.blocks.forEach((block) => {
        if (block.type === 'tool_call') {
          const toolCallBlock = block;
          if (toolCallBlock.id) {
            toolCallIds.add(toolCallBlock.id);
          }
        }
      });
    }
  });
  return toolCallIds;
}

function collectToolResponseIds(messages: IContent[]): {
  toolResponseIds: Set<string>;
  syntheticResponseIds: Set<string>;
} {
  const toolResponseIds = new Set<string>();
  const syntheticResponseIds = new Set<string>();

  messages.forEach((msg) => {
    if (msg.speaker === 'tool') {
      msg.blocks.forEach((block) => {
        if (block.type === 'tool_response') {
          const toolResponseBlock = block;
          toolResponseIds.add(toolResponseBlock.callId);

          if (
            msg.metadata?.synthetic === true ||
            toolResponseBlock.result === 'Tool execution cancelled by user'
          ) {
            syntheticResponseIds.add(toolResponseBlock.callId);
          }
        }
      });
    }
  });

  return { toolResponseIds, syntheticResponseIds };
}

function logSyntheticResponses(syntheticResponseIds: Set<string>): void {
  if (syntheticResponseIds.size > 0) {
    logger.debug(
      () =>
        `Found ${syntheticResponseIds.size} existing synthetic responses: ${Array.from(syntheticResponseIds).join(', ')}`,
    );
  }
}

function findMissingIds(
  toolCallIds: Set<string>,
  toolResponseIds: Set<string>,
): string[] {
  const missingIds: string[] = [];
  toolCallIds.forEach((id) => {
    if (!toolResponseIds.has(id)) {
      missingIds.push(id);
    }
  });
  return missingIds;
}

function logSyntheticDetails(syntheticResponses: IContent[]): void {
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
}

export class SyntheticToolResponseHandler {
  static createSyntheticResponses(
    cancelledTools: CancelledToolInfo[],
  ): IContent[] {
    return cancelledTools.map((tool) => ({
      speaker: 'tool' as const,
      blocks: [
        {
          type: 'tool_response',
          callId: tool.toolCallId,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: toolName is optional string, empty string should use 'unknown'
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

  static identifyMissingToolResponses(messages: IContent[]): string[] {
    const toolCallIds = collectToolCallIds(messages);
    const { toolResponseIds, syntheticResponseIds } =
      collectToolResponseIds(messages);
    logSyntheticResponses(syntheticResponseIds);
    return findMissingIds(toolCallIds, toolResponseIds);
  }

  static patchMessageHistory(messages: IContent[]): IContent[] {
    const normalizedMessages = normalizeMessageIds(messages);
    logNormalizedMessages(normalizedMessages);

    const missingToolIds =
      this.identifyMissingToolResponses(normalizedMessages);
    logger.debug(() => `Missing tool IDs: ${JSON.stringify(missingToolIds)}`);

    const deepCopy = deepCopyMessages(normalizedMessages);

    if (missingToolIds.length === 0) {
      return deepCopy;
    }

    const lastAIIndex = findLastAiToolCallIndex(deepCopy);
    if (lastAIIndex === -1) {
      return deepCopy;
    }

    const toolNameMap = buildToolNameMap(deepCopy[lastAIIndex]);
    const cancelledTools: CancelledToolInfo[] = missingToolIds.map((id) => ({
      toolCallId: id,
      toolName: toolNameMap.get(id),
    }));

    const syntheticResponses = this.createSyntheticResponses(cancelledTools);
    logSyntheticDetails(syntheticResponses);

    deepCopy.splice(lastAIIndex + 1, 0, ...syntheticResponses);
    logger.debug(
      () => `Final message count after patching: ${deepCopy.length}`,
    );

    return deepCopy;
  }

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
