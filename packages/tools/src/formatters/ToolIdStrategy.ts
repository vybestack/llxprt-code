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
 * Where a mapper keeps what it learns about a request's tool ids. The mapper
 * holds only scalars itself, so a store backed by disk keeps the heap flat
 * however many tool calls the history has.
 */
export interface ToolIdStore {
  /** The provider id last recorded for a call id. */
  getMappedId(callId: string): string | undefined;
  /** Later records for a call id replace earlier ones. */
  setMappedId(callId: string, mappedId: string): void;
  /** Whether a provider id was already handed out for some call id. */
  isUsed(mappedId: string): boolean;
  markUsed(mappedId: string): void;
}

/** A mapper that learns ids one row at a time (`observe`) before it resolves. */
export interface StreamingToolIdMapper extends ToolIdMapper {
  /** Records the tool calls of one row; call once per row, in row order. */
  observe(content: { blocks?: ContentBlock[] }): void;
}

/**
 * Interface for creating tool ID mappers.
 */
export interface ToolIdStrategy {
  /**
   * Creates a mapper that observes rows one at a time and keeps its facts in
   * `store`. Observing every row first and then resolving gives the same ids
   * as `createMapper` over the whole array.
   */
  createStreamingMapper(store: ToolIdStore): StreamingToolIdMapper;

  /** Creates a mapper for an array that is already in memory. */
  createMapper(contents: Array<{ blocks?: ContentBlock[] }>): ToolIdMapper;
}

/** Facts held in a Map and a Set, for callers that already hold the array. */
export function createInMemoryToolIdStore(): ToolIdStore {
  const mapped = new Map<string, string>();
  const used = new Set<string>();
  return {
    getMappedId: (callId) => mapped.get(callId),
    setMappedId: (callId, mappedId) => {
      mapped.set(callId, mappedId);
    },
    isUsed: (mappedId) => used.has(mappedId),
    markUsed: (mappedId) => {
      used.add(mappedId);
    },
  };
}

function defineStrategy(
  createStreamingMapper: (store: ToolIdStore) => StreamingToolIdMapper,
): ToolIdStrategy {
  return {
    createStreamingMapper,
    createMapper(contents) {
      const mapper = createStreamingMapper(createInMemoryToolIdStore());
      for (const content of contents) {
        mapper.observe(content);
      }
      return mapper;
    },
  };
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

const MISTRAL_KEYWORDS = [
  'mistral',
  'devstral',
  'codestral',
  'pixtral',
  'ministral',
];

/**
 * Checks if a model name indicates a Mistral model.
 */
export function isMistralModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return MISTRAL_KEYWORDS.some((keyword) => lowerModel.includes(keyword));
}

/**
 * Kimi K2 strategy: IDs in format functions.{toolName}:{globalIndex}
 */
export const kimiStrategy: ToolIdStrategy = defineStrategy((store) => {
  let globalIndex = 0;

  return {
    observe(content): void {
      for (const block of content.blocks ?? []) {
        if (block.type === 'tool_call' && block.id && block.name) {
          store.setMappedId(block.id, `functions.${block.name}:${globalIndex}`);
          globalIndex++;
        }
      }
    },

    resolveToolCallId(tc: ToolCallBlock): string {
      return (
        store.getMappedId(tc.id) ?? `functions.${tc.name}:${globalIndex++}`
      );
    },

    resolveToolResponseId(tr: { callId: string; toolName: string }): string {
      const k2Id = store.getMappedId(tr.callId);
      if (k2Id) {
        return k2Id;
      }
      return `functions.${tr.toolName}:${globalIndex++}`;
    },
  };
});

/**
 * Standard strategy: Converts to OpenAI call_xxx format.
 */
export const standardStrategy: ToolIdStrategy = defineStrategy(() => ({
  observe(): void {},

  resolveToolCallId(tc: ToolCallBlock): string {
    return normalizeToOpenAIToolId(tc.id);
  },

  resolveToolResponseId(tr: { callId: string; toolName: string }): string {
    return normalizeToOpenAIToolId(tr.callId);
  },
}));

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

function toMistralToolId(id: string, store: ToolIdStore): string {
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }

  let salt = 0;
  while (salt <= Number.MAX_SAFE_INTEGER) {
    const candidate = generateDeterministicMistralId(id, salt);
    if (!store.isUsed(candidate)) {
      return candidate;
    }
    salt += 1;
  }
  throw new Error('Unable to generate a unique Mistral tool ID.');
}

function mapMistralId(callId: string, store: ToolIdStore): string {
  const existing = store.getMappedId(callId);
  if (existing) {
    return existing;
  }
  const mistralId = toMistralToolId(callId, store);
  store.setMappedId(callId, mistralId);
  store.markUsed(mistralId);
  return mistralId;
}

/**
 * Mistral strategy: IDs in 9-character alphanumeric format.
 */
export const mistralStrategy: ToolIdStrategy = defineStrategy((store) => ({
  observe(content): void {
    for (const block of content.blocks ?? []) {
      if (block.type === 'tool_call' && block.id) {
        mapMistralId(block.id, store);
      }
    }
  },

  resolveToolCallId(tc: ToolCallBlock): string {
    return mapMistralId(tc.id, store);
  },

  resolveToolResponseId(tr: { callId: string; toolName: string }): string {
    return mapMistralId(tr.callId, store);
  },
}));

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
