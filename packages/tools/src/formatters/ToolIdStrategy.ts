/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool ID strategy module.
 *
 * Provides different strategies for resolving tool call IDs
 * based on the tool format being used. Self-contained with
 * zero core dependencies.
 */

import type { ToolCallBlock } from './IToolFormatter.js';
import type { ToolFormat } from './IToolFormatter.js';
import { normalizeToOpenAIToolId } from './toolIdNormalization.js';
import crypto from 'node:crypto';

/**
 * A generic content block that may contain tool calls or tool responses.
 */
export interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  callId?: string;
  toolName?: string;
}

/**
 * Interface for mapping tool IDs to provider-specific formats.
 */
export interface ToolIdMapper {
  /** Resolves a tool call's internal ID to the provider-specific format. */
  resolveToolCallId(tc: ToolCallBlock): string;

  /** Resolves a tool response's callId to the provider-specific format. */
  resolveToolResponseId(tr: { callId: string; toolName: string }): string;
}

/**
 * Interface for creating tool ID mappers based on content.
 */
export interface ToolIdStrategy {
  /** Creates a mapper that can resolve tool IDs for the given content. */
  createMapper(contents: Array<{ blocks?: ContentBlock[] }>): ToolIdMapper;
}

/**
 * Checks if a model name indicates a Kimi K2 model.
 */
export function isKimiModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes('kimi')) {
    return true;
  }
  const k2Pattern = /(?:^|[^a-z0-9])k2(?:[^a-z0-9]|$)/;
  return k2Pattern.test(lowerModel);
}

/**
 * Checks if a model name indicates a DeepSeek reasoner model.
 */
export function isDeepSeekReasonerModel(model: string): boolean {
  return model.toLowerCase().includes('deepseek-reasoner');
}

/**
 * Checks if a model name indicates a Mistral model.
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
 * Kimi K2 strategy: IDs in format functions.{toolName}:{globalIndex}
 */
export const kimiStrategy: ToolIdStrategy = {
  createMapper(contents: Array<{ blocks?: ContentBlock[] }>): ToolIdMapper {
    const idToK2Id = new Map<string, string>();
    let globalIndex = 0;

    for (const content of contents) {
      for (const block of content.blocks ?? []) {
        if (block.type === 'tool_call' && block.id && block.name) {
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

      resolveToolResponseId(tr: { callId: string; toolName: string }): string {
        const k2Id = idToK2Id.get(tr.callId);
        if (k2Id) {
          return k2Id;
        }
        return `functions.${tr.toolName}:${globalIndex++}`;
      },
    };
  },
};

/**
 * Standard strategy: Converts to OpenAI call_xxx format.
 */
export const standardStrategy: ToolIdStrategy = {
  createMapper(_contents: Array<{ blocks?: ContentBlock[] }>): ToolIdMapper {
    return {
      resolveToolCallId(tc: ToolCallBlock): string {
        return normalizeToOpenAIToolId(tc.id);
      },

      resolveToolResponseId(tr: { callId: string; toolName: string }): string {
        return normalizeToOpenAIToolId(tr.callId);
      },
    };
  },
};

const MISTRAL_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function base62FromHex(hex: string): string {
  const base = BigInt(MISTRAL_CHARS.length);
  let value = BigInt(`0x${hex}`);
  let result = '';

  if (value === BigInt(0)) {
    return '0';
  }

  while (value > 0) {
    const remainder = value % base;
    result = MISTRAL_CHARS[Number(remainder)] + result;
    value = value / base;
  }

  return result;
}

function generateDeterministicMistralId(seed: string, salt: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${seed}|${salt}`)
    .digest('hex');
  const base62 = base62FromHex(hash);
  const padded = base62.padStart(9, 'a');
  return padded.slice(0, 9);
}

function toMistralToolId(id: string, used: Set<string>): string {
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }

  let salt = 0;
  while (salt <= Number.MAX_SAFE_INTEGER) {
    const candidate = generateDeterministicMistralId(id, salt);
    if (!used.has(candidate)) {
      return candidate;
    }
    salt += 1;
  }
  throw new Error('Unable to generate a unique Mistral tool ID.');
}

/**
 * Mistral strategy: IDs in 9-character alphanumeric format.
 */
export const mistralStrategy: ToolIdStrategy = {
  createMapper(contents: Array<{ blocks?: ContentBlock[] }>): ToolIdMapper {
    const idToMistralId = new Map<string, string>();
    const usedIds = new Set<string>();

    for (const content of contents) {
      for (const block of content.blocks ?? []) {
        if (
          block.type === 'tool_call' &&
          block.id &&
          !idToMistralId.has(block.id)
        ) {
          const mistralId = toMistralToolId(block.id, usedIds);
          idToMistralId.set(block.id, mistralId);
          usedIds.add(mistralId);
        }
      }
    }

    return {
      resolveToolCallId(tc: ToolCallBlock): string {
        let mistralId = idToMistralId.get(tc.id);
        if (!mistralId) {
          mistralId = toMistralToolId(tc.id, usedIds);
          idToMistralId.set(tc.id, mistralId);
          usedIds.add(mistralId);
        }
        return mistralId;
      },

      resolveToolResponseId(tr: { callId: string; toolName: string }): string {
        const mistralId = idToMistralId.get(tr.callId);
        if (mistralId) {
          return mistralId;
        }
        const newId = toMistralToolId(tr.callId, usedIds);
        idToMistralId.set(tr.callId, newId);
        usedIds.add(newId);
        return newId;
      },
    };
  },
};

/**
 * Gets the appropriate tool ID strategy for a given tool format.
 * @param format - The tool format being used.
 * @returns The strategy to use for ID resolution.
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
