/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic Request Building Module
 * Handles system prompt construction, prompt caching, thinking config, and request body assembly
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 3)
 */

import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import { isOpus46Plus } from './AnthropicModelData.js';

/**
 * A content block with cache_control attached.
 * @issue #1414
 */
export type CachedAnthropicBlock = AnthropicMessageBlock & {
  cache_control: { type: 'ephemeral'; ttl: '5m' | '1h' };
};

/**
 * Content block type union for message arrays that may carry optional cache_control.
 * Used when attaching prompt caching markers to message content.
 */
type CacheableContentBlock = AnthropicMessageBlock & {
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
};

/**
 * Sanitize a content block before attaching cache_control.
 * Only copies Anthropic-permitted keys for each block type so that extra
 * properties (from deserialization, SDK mutations, etc.) never reach the API.
 * Prevents Anthropic 400 "text: Extra inputs are not permitted".
 * Unknown block types are returned as minimal text blocks to avoid
 * permissive spread of unexpected keys.
 * @issue #1414
 */
export function sanitizeBlockForCacheControl(
  block: AnthropicMessageBlock,
  ttl: '5m' | '1h',
): CachedAnthropicBlock {
  const cacheControl = { type: 'ephemeral' as const, ttl };

  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, cache_control: cacheControl };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
        cache_control: cacheControl,
      };
    case 'tool_result': {
      const result: CachedAnthropicBlock & { type: 'tool_result' } = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        cache_control: cacheControl,
      };
      if (block.is_error !== undefined) {
        result.is_error = block.is_error;
      }
      return result;
    }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        ...(block.signature !== undefined
          ? { signature: block.signature }
          : {}),
        cache_control: cacheControl,
      };
    case 'redacted_thinking':
      return {
        type: 'redacted_thinking',
        data: block.data,
        cache_control: cacheControl,
      };
    case 'image':
      return {
        type: 'image',
        source: block.source,
        cache_control: cacheControl,
      };
    case 'document': {
      const doc: CachedAnthropicBlock & { type: 'document' } = {
        type: 'document',
        source: block.source,
        cache_control: cacheControl,
      };
      if (block.title !== undefined) {
        doc.title = block.title;
      }
      return doc;
    }
    default: {
      const unknown = block as { type: string };
      return {
        type: 'text',
        text: `[unsupported block type: ${unknown.type}]`,
        cache_control: cacheControl,
      };
    }
  }
}

type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl: '5m' | '1h' };
};

/**
 * Build the system prompt field for Anthropic API
 */
export function buildAnthropicSystemPrompt(options: {
  corePromptText?: string;
  isOAuth: boolean;
  wantCaching: boolean;
  ttl: '5m' | '1h';
}): string | AnthropicSystemBlock[] | undefined {
  if (options.isOAuth) {
    return "You are Claude Code, Anthropic's official CLI for Claude.";
  }

  if (!options.corePromptText) {
    return undefined;
  }

  if (options.wantCaching) {
    return [
      {
        type: 'text',
        text: options.corePromptText,
        cache_control: { type: 'ephemeral', ttl: options.ttl },
      },
    ];
  }

  return options.corePromptText;
}

/**
 * Attach cache_control to the last message's last non-thinking block
 * Mutates messages in place (acceptable since Anthropic conversion creates fresh objects)
 */
export function attachPromptCaching(
  messages: AnthropicMessage[],
  ttl: '5m' | '1h',
  logger: { debug: (fn: () => string) => void },
): void {
  if (messages.length === 0) {
    return;
  }

  const lastMessage = messages[messages.length - 1];

  if (typeof lastMessage.content === 'string') {
    if (lastMessage.content.trim() !== '') {
      lastMessage.content = [
        {
          type: 'text',
          text: lastMessage.content,
          cache_control: { type: 'ephemeral', ttl },
        },
      ] as CacheableContentBlock[];
      logger.debug(
        () => `Added cache_control to last message (converted string to array)`,
      );
    }
  } else if (Array.isArray(lastMessage.content)) {
    const content = lastMessage.content as CacheableContentBlock[];

    let lastNonThinkingIndex = -1;
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (let i = content.length - 1; i >= 0; i--) {
      const block = content[i];
      if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (block.type === 'text' && block.text.trim() === '') {
          continue;
        }

        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (
          block.type === 'tool_result' &&
          typeof block.content === 'string' &&
          block.content.trim() === ''
        ) {
          continue;
        }

        lastNonThinkingIndex = i;
        break;
      }
    }

    if (lastNonThinkingIndex >= 0) {
      content[lastNonThinkingIndex] = sanitizeBlockForCacheControl(
        content[lastNonThinkingIndex],
        ttl,
      );
      logger.debug(() => {
        const block = content[lastNonThinkingIndex];
        return `Added cache_control to last message's last ${block.type} block (index ${lastNonThinkingIndex})`;
      });
    }
  }
}

/**
 * Build thinking configuration for Anthropic API
 * @issue #1307: Correct adaptive thinking support for Opus 4.6
 */
export function buildThinkingConfig(options: {
  reasoningEnabled: boolean;
  reasoningBudgetTokens?: number;
  adaptiveThinking?: boolean;
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max';
  model: string;
}): {
  thinking?: { type: 'adaptive' | 'enabled'; budget_tokens?: number };
  output_config?: { effort: 'low' | 'medium' | 'high' | 'max' };
} {
  if (!options.reasoningEnabled) {
    return {};
  }

  const opus46Plus = isOpus46Plus(options.model);

  if (
    opus46Plus &&
    options.reasoningBudgetTokens == null &&
    options.adaptiveThinking !== false
  ) {
    const config: {
      thinking?: { type: 'adaptive' | 'enabled'; budget_tokens?: number };
      output_config?: { effort: 'low' | 'medium' | 'high' | 'max' };
    } = {
      thinking: { type: 'adaptive' as const },
    };

    if (options.thinkingEffort) {
      config.output_config = { effort: options.thinkingEffort };
    }

    return config;
  }

  const config: {
    thinking?: { type: 'adaptive' | 'enabled'; budget_tokens?: number };
    output_config?: { effort: 'low' | 'medium' | 'high' | 'max' };
  } = {
    thinking: {
      type: 'enabled' as const,
      budget_tokens: options.reasoningBudgetTokens ?? 10000,
    },
  };

  if (options.thinkingEffort) {
    config.output_config = { effort: options.thinkingEffort };
  }

  return config;
}

/**
 * Sort top-level object keys alphabetically for stable JSON serialization.
 * Nested objects are not sorted; tool schemas are expected to have
 * consistent nested structure from the schema converter.
 */
export function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted = Object.keys(obj)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = obj[key];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  return sorted as T;
}

/**
 * Build the complete Anthropic API request body
 */
export function buildAnthropicRequestBody(options: {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  tools?: unknown[];
  maxTokens: number;
  streamingEnabled: boolean;
  modelParams: Record<string, unknown>;
  thinking?: { type: 'adaptive' | 'enabled'; budget_tokens?: number };
  outputConfig?: { effort: 'low' | 'medium' | 'high' | 'max' };
}): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    stream: options.streamingEnabled,
    ...options.modelParams,
  };

  if (options.system !== undefined) {
    requestBody.system = options.system;
  }

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
  }

  if (options.thinking) {
    requestBody.thinking = options.thinking;
  }

  if (options.outputConfig) {
    requestBody.output_config = options.outputConfig;
  }

  return requestBody;
}
