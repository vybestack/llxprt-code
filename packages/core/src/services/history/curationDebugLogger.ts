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

import type { DebugLogger } from '../../debug/index.js';
import type { IContent } from './IContent.js';

/** Build the per-block debug shape for an AI content entry. */
function buildBlockDebug(blocks: IContent['blocks']) {
  return blocks.map((b) => ({
    type: b.type,
    textLength: b.type === 'text' ? b.text.length : null,
    textPreview: b.type === 'text' ? b.text.substring(0, 50) : null,
    isEmpty: b.type === 'text' ? !b.text.trim() : false,
  }));
}

/** Log analysis details for a single AI message when debug is enabled. */
export function logAiMessageAnalysis(
  logger: DebugLogger,
  content: IContent,
  messageIndex: number,
  hasValidContent: boolean,
): void {
  if (!logger.enabled) {
    return;
  }
  logger.debug('Analyzing AI message:', {
    messageIndex,
    hasValidContent,
    blockCount: content.blocks.length,
    blocks: buildBlockDebug(content.blocks),
    metadata: {
      hasUsage: !!content.metadata?.usage,
      tokens: content.metadata?.usage?.totalTokens,
    },
  });
}

/** Log an excluded AI message when debug is enabled. */
export function logExcludedAiMessage(logger: DebugLogger): void {
  if (logger.enabled) {
    logger.debug('EXCLUDED AI message - no valid content');
  }
}

/** Log the curated history summary when debug is enabled. */
export function logCurationSummary(
  logger: DebugLogger,
  params: {
    totalHistory: number;
    curated: IContent[];
    aiMessagesAnalyzed: number;
    aiMessagesIncluded: number;
    excludedCount: number;
    isCompressing: boolean;
  },
): void {
  if (!logger.enabled) {
    return;
  }
  const {
    totalHistory,
    curated,
    aiMessagesAnalyzed,
    aiMessagesIncluded,
    excludedCount,
    isCompressing,
  } = params;

  logger.debug('=== CURATED HISTORY SUMMARY ===', {
    totalHistory,
    curatedCount: curated.length,
    breakdown: {
      aiMessages: {
        total: aiMessagesAnalyzed,
        included: aiMessagesIncluded,
        excluded: excludedCount,
        exclusionRate:
          aiMessagesAnalyzed > 0
            ? `${((excludedCount / aiMessagesAnalyzed) * 100).toFixed(1)}%`
            : '0%',
      },
      humanMessages: curated.filter((c) => c.speaker === 'human').length,
      toolMessages: curated.filter((c) => c.speaker === 'tool').length,
    },
    toolActivity: {
      toolCallsInCurated: curated.reduce(
        (acc, c) => acc + c.blocks.filter((b) => b.type === 'tool_call').length,
        0,
      ),
      toolResponsesInCurated: curated.reduce(
        (acc, c) =>
          acc + c.blocks.filter((b) => b.type === 'tool_response').length,
        0,
      ),
    },
    isCompressing,
  });
}

/** Conversation statistics returned by computeStatistics. */
export interface ConversationStatistics {
  totalMessages: number;
  userMessages: number;
  aiMessages: number;
  toolCalls: number;
  toolResponses: number;
  totalTokens?: number;
}

/** Log details about content being added to history. */
export function logContentAdded(
  logger: DebugLogger,
  content: IContent,
  modelName?: string,
): void {
  if (!logger.enabled) {
    return;
  }
  logger.debug('Adding content to history:', {
    speaker: content.speaker,
    blockTypes: content.blocks.map((b) => b.type),
    toolCallIds: content.blocks
      .filter((b) => b.type === 'tool_call')
      .map((b) => b.id),
    toolResponseIds: content.blocks
      .filter((b) => b.type === 'tool_response')
      .map((b) => ({
        callId: b.callId,
        toolName: b.toolName,
      })),
    contentId: content.metadata?.id,
    modelName,
  });
}

/** Log a queueing event when adding during active compression. */
export function logQueuedDuringCompression(
  logger: DebugLogger,
  content: IContent,
): void {
  if (!logger.enabled) {
    return;
  }
  logger.debug('Queueing add operation during compression', {
    speaker: content.speaker,
    blockTypes: content.blocks.map((b) => b.type),
  });
}

/** Compute conversation statistics from a history array. */
export function computeStatistics(history: IContent[]): ConversationStatistics {
  let userMessages = 0;
  let aiMessages = 0;
  let toolCalls = 0;
  let toolResponses = 0;
  let totalTokens = 0;
  let hasTokens = false;

  for (const content of history) {
    if (content.speaker === 'human') {
      userMessages++;
    } else if (content.speaker === 'ai') {
      aiMessages++;
    }

    for (const block of content.blocks) {
      if (block.type === 'tool_call') {
        toolCalls++;
      } else if (block.type === 'tool_response') {
        toolResponses++;
      }
    }

    const usageTokens = content.metadata?.usage?.totalTokens;
    if (typeof usageTokens === 'number' && Number.isFinite(usageTokens)) {
      totalTokens += usageTokens;
      hasTokens = true;
    }
  }

  return {
    totalMessages: history.length,
    userMessages,
    aiMessages,
    toolCalls,
    toolResponses,
    totalTokens: hasTokens ? totalTokens : undefined,
  };
}
