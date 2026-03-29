/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic Message Validation Module
 * Validates and fixes message sequences for the Anthropic API
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 4 - Part A)
 */

import type {
  AnthropicMessage,
  AnthropicMessageBlock,
  AnthropicMessageContent,
  AnthropicToolResultContent,
} from './AnthropicMessageNormalizer.js';

/**
 * Validates that all tool_result blocks have matching tool_use blocks
 * Removes orphaned tool results that don't match any tool_use
 */
export function validateToolResults(
  messages: AnthropicMessage[],
  logger: { debug: (fn: () => string) => void },
): AnthropicMessage[] {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseIds.add(block.id);
        }
      }
    } else if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  const orphanedResults = Array.from(toolResultIds).filter(
    (id) => !toolUseIds.has(id),
  );
  if (orphanedResults.length > 0) {
    logger.debug(
      () =>
        `Found ${orphanedResults.length} orphaned tool results, removing them`,
    );

    return messages.filter((msg) => {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const filteredContent = msg.content.filter(
          (block) =>
            block.type !== 'tool_result' ||
            !orphanedResults.includes(block.tool_use_id),
        );
        if (filteredContent.length === 0) {
          return false;
        }
        msg.content = filteredContent;
      }
      return true;
    });
  }

  return messages;
}

/**
 * Ensures tool_result blocks immediately follow their corresponding tool_use blocks
 * Reorders or synthesizes missing results as needed
 */
export function enforceToolResultAdjacency(
  messages: AnthropicMessage[],
  logger: { debug: (fn: () => string) => void },
): AnthropicMessage[] {
  const result = [...messages];

  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter(
        (block) => block.type === 'tool_use',
      );

      if (toolUseBlocks.length > 0) {
        enforceAdjacencyForMessage(result, i, toolUseBlocks, logger);
      }
    }
  }

  return result;
}

function enforceAdjacencyForMessage(
  messages: AnthropicMessage[],
  msgIndex: number,
  toolUseBlocks: AnthropicMessageBlock[],
  logger: { debug: (fn: () => string) => void },
): void {
  const toolUseIdsInMessage = toolUseBlocks.map(
    (b) => (b as { id: string }).id,
  );
  const nextMsgIndex = msgIndex + 1;

  if (
    nextMsgIndex < messages.length &&
    messages[nextMsgIndex].role === 'user'
  ) {
    handleAdjacentUserMessage(
      messages,
      msgIndex,
      nextMsgIndex,
      toolUseIdsInMessage,
      logger,
    );
  } else {
    handleMissingUserMessage(
      messages,
      msgIndex,
      nextMsgIndex,
      toolUseIdsInMessage,
      logger,
    );
  }
}

function handleAdjacentUserMessage(
  messages: AnthropicMessage[],
  _msgIndex: number,
  nextMsgIndex: number,
  toolUseIdsInMessage: string[],
  logger: { debug: (fn: () => string) => void },
): void {
  const nextMsg = messages[nextMsgIndex];
  const nextMsgToolResults = Array.isArray(nextMsg.content)
    ? nextMsg.content.filter((b) => b.type === 'tool_result')
    : [];
  const nextMsgToolResultIds = nextMsgToolResults.map(
    (b) => (b as { tool_use_id: string }).tool_use_id,
  );

  const missingToolResultIds = toolUseIdsInMessage.filter(
    (id) => !nextMsgToolResultIds.includes(id),
  );

  if (missingToolResultIds.length > 0) {
    collectAndReorderToolResults(
      messages,
      nextMsgIndex,
      missingToolResultIds,
      nextMsg,
      logger,
    );
  }
}

function collectAndReorderToolResults(
  messages: AnthropicMessage[],
  nextMsgIndex: number,
  missingToolResultIds: string[],
  nextMsg: AnthropicMessage,
  logger: { debug: (fn: () => string) => void },
): void {
  const collectedResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: AnthropicToolResultContent;
    is_error?: boolean;
  }> = [];

  const pendingRemovals: Array<{ msgIndex: number; blockIndex: number }> = [];

  for (const missingId of missingToolResultIds) {
    const foundResult = findToolResultInLaterMessages(
      messages,
      nextMsgIndex,
      missingId,
      pendingRemovals,
    );

    if (foundResult != null) {
      collectedResults.push(foundResult);
    } else {
      collectedResults.push({
        type: 'tool_result',
        tool_use_id: missingId,
        content: '[tool execution interrupted]',
        is_error: true,
      });
    }
  }

  removeCollectedResults(messages, pendingRemovals);

  if (collectedResults.length > 0) {
    logger.debug(
      () =>
        `Reordering ${collectedResults.length} tool_result(s) to immediately follow tool_use`,
    );

    if (Array.isArray(nextMsg.content)) {
      nextMsg.content.unshift(...collectedResults);
    } else {
      const textBlock: { type: 'text'; text: string } = {
        type: 'text',
        text: nextMsg.content,
      };
      nextMsg.content = [...collectedResults, textBlock];
    }
  }
}

function findToolResultInLaterMessages(
  messages: AnthropicMessage[],
  startIndex: number,
  missingId: string,
  pendingRemovals: Array<{ msgIndex: number; blockIndex: number }>,
): {
  type: 'tool_result';
  tool_use_id: string;
  content: AnthropicToolResultContent;
  is_error?: boolean;
} | null {
  for (let j = startIndex + 1; j < messages.length; j++) {
    const laterMsg = messages[j];
    if (laterMsg.role === 'user' && Array.isArray(laterMsg.content)) {
      const resultIdx = laterMsg.content.findIndex(
        (b) =>
          b.type === 'tool_result' &&
          (b as { tool_use_id: string }).tool_use_id === missingId,
      );

      if (resultIdx >= 0) {
        const foundResult = laterMsg.content[resultIdx] as {
          type: 'tool_result';
          tool_use_id: string;
          content: AnthropicToolResultContent;
          is_error?: boolean;
        };
        pendingRemovals.push({ msgIndex: j, blockIndex: resultIdx });
        return foundResult;
      }
    }
  }
  return null;
}

function removeCollectedResults(
  messages: AnthropicMessage[],
  pendingRemovals: Array<{ msgIndex: number; blockIndex: number }>,
): void {
  for (const removal of pendingRemovals.sort(
    (a, b) => b.msgIndex - a.msgIndex || b.blockIndex - a.blockIndex,
  )) {
    const laterMsg = messages[removal.msgIndex];
    if (Array.isArray(laterMsg.content)) {
      laterMsg.content.splice(removal.blockIndex, 1);
      if (laterMsg.content.length === 0) {
        messages.splice(removal.msgIndex, 1);
      }
    }
  }
}

function handleMissingUserMessage(
  messages: AnthropicMessage[],
  _msgIndex: number,
  nextMsgIndex: number,
  toolUseIdsInMessage: string[],
  logger: { debug: (fn: () => string) => void },
): void {
  const currentToolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          currentToolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  const missingToolUseIds = toolUseIdsInMessage.filter(
    (toolUseId) => !currentToolResultIds.has(toolUseId),
  );
  if (missingToolUseIds.length > 0) {
    logger.debug(
      () =>
        `Synthesizing ${missingToolUseIds.length} missing tool_result(s) for orphaned tool_use`,
    );
    messages.splice(nextMsgIndex, 0, {
      role: 'user',
      content: missingToolUseIds.map((toolUseId) => ({
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content: '[tool execution interrupted]',
        is_error: true,
      })),
    });
  }
}

/**
 * Ensures the message sequence follows Anthropic API requirements
 * - Merges consecutive messages of the same role
 * - Ensures sequence starts with user
 * - Ensures no empty messages
 * - Ensures no trailing assistant message when thinking is enabled
 */
export function ensureValidMessageSequence(
  messages: AnthropicMessage[],
  shouldIncludeThinking: boolean,
  logger: { debug: (fn: () => string) => void },
): AnthropicMessage[] {
  let result = [...messages];

  result = mergeConsecutiveMessages(result);
  result = ensureStartsWithUser(result, logger);
  result = ensureNotEmpty(result);
  result = sanitizeEmptyMessages(result);
  result = ensureNoTrailingAssistant(result, shouldIncludeThinking, logger);

  return result;
}

function mergeConsecutiveMessages(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  const toBlocks = (
    content: AnthropicMessageContent,
  ): AnthropicMessageBlock[] =>
    typeof content === 'string'
      ? [{ type: 'text' as const, text: content }]
      : content;

  const merged: AnthropicMessage[] = [];
  for (const msg of messages) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (prev != null && prev.role === msg.role) {
      const prevBlocks = toBlocks(prev.content);
      const curBlocks = toBlocks(msg.content);

      if (prev.role === 'user') {
        const toolResultBlocks = [
          ...prevBlocks.filter((b) => b.type === 'tool_result'),
          ...curBlocks.filter((b) => b.type === 'tool_result'),
        ];
        const otherBlocks = [
          ...prevBlocks.filter((b) => b.type !== 'tool_result'),
          ...curBlocks.filter((b) => b.type !== 'tool_result'),
        ];
        prev.content = [...toolResultBlocks, ...otherBlocks];
      } else {
        const thinkingTypes = new Set(['thinking', 'redacted_thinking']);
        const thinkingBlocks = [
          ...prevBlocks.filter((b) => thinkingTypes.has(b.type)),
          ...curBlocks.filter((b) => thinkingTypes.has(b.type)),
        ];
        const nonThinkingBlocks = [
          ...prevBlocks.filter((b) => !thinkingTypes.has(b.type)),
          ...curBlocks.filter((b) => !thinkingTypes.has(b.type)),
        ];
        prev.content = [...thinkingBlocks, ...nonThinkingBlocks];
      }
    } else {
      merged.push({ ...msg, content: msg.content });
    }
  }
  return merged;
}

function ensureStartsWithUser(
  messages: AnthropicMessage[],
  logger: { debug: (fn: () => string) => void },
): AnthropicMessage[] {
  if (messages.length > 0 && messages[0].role !== 'user') {
    logger.debug(
      () => `First message is not from user, adding placeholder user message`,
    );
    return [
      { role: 'user', content: 'Continue the conversation' },
      ...messages,
    ];
  }
  return messages;
}

function ensureNotEmpty(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (messages.length === 0) {
    return [{ role: 'user', content: 'Hello' }];
  }
  return messages;
}

function sanitizeEmptyMessages(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  const isEmptyContent = (content: AnthropicMessageContent): boolean => {
    if (typeof content === 'string') {
      return content.trim() === '';
    }
    if (content.length === 0) {
      return true;
    }
    if (content.some((block) => block.type !== 'text')) {
      return false;
    }
    return content.every(
      (block) => block.type === 'text' && block.text.trim() === '',
    );
  };

  return messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    const isEmpty = isEmptyContent(message.content);
    if (isLast || !isEmpty) {
      return message;
    }
    const placeholder =
      message.role === 'assistant'
        ? '[No content generated]'
        : '[Empty message]';
    return { ...message, content: placeholder };
  });
}

function ensureNoTrailingAssistant(
  messages: AnthropicMessage[],
  shouldIncludeThinking: boolean,
  logger: { debug: (fn: () => string) => void },
): AnthropicMessage[] {
  if (
    shouldIncludeThinking &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant'
  ) {
    logger.debug(
      () =>
        `Last message is assistant with thinking enabled, adding placeholder user message to avoid prefill error`,
    );
    return [
      ...messages,
      { role: 'user', content: 'Continue the conversation' },
    ];
  }
  return messages;
}
