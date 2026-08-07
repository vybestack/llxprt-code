/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';

/**
 * Neutral token-usage input for actual-usage recording. Uses UsageStats-style
 * field names (promptTokens, cachedTokens) rather than Google-shaped keys.
 *
 * Cache precedence: `cachedTokens` wins over `cache_read_input_tokens`; when
 * neither is present the recorded cache total defaults to 0.
 */
export interface ActualTokenUsageInput {
  promptTokens?: number;
  cachedTokens?: number;
  cache_read_input_tokens?: number;
}

interface ActualTokenUsageRecorder {
  isEnabled(): boolean;
  recordActual(
    promptId: string,
    actual: { actualPromptTokens: number; cachedTokens: number },
  ): Promise<void>;
}

const logger = new DebugLogger('llxprt:token-usage-actual');

export async function recordActualTokenUsage(
  usageLogger: ActualTokenUsageRecorder | TokenUsageLogger | null | undefined,
  promptId: string,
  usage: ActualTokenUsageInput | undefined,
): Promise<void> {
  try {
    if (usageLogger?.isEnabled() !== true) return;
    if (usage?.promptTokens === undefined) return;

    await usageLogger.recordActual(promptId, {
      actualPromptTokens: usage.promptTokens,
      cachedTokens: usage.cachedTokens ?? usage.cache_read_input_tokens ?? 0,
    });
  } catch (error) {
    logger.error(`Failed to record token usage for prompt ${promptId}`, error);
  }
}
