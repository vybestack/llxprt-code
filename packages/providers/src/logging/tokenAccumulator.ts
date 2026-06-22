/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token accumulation and logging-config resolution helpers extracted from
 * LoggingProviderWrapper to keep the main wrapper file under the lint
 * line budget.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export interface AccumulableTokenCounts {
  input_token_count: number;
  output_token_count: number;
  cached_content_token_count: number;
  thoughts_token_count: number;
  tool_token_count: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number | null;
}

/**
 * Accumulate token usage for session tracking by forwarding the mapped
 * usage to the ProviderManager when available.
 */
export function accumulateTokenUsage(
  tokenCounts: AccumulableTokenCounts,
  config: Config | undefined,
  providerName: string,
  debug: DebugLogger,
): void {
  // Map token counts to expected format
  // Preserve null for cacheWrites to distinguish "not reported" from "0"
  const usage: {
    input: number;
    output: number;
    cache: number;
    thought: number;
    tool: number;
    cacheReads: number;
    cacheWrites: number | null;
  } = {
    input: tokenCounts.input_token_count,
    output: tokenCounts.output_token_count,
    cache: tokenCounts.cached_content_token_count,
    thought: tokenCounts.thoughts_token_count,
    tool: tokenCounts.tool_token_count,
    cacheReads: tokenCounts.cache_read_input_tokens ?? 0,
    cacheWrites:
      tokenCounts.cache_creation_input_tokens === undefined
        ? null
        : tokenCounts.cache_creation_input_tokens,
  };

  debug.debug(
    () =>
      `[accumulateTokenUsage] Mapped tokenCounts to usage: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
  );

  // Call accumulateSessionTokens if providerManager is available
  const providerManager = config?.getProviderManager();
  if (providerManager) {
    try {
      debug.debug(
        () =>
          `[TokenTracking] Accumulating ${usage.input + usage.output + usage.cache + usage.tool + usage.thought} tokens for provider ${providerName}, cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
      );
      providerManager.accumulateSessionTokens(providerName, usage);
    } catch (error) {
      debug.warn(() => `Failed to accumulate session tokens: ${error}`);
    }
  } else {
    debug.warn(
      () =>
        `[TokenTracking] No provider manager found in config - tokens not accumulated for ${providerName}`,
    );
  }
}

/** Resolve a candidate value into a Config when it has the logging method. */
export function resolveLoggingConfig(candidate: unknown): Config | undefined {
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'getConversationLoggingEnabled' in candidate &&
    typeof (candidate as { getConversationLoggingEnabled?: unknown })
      .getConversationLoggingEnabled === 'function'
  ) {
    return candidate as Config;
  }
  return undefined;
}
