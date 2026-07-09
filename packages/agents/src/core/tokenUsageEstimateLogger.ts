/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PartListUnion } from '@google/genai';
import { estimateRequestTokensStructured } from './clientHelpers.js';
import type {
  TokenUsageLogger,
  TokenEstimatorType,
} from './TokenUsageLogger.js';

export interface ChatTokenEstimator {
  estimatePendingTokens?: (contents: never[]) => Promise<number>;
  convertPartListUnionToIContent?: (input: PartListUnion) => unknown;
}

const OPENAI_PROVIDERS = new Set([
  'openai',
  'openaivercel',
  'openai-responses',
]);

const ANTHROPIC_PROVIDERS = new Set(['anthropic']);

export function resolveEstimatorType(providerName: string): TokenEstimatorType {
  if (OPENAI_PROVIDERS.has(providerName)) return 'openai-tiktoken';
  if (ANTHROPIC_PROVIDERS.has(providerName)) return 'anthropic-char';
  return 'core-fallback';
}

interface TokenUsageLoggerHolder {
  getTokenUsageLogger?: () => TokenUsageLogger | undefined;
}

export function recordTokenEstimate(
  holder: TokenUsageLoggerHolder | undefined,
  promptId: string,
  request: PartListUnion,
  estimatedTokens: number,
  providerName: string,
  model: string,
): void {
  const logger = holder?.getTokenUsageLogger?.();
  if (logger === undefined) return;
  if (!logger.isEnabled()) return;
  logger.recordEstimate(promptId, {
    provider: providerName,
    model,
    estimatedTokens,
    estimator: resolveEstimatorType(providerName),
    tiktokenTokens: estimateRequestTokensStructured(request),
  });
}

export async function estimateRequestTokens(
  chat: ChatTokenEstimator,
  initialRequest: PartListUnion,
  fallback: number,
): Promise<number> {
  const est = chat.estimatePendingTokens;
  const conv = chat.convertPartListUnionToIContent;
  if (typeof est !== 'function' || typeof conv !== 'function') {
    return fallback;
  }
  try {
    const content = conv.call(chat, initialRequest) as never;
    return await est.call(chat, [content]);
  } catch {
    return fallback;
  }
}
