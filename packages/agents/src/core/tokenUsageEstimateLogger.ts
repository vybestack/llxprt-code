/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PartListUnion } from '@google/genai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimateRequestTokensStructured } from './clientHelpers.js';
import type {
  TokenUsageLogger,
  TokenEstimatorType,
} from './TokenUsageLogger.js';

const logger = new DebugLogger('llxprt:token-usage-estimate');

export interface ChatTokenEstimator {
  estimatePendingTokens?: (contents: IContent[]) => Promise<number>;
  convertPartListUnionToIContent?: (input: PartListUnion) => IContent;
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
  const usageLogger = holder?.getTokenUsageLogger?.();
  if (usageLogger === undefined) return;
  if (!usageLogger.isEnabled()) return;
  const structuredEstimate = safeEstimateStructuredTokens(request);
  usageLogger.recordEstimate(promptId, {
    provider: providerName,
    model,
    estimatedTokens,
    estimator: resolveEstimatorType(providerName),
    tiktokenTokens: structuredEstimate.tokens,
    tiktokenEstimationFailed: structuredEstimate.failed,
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
    const content = conv.call(chat, initialRequest);
    return await est.call(chat, [content]);
  } catch (error) {
    logger.debug('Token estimate failed, using fallback', error);
    return fallback;
  }
}

function safeEstimateStructuredTokens(request: PartListUnion): {
  tokens: number | null;
  failed: boolean;
} {
  try {
    return { tokens: estimateRequestTokensStructured(request), failed: false };
  } catch (error) {
    logger.debug('Structured token estimate failed', error);
    return { tokens: null, failed: true };
  }
}
