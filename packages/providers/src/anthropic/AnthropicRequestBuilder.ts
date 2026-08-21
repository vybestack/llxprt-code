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
import { isFable5, supportsAdaptiveThinking } from './AnthropicModelData.js';

/**
 * Top-level sampling parameters the Anthropic Messages API accepts on the
 * request body. Profile `modelParams` are filtered to this set before being
 * spread into the request so provider-agnostic or vendor-specific params (e.g.
 * GLM's `clear_thinking`, which is NOT an Anthropic field) never reach the API.
 *
 * Sending an unknown top-level key makes strict Anthropic-compatible endpoints
 * reject the whole request — e.g. z.ai returns 400 code 1213 "The prompt
 * parameter was not received normally" (Issue #2410). This mirrors the
 * block-level sanitization already done in {@link sanitizeBlockForCacheControl}
 * ("Extra inputs are not permitted").
 *
 * `max_tokens`, `stream`, `model`, `messages`, `system`, `tools`, `thinking`
 * and `output_config` are set explicitly by the builder and are intentionally
 * NOT part of this passthrough set.
 */
const ANTHROPIC_PASSTHROUGH_MODEL_PARAMS: ReadonlySet<string> = new Set([
  'temperature',
  'top_p',
  'top_k',
  'stop_sequences',
  'metadata',
  'service_tier',
]);

/**
 * Filters caller-supplied model params to the Anthropic-API-permitted
 * passthrough set (see {@link ANTHROPIC_PASSTHROUGH_MODEL_PARAMS}). Drops
 * nullish (undefined and null) values and any key the Anthropic Messages API
 * does not accept as a top-level field.
 */
function sanitizeAnthropicModelParams(
  modelParams: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(modelParams)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (ANTHROPIC_PASSTHROUGH_MODEL_PARAMS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

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

function isEmptyContentBlock(block: CacheableContentBlock): boolean {
  if (block.type === 'text' && block.text.trim() === '') {
    return true;
  }
  return (
    block.type === 'tool_result' &&
    typeof block.content === 'string' &&
    block.content.trim() === ''
  );
}

/**
 * Index of the last non-thinking, non-empty content block in `content`, or -1
 * when none qualifies. Shared by the rolling-tail breakpoint
 * (`attachPromptCaching`) and the preserved-head anchor breakpoint so both
 * select the same kind of block for a `cache_control` marker (#3070).
 */
export function selectLastCacheableBlockIndex(
  content: CacheableContentBlock[],
): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    const isThinkingBlock =
      block.type === 'thinking' || block.type === 'redacted_thinking';
    if (!isThinkingBlock && !isEmptyContentBlock(block)) {
      return i;
    }
  }
  return -1;
}

/**
 * Attach cache_control to the last message's last non-thinking block
 * Mutates messages in place (acceptable because Anthropic conversion creates
 * fresh objects).
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

    const lastNonThinkingIndex = selectLastCacheableBlockIndex(content);

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

export type AnthropicEffortLiteral = 'low' | 'medium' | 'high' | 'max';

/**
 * The `thinking` parameter value: either a translated config or an explicit
 * native record passed through from modelParams. The shape is deliberately
 * broad (any object with a non-empty `type` string) so future or
 * non-enumerated native thinking modes reach the wire unchanged. The known
 * translated shapes ({type:'adaptive'}, {type:'enabled', budget_tokens},
 * {type:'disabled'}) are assignable to this record, so they document the
 * translation outputs rather than forming a separate union arm that the
 * record arm would subsume anyway (issue #3255).
 */
export type AnthropicThinkingParameter = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

/**
 * The `output_config` parameter value. A translated config carries
 * `effort: AnthropicEffortLiteral`; an explicit native record keeps
 * arbitrary members. The generic record admits both, so no separate
 * translated arm is declared (issue #3255).
 */
export type AnthropicOutputConfigParameter = Readonly<Record<string, unknown>>;

type AnthropicThinkingConfig = {
  thinking?: {
    type: 'adaptive' | 'enabled' | 'disabled';
    budget_tokens?: number;
    display?: 'summarized' | 'omitted';
  };
  output_config?: { effort: AnthropicEffortLiteral };
};

/**
 * Build the adaptive-thinking config shared by Fable 5 and other
 * adaptive-capable models. Centralizes the `{ type: 'adaptive' }` literal and
 * the `effort` mapping so future thinking-field changes have one source.
 *
 * `display` controls whether the API returns thinking text. All adaptive-
 * capable models pass 'summarized' (default) to get readable thinking
 * summaries, or 'omitted' when `includeInResponse` is explicitly false.
 * Fable 5 never returns raw chain-of-thought regardless of this setting.
 */
function buildAdaptiveConfig(
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max',
  display?: 'summarized' | 'omitted',
): AnthropicThinkingConfig {
  const thinking: NonNullable<AnthropicThinkingConfig['thinking']> = {
    type: 'adaptive' as const,
  };
  if (display) {
    thinking.display = display;
  }
  const config: AnthropicThinkingConfig = { thinking };
  if (thinkingEffort) {
    config.output_config = { effort: thinkingEffort };
  }
  return config;
}

/**
 * Legacy default budget for budgeted thinking when no explicit
 * reasoning.budgetTokens is configured. Not a public default: only the two
 * legacy manual-budget sites in this package use it (issue #3255).
 */
export const ANTHROPIC_LEGACY_DEFAULT_BUDGET_TOKENS = 10000;

/**
 * Adaptive-capable models have no legacy budget default: request preparation
 * must fail before transport instead of fabricating one. No effort-to-budget
 * conversion is invented (issue #3255); a directly configured
 * reasoning.budgetTokens remains the explicit compatibility path.
 */
export function assertAdaptiveManualBudget(
  model: string,
  budgetTokens: number | undefined,
): void {
  if (budgetTokens !== undefined || !supportsAdaptiveThinking(model)) {
    return;
  }
  throw new Error(
    `Model '${model}' supports adaptive thinking: budgeted thinking requires an explicit reasoning.budgetTokens. Set reasoning.budgetTokens, remove reasoning.adaptiveThinking=false, or map reasoning.enabledMap.true to 'adaptive'.`,
  );
}

/**
 * Build thinking configuration for Anthropic API
 * @issue #1307: Correct adaptive thinking support for Opus 4.6
 * @issue #2289: Extended to Sonnet 5 (also supports adaptive thinking)
 * @issue #2328: Fable 5 is adaptive-only (never budgeted 'enabled' or 'disabled')
 * @issue #1723: Pass `display: 'summarized'` for all adaptive-capable models
 *   when reasoning.includeInResponse is true (or unset, default true), so the
 *   API returns readable thinking text instead of empty blocks. When
 *   includeInResponse is explicitly false, pass `display: 'omitted'`.
 */
export function buildThinkingConfig(options: {
  reasoningEnabled: boolean;
  reasoningBudgetTokens?: number;
  adaptiveThinking?: boolean;
  includeInResponse?: boolean;
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max';
  model: string;
}): AnthropicThinkingConfig {
  if (!options.reasoningEnabled) {
    return {};
  }
  const display =
    options.includeInResponse === false ? 'omitted' : 'summarized';

  // Claude Fable 5: adaptive thinking is the only mode and is always on — it
  // cannot be disabled or switched to legacy budgeted 'enabled' thinking.
  // Depth is controlled exclusively via `effort`, so ignore any
  // reasoningBudgetTokens / adaptiveThinking override for Fable 5. Fable 5
  // never returns raw thinking, so request `display: 'summarized'` to get
  // readable summaries instead of empty thinking blocks.
  if (isFable5(options.model)) {
    return buildAdaptiveConfig(options.thinkingEffort, display);
  }

  const adaptiveCapable = supportsAdaptiveThinking(options.model);

  if (
    adaptiveCapable &&
    options.reasoningBudgetTokens == null &&
    options.adaptiveThinking !== false
  ) {
    return buildAdaptiveConfig(options.thinkingEffort, display);
  }

  assertAdaptiveManualBudget(options.model, options.reasoningBudgetTokens);

  const config: AnthropicThinkingConfig = {
    thinking: {
      type: 'enabled' as const,
      budget_tokens:
        options.reasoningBudgetTokens ?? ANTHROPIC_LEGACY_DEFAULT_BUDGET_TOKENS,
      ...(options.includeInResponse === false
        ? { display: 'omitted' as const }
        : {}),
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
  thinking?: AnthropicThinkingParameter;
  outputConfig?: AnthropicOutputConfigParameter;
}): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    stream: options.streamingEnabled,
    ...sanitizeAnthropicModelParams(options.modelParams),
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
