/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  TokenUsageLogger,
  TokenEstimatorType,
} from './TokenUsageLogger.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

const logger = new DebugLogger('llxprt:token-usage-estimate');

const OPENAI_PROVIDERS = new Set([
  'openai',
  'openaivercel',
  'openai-responses',
]);

const ANTHROPIC_PROVIDERS = new Set(['anthropic']);

export function resolveEstimatorType(
  providerName: string,
  estimatorMethod?: PromptEnvelopeEstimate['estimatorMethod'],
  estimatorFamily?: string,
): TokenEstimatorType {
  if (estimatorMethod === 'exact' && estimatorFamily === 'openai-gpt-5.6') {
    return 'openai-tiktoken';
  }
  const normalizedProviderName = providerName.toLowerCase();
  if (OPENAI_PROVIDERS.has(normalizedProviderName)) return 'openai-tiktoken';
  if (ANTHROPIC_PROVIDERS.has(normalizedProviderName)) return 'anthropic-char';
  return 'core-fallback';
}

export function recordFinalizedPromptEnvelopeEstimate(
  usageLogger: TokenUsageLogger | null | undefined,
  promptId: string,
  estimate: PromptEnvelopeEstimate | null,
): void {
  if (estimate === null) return;
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;
  try {
    usageLogger.refineEstimate(promptId, {
      provider: estimate.activeProvider,
      model: estimate.model,
      estimatedTokens: estimate.estimatedPromptTokens,
      estimator: resolveEstimatorType(
        estimate.activeProvider,
        estimate.estimatorMethod,
        estimate.estimatorFamily,
      ),
      estimatorMethod: estimate.estimatorMethod,
      estimatorFamily: estimate.estimatorFamily,
      estimatorVersion: estimate.estimatorVersion,
      assetRevision: estimate.assetRevision,
      projectionRevision: estimate.projectionRevision,
      protocol: estimate.protocol,
    });
  } catch (error) {
    logger.error(
      `Failed to record finalized prompt-envelope estimate for prompt ${promptId}`,
      error,
    );
  }
}
