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
 * Uses specific pattern matching to avoid false positives from models
 * that happen to contain 'k2' as part of their name (e.g., "gptk2-turbo").
 *
 * @param model - The model name to check
 * @returns true if this is a K2 model requiring special ID handling
 */
export function isKimiModel(model: string): boolean {
  const lowerModel = model.toLowerCase();

  // Explicit kimi branding
  if (lowerModel.includes('kimi')) {
    return true;
  }

  // Check for k2 at word boundaries:
  // - starts with k2 (e.g., "k2-0527-preview")
  // - ends with k2 or -k2 (e.g., "model-k2")
  // - has k2 surrounded by non-alphanumeric (e.g., "kimi-k2-chat")
  const k2Pattern = /(?:^|[^a-z0-9])k2(?:[^a-z0-9]|$)/;
  return k2Pattern.test(lowerModel);
}

/**
 * Checks if a model name indicates a Mistral model that requires
 * the special 9-character alphanumeric ID format.
 *
 * Mistral models (both hosted and self-hosted) enforce a strict tool call ID format:
 * - Exactly 9 characters
 * - Only alphanumeric (a-z, A-Z, 0-9) - no underscores or special characters
 *
 * This applies to mistral, devstral, codestral, and other Mistral model variants.
 *
 * @param model - The model name to check
 * @returns true if this is a Mistral model requiring special ID handling
 */
export function isMistralModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes('mistral') ||
    lowerModel.includes('devstral') ||
    lowerModel.includes('codestral') ||
    lowerModel.includes('pixtral') ||
    lowerModel.includes('ministral')
  );
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
 * Generates a Mistral-compatible tool call ID.
 *
 * Mistral requires exactly 9 alphanumeric characters (a-z, A-Z, 0-9).
 * No underscores, dashes, or other special characters are allowed.
 *
 * @returns A 9-character alphanumeric string
 */
function generateMistralToolId(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 9; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Converts any tool ID to Mistral's required format.
 *
 * If the ID is already 9 alphanumeric characters, return it as-is.
 * Otherwise, generate a new compliant ID.
 *
 * @param id - The original tool call ID
 * @returns A Mistral-compatible 9-character alphanumeric ID
 */
function toMistralToolId(id: string): string {
  // Check if already compliant: exactly 9 alphanumeric characters
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }
  // Generate a new compliant ID
  return generateMistralToolId();
}

/**
 * Mistral strategy: Generates IDs in Mistral's required format
 *
 * Mistral models (both hosted API and self-hosted) require tool call IDs to be:
 * - Exactly 9 characters
 * - Only alphanumeric (a-z, A-Z, 0-9)
 *
 * This strategy maintains a mapping from internal IDs to Mistral-compliant IDs
 * to ensure tool responses can be matched back to their calls.
 */
export const mistralStrategy: ToolIdStrategy = {
  createMapper(contents: IContent[]): ToolIdMapper {
    // Build a map of internal ID -> Mistral format ID
    const idToMistralId = new Map<string, string>();

    // Scan all tool calls in the conversation and assign Mistral IDs
    for (const content of contents) {
      if (content.speaker !== 'ai') continue;

      for (const block of content.blocks) {
        if (isToolCallBlock(block)) {
          // Check if this ID already has a Mistral mapping
          if (!idToMistralId.has(block.id)) {
            idToMistralId.set(block.id, toMistralToolId(block.id));
          }
        }
      }
    }

    return {
      resolveToolCallId(tc: ToolCallBlock): string {
        // Return existing mapping or create new one
        let mistralId = idToMistralId.get(tc.id);
        if (!mistralId) {
          mistralId = toMistralToolId(tc.id);
          idToMistralId.set(tc.id, mistralId);
        }
        return mistralId;
      },

      resolveToolResponseId(tr: ToolResponseBlock): string {
        // Look up the corresponding tool call's Mistral ID
        const mistralId = idToMistralId.get(tr.callId);
        if (mistralId) {
          return mistralId;
        }
        // Fallback: generate a new compliant ID
        const newId = toMistralToolId(tr.callId);
        idToMistralId.set(tr.callId, newId);
        return newId;
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
  if (format === 'mistral') {
    return mistralStrategy;
  }
  return standardStrategy;
}

/**
 * Type guard for ToolCallBlock
 */
function isToolCallBlock(block: ContentBlock): block is ToolCallBlock {
  return block.type === 'tool_call';
}
