/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token-count extraction helpers extracted from LoggingProviderWrapper to
 * keep the main wrapper file under the lint line budget. These operate on
 * UsageStats metadata and raw response objects/headers.
 */

import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export interface TokenCounts {
  input_token_count: number;
  output_token_count: number;
  cached_content_token_count: number;
  thoughts_token_count: number;
  tool_token_count: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number | null;
}

export function numberOrZero(value: unknown): number {
  const valueAsNumber = Number(value);
  if (Object.is(valueAsNumber, -0) || Number.isNaN(valueAsNumber)) {
    return 0;
  }
  return valueAsNumber;
}

export function firstTruthyNumber(
  firstValue: unknown,
  secondValue: unknown,
): number {
  const firstNumber = numberOrZero(firstValue);
  if (firstNumber !== 0) {
    return firstNumber;
  }
  return numberOrZero(secondValue);
}

/**
 * Extract token counts from tokenUsage metadata
 */
export function extractTokenCountsFromTokenUsage(
  tokenUsage: UsageStats,
  debug: DebugLogger,
): TokenCounts & { cache_creation_input_tokens: number | null } {
  const cacheReads = Math.max(
    0,
    firstTruthyNumber(
      tokenUsage.cachedTokens,
      tokenUsage.cache_read_input_tokens,
    ),
  );

  // Check if cache writes are actually reported by the provider
  const hasCacheWriteData =
    tokenUsage.cacheCreationTokens !== undefined ||
    tokenUsage.cache_creation_input_tokens !== undefined;

  const cacheWrites = hasCacheWriteData
    ? Math.max(
        0,
        firstTruthyNumber(
          tokenUsage.cacheCreationTokens,
          tokenUsage.cache_creation_input_tokens,
        ),
      )
    : null;

  debug.debug(
    () =>
      `[extractTokenCountsFromTokenUsage] Extracting from UsageStats: cacheReads=${cacheReads}, cacheWrites=${cacheWrites}, raw values: cachedTokens=${tokenUsage.cachedTokens}, cache_read=${tokenUsage.cache_read_input_tokens}, cacheCreationTokens=${tokenUsage.cacheCreationTokens}, cache_creation=${tokenUsage.cache_creation_input_tokens}`,
  );

  return {
    input_token_count: numberOrZero(tokenUsage.promptTokens),
    output_token_count: numberOrZero(tokenUsage.completionTokens),
    // Use cacheReads for cached_content_token_count so it flows to UI telemetry
    cached_content_token_count: cacheReads,
    thoughts_token_count: 0, // Not available in basic UsageStats
    tool_token_count: 0, // Not available in basic UsageStats
    cache_read_input_tokens: cacheReads,
    cache_creation_input_tokens: cacheWrites,
  };
}

/**
 * Extract token counts from response object or headers
 */
export function extractTokenCountsFromResponse(response: unknown): TokenCounts {
  // Initialize token counts as zeros
  let input_token_count = 0;
  let output_token_count = 0;
  let cached_content_token_count = 0;
  let thoughts_token_count = 0;
  let tool_token_count = 0;
  let cache_read_input_tokens = 0;
  let cache_creation_input_tokens: number | null = 0;

  try {
    if (typeof response === 'string') {
      const parsed = JSON.parse(response);
      if (parsed.usage != null) {
        ({
          input_token_count,
          output_token_count,
          cached_content_token_count,
          thoughts_token_count,
          tool_token_count,
          cache_read_input_tokens,
          cache_creation_input_tokens,
        } = extractUsageNumbers(parsed.usage));
      }
    } else if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      if (obj.usage != null && typeof obj.usage === 'object') {
        ({
          input_token_count,
          output_token_count,
          cached_content_token_count,
          thoughts_token_count,
          tool_token_count,
          cache_read_input_tokens,
          cache_creation_input_tokens,
        } = extractUsageNumbers(obj.usage as Record<string, unknown>));
      }
      if (obj.headers != null && typeof obj.headers === 'object') {
        ({ input_token_count, output_token_count } =
          extractAnthropicHeaderTokens(
            obj.headers as Record<string, string>,
            input_token_count,
            output_token_count,
          ));
      }
    }

    return clampTokenCounts({
      input_token_count,
      output_token_count,
      cached_content_token_count,
      thoughts_token_count,
      tool_token_count,
      cache_read_input_tokens,
      cache_creation_input_tokens,
    });
  } catch {
    return zeroTokenCounts();
  }
}

/** Extract numeric token counts from a usage object. */
function extractUsageNumbers(usage: Record<string, unknown>): TokenCounts {
  const safeNum = (v: unknown) => {
    const n = Number(v);
    return !isNaN(n) && n !== 0 ? n : 0;
  };
  return {
    input_token_count: safeNum(usage.prompt_tokens),
    output_token_count: safeNum(usage.completion_tokens),
    cached_content_token_count: safeNum(usage.cached_content_tokens),
    thoughts_token_count: safeNum(usage.thoughts_tokens),
    tool_token_count: safeNum(usage.tool_tokens),
    cache_read_input_tokens: safeNum(usage.cache_read_input_tokens),
    cache_creation_input_tokens: safeNum(usage.cache_creation_input_tokens),
  };
}

/** Extract anthropic-style header tokens, falling back to current values. */
function extractAnthropicHeaderTokens(
  headers: Record<string, string>,
  currentInput: number,
  currentOutput: number,
): { input_token_count: number; output_token_count: number } {
  let input_token_count = currentInput;
  let output_token_count = currentOutput;
  if (headers['anthropic-input-tokens']) {
    const parsedValue = parseInt(headers['anthropic-input-tokens'], 10);
    input_token_count =
      !isNaN(parsedValue) && parsedValue >= 0 ? parsedValue : input_token_count;
  }
  if (headers['anthropic-output-tokens']) {
    const parsedValue = parseInt(headers['anthropic-output-tokens'], 10);
    output_token_count =
      !isNaN(parsedValue) && parsedValue >= 0
        ? parsedValue
        : output_token_count;
  }
  return { input_token_count, output_token_count };
}

/** Clamp all token counts to non-negative. */
function clampTokenCounts(counts: TokenCounts): TokenCounts {
  return {
    input_token_count: Math.max(0, counts.input_token_count),
    output_token_count: Math.max(0, counts.output_token_count),
    cached_content_token_count: Math.max(0, counts.cached_content_token_count),
    thoughts_token_count: Math.max(0, counts.thoughts_token_count),
    tool_token_count: Math.max(0, counts.tool_token_count),
    cache_read_input_tokens: Math.max(0, counts.cache_read_input_tokens),
    cache_creation_input_tokens:
      counts.cache_creation_input_tokens === null
        ? null
        : Math.max(0, counts.cache_creation_input_tokens),
  };
}

/** Return zero token counts as fallback. */
function zeroTokenCounts(): TokenCounts {
  return {
    input_token_count: 0,
    output_token_count: 0,
    cached_content_token_count: 0,
    thoughts_token_count: 0,
    tool_token_count: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}
