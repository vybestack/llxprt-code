/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * Neutral usage-metadata shape with optional cache fields. Adapted from the
 * former Google `GenerateContentResponseUsageMetadata` so the agents package
 * has zero `@google/genai` dependencies.
 */
export interface UsageMetadataWithCache {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  toolUsePromptTokenCount?: number;
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
  usage: UsageMetadataWithCache | undefined,
): Promise<void> {
  try {
    if (usageLogger?.isEnabled() !== true) return;
    if (usage?.promptTokenCount === undefined) return;

    await usageLogger.recordActual(promptId, {
      actualPromptTokens: usage.promptTokenCount,
      cachedTokens:
        usage.cachedContentTokenCount ?? usage.cache_read_input_tokens ?? 0,
    });
  } catch (error) {
    logger.error(`Failed to record token usage for prompt ${promptId}`, error);
  }
}
