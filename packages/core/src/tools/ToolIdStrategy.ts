/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251205-ISSUE712
 * @description Tool ID strategy module for Kimi K2 and standard ID handling
 *
 * This module provides different strategies for resolving tool call IDs
 * based on the tool format being used. Kimi K2 requires a specific ID format
 * (functions.{name}:{index}) while most other providers use OpenAI-style
 * call_xxx format.
 */

import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ContentBlock,
} from '../services/history/IContent.js';
import type { ToolFormat } from './IToolFormatter.js';
import { normalizeToOpenAIToolId } from '../providers/openai-vercel/toolIdUtils.js';

/**
 * Interface for mapping tool IDs to provider-specific formats
 */
export interface ToolIdMapper {
  /**
   * Resolves a tool call's internal ID to the provider-specific format
   */
  resolveToolCallId(tc: ToolCallBlock): string;

  /**
   * Resolves a tool response's callId to the provider-specific format
   * that matches its corresponding tool call
   */
  resolveToolResponseId(tr: ToolResponseBlock): string;
}

/**
 * Interface for creating tool ID mappers based on conversation contents
 */
export interface ToolIdStrategy {
  /**
   * Creates a mapper that can resolve tool IDs for the given conversation
   */
  createMapper(contents: IContent[]): ToolIdMapper;
}

/**
 * Checks if a model name indicates a Kimi K2 model that requires
 * the special functions.{name}:{index} ID format.
 *
 * @param model - The model name to check
 * @returns true if this is a K2 model requiring special ID handling
 */
export function isKimiModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel.includes('kimi') || lowerModel.includes('k2');
}

/**
 * Kimi K2 strategy: Generates IDs in the format functions.{toolName}:{globalIndex}
 *
 * K2 uses a specific ID format where each tool call gets a sequential index
 * based on its position in the conversation. This strategy scans all tool calls
 * and assigns indices, then uses those indices when resolving IDs.
 */
export const kimiStrategy: ToolIdStrategy = {
  createMapper(contents: IContent[]): ToolIdMapper {
    // Build a map of internal ID -> K2 format ID
    const idToK2Id = new Map<string, string>();
    let globalIndex = 0;

    // Scan all tool calls in the conversation
    for (const content of contents) {
      if (content.speaker !== 'ai') continue;

      for (const block of content.blocks) {
        if (isToolCallBlock(block)) {
          const k2Id = `functions.${block.name}:${globalIndex}`;
          idToK2Id.set(block.id, k2Id);
          globalIndex++;
        }
      }
    }

    return {
      resolveToolCallId(tc: ToolCallBlock): string {
        return idToK2Id.get(tc.id) ?? `functions.${tc.name}:${globalIndex++}`;
      },

      resolveToolResponseId(tr: ToolResponseBlock): string {
        // Look up the corresponding tool call's K2 ID
        const k2Id = idToK2Id.get(tr.callId);
        if (k2Id) {
          return k2Id;
        }
        // Fallback: generate a new ID based on the tool name
        // This handles orphan responses or responses to calls not yet seen
        return `functions.${tr.toolName}:${globalIndex++}`;
      },
    };
  },
};

/**
 * Standard strategy: Converts internal hist_tool_xxx format to OpenAI call_xxx format
 *
 * This is the default strategy used for most providers (OpenAI, Qwen, DeepSeek, etc.)
 * It simply normalizes the internal ID format to the OpenAI format.
 */
export const standardStrategy: ToolIdStrategy = {
  createMapper(_contents: IContent[]): ToolIdMapper {
    return {
      resolveToolCallId(tc: ToolCallBlock): string {
        return normalizeToOpenAIToolId(tc.id);
      },

      resolveToolResponseId(tr: ToolResponseBlock): string {
        return normalizeToOpenAIToolId(tr.callId);
      },
    };
  },
};

/**
 * Gets the appropriate tool ID strategy for a given tool format
 *
 * @param format - The tool format being used
 * @returns The strategy to use for ID resolution
 */
export function getToolIdStrategy(format: ToolFormat): ToolIdStrategy {
  if (format === 'kimi') {
    return kimiStrategy;
  }
  return standardStrategy;
}

/**
 * Type guard for ToolCallBlock
 */
function isToolCallBlock(block: ContentBlock): block is ToolCallBlock {
  return block.type === 'tool_call';
}
