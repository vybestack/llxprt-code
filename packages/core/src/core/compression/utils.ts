/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P04
 * @requirement REQ-CS-004.1, REQ-CS-004.2, REQ-CS-004.3, REQ-CS-004.4
 *
 * Shared utility functions for adjusting compression/truncation boundaries
 * to avoid splitting tool call/response pairs in conversation history.
 *
 * Extracted from GeminiChat as pure standalone functions with no class or
 * logging dependencies.
 */

import type {
  ContentBlock,
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';

/**
 * Aggregate text from content blocks, handling spacing between text and
 * non-text blocks. Used by LLM-based compression strategies to collect
 * streamed response text.
 */
export function aggregateTextFromBlocks(
  blocks: ContentBlock[],
  currentText: string,
  lastBlockWasNonText: boolean,
): { text: string; lastBlockWasNonText: boolean } {
  let aggregatedText = currentText;
  let wasNonText = lastBlockWasNonText;

  for (const block of blocks) {
    if (block.type === 'text') {
      if (wasNonText && aggregatedText.length > 0) {
        aggregatedText += ' ';
      }
      aggregatedText += block.text;
      wasNonText = false;
    } else {
      wasNonText = true;
    }
  }

  return { text: aggregatedText, lastBlockWasNonText: wasNonText };
}

/**
 * Adjust compression boundary to not split tool call/response pairs.
 * Searches for a valid split point that doesn't break tool call/response
 * pairs. If the initial index lands inside a tool response sequence, it
 * first tries moving forward, then searches backward for a valid boundary.
 */
export function adjustForToolCallBoundary(
  history: IContent[],
  index: number,
): number {
  if (index <= 0 || history.length === 0) {
    return index;
  }

  const originalIndex = index;

  index = findForwardValidSplitPoint(history, index);

  if (index >= history.length) {
    index = findBackwardValidSplitPoint(history, originalIndex);
  }

  return index;
}

/**
 * Search forward from the given index to find a valid split point that
 * doesn't land in the middle of a tool response sequence. If, after
 * skipping tool responses, the preceding AI message has tool calls
 * whose responses are not in the kept portion, backs up by one to
 * include the AI message in the removed portion.
 */
export function findForwardValidSplitPoint(
  history: IContent[],
  index: number,
): number {
  while (index < history.length && history[index].speaker === 'tool') {
    index++;
  }

  if (index > 0 && index < history.length) {
    const prev = history[index - 1];
    if (prev.speaker === 'ai') {
      const toolCalls = prev.blocks.filter((b) => b.type === 'tool_call');
      if (toolCalls.length > 0) {
        const keptHistory = history.slice(index);
        const hasMatchingResponses = toolCalls.every((call) => {
          const toolCall = call as ToolCallBlock;
          return keptHistory.some(
            (msg) =>
              msg.speaker === 'tool' &&
              msg.blocks.some(
                (b) =>
                  b.type === 'tool_response' &&
                  (b as ToolResponseBlock).callId === toolCall.id,
              ),
          );
        });

        if (!hasMatchingResponses) {
          return index - 1;
        }
      }
    }
  }

  return index;
}

/**
 * Search backward from the given start index to find a valid split point.
 * Skips tool response messages and AI messages whose tool calls don't
 * have matching responses in the remaining history. Returns the first
 * valid boundary found, or startIndex if none is found.
 */
export function findBackwardValidSplitPoint(
  history: IContent[],
  startIndex: number,
): number {
  for (let i = startIndex - 1; i >= 0; i--) {
    const current = history[i];

    if (current.speaker === 'tool') {
      continue;
    }

    if (current.speaker === 'ai') {
      const toolCalls = current.blocks.filter((b) => b.type === 'tool_call');
      if (toolCalls.length > 0) {
        const remainingHistory = history.slice(i + 1);
        const allCallsHaveResponses = toolCalls.every((call) => {
          const toolCall = call as ToolCallBlock;
          return remainingHistory.some(
            (msg) =>
              msg.speaker === 'tool' &&
              msg.blocks.some(
                (b) =>
                  b.type === 'tool_response' &&
                  (b as ToolResponseBlock).callId === toolCall.id,
              ),
          );
        });

        if (allCallsHaveResponses) {
          return i + 1;
        }
        continue;
      }
    }

    return i + 1;
  }

  return startIndex;
}

/**
 * Build a context-aware continuation directive to replace the static
 * compression acknowledgment. When active todos exist the directive
 * references the first task and points the model at todo_read for
 * full recovery; otherwise it emits a simple "continue" statement.
 */
export function buildContinuationDirective(activeTodos?: string): string {
  if (activeTodos && activeTodos.trim().length > 0) {
    const firstTask = extractFirstTaskContent(activeTodos);
    if (firstTask) {
      return `Understood. Continue with current task: "${firstTask}". Use todo_read for full context.`;
    }
  }
  return 'Understood. Continuing with the current task.';
}

/**
 * Extract the content description from the first line of a formatted
 * active-todos string. Expected format per line:
 *   `- [status] description text`
 */
function extractFirstTaskContent(activeTodos: string): string | undefined {
  const firstLine = activeTodos.trim().split('\n')[0];
  if (!firstLine) return undefined;

  const firstCloseBracket = firstLine.indexOf(']');
  if (firstCloseBracket === -1) {
    return firstLine.trim() || undefined;
  }

  const task = firstLine.slice(firstCloseBracket + 1).trim();
  return task.length > 0 ? task : undefined;
}
