/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TodoToolCall } from '@vybestack/llxprt-code-core';

// Create a "grouped" format for tool calls
export interface GroupedToolCall {
  toolCall: TodoToolCall;
  count: number;
}

/**
 * Function to group consecutive identical tool calls
 * Identical tool calls (same name and parameters) that occur consecutively are grouped with a count
 * Different tool calls are shown separately
 */
export const groupToolCalls = (
  toolCalls: TodoToolCall[],
): GroupedToolCall[] => {
  if (toolCalls.length === 0) return [];

  const grouped: GroupedToolCall[] = [];
  let currentGroup: GroupedToolCall = {
    toolCall: toolCalls[0],
    count: 1,
  };

  for (let i = 1; i < toolCalls.length; i++) {
    const current = toolCalls[i];
    const prev = currentGroup.toolCall;

    // Check if this is the same tool call as the previous one
    if (
      current.name === prev.name &&
      JSON.stringify(current.parameters) === JSON.stringify(prev.parameters)
    ) {
      // Increment count for consecutive identical call
      currentGroup.count++;
    } else {
      // Different call, save the current group and start a new one
      grouped.push(currentGroup);
      currentGroup = {
        toolCall: current,
        count: 1,
      };
    }
  }

  // Don't forget the last group
  grouped.push(currentGroup);

  return grouped;
};
