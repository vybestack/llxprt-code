/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '../../services/history/IContent.js';
import type { HistoryService } from '../../services/history/HistoryService.js';
import type { GenerateContentConfig } from '@google/genai';
import type { IProvider } from '../../providers/IProvider.js';
import { estimateTokens as estimateTextTokens } from '../../utils/toolOutputLimiter.js';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:gemini:compression-budgeting');

/**
 * Extract a number from various value types (number, string, etc.)
 * @plan PLAN-20260220-DECOMPOSE.P03
 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Extract completion budget from generation config parameters.
 * Checks multiple possible parameter names for output token limits.
 * @plan PLAN-20260220-DECOMPOSE.P03
 */
export function extractCompletionBudgetFromParams(
  params: Record<string, unknown> | undefined,
): number | undefined {
  if (!params) {
    return undefined;
  }

  const candidateKeys = [
    'maxOutputTokens',
    'maxTokens',
    'max_output_tokens',
    'max_tokens',
  ];

  for (const key of candidateKeys) {
    if (key in params) {
      const value = asNumber(params[key]);
      if (value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Get completion budget from generation config, provider params, or default.
 * Used to reserve output tokens when calculating context limits.
 * @plan PLAN-20260220-DECOMPOSE.P03
 */
export function getCompletionBudget(
  generationConfig: GenerateContentConfig,
  _model: string,
  provider?: IProvider,
  settingsService?: { get: (key: string) => unknown },
): number {
  const DEFAULT_COMPLETION_BUDGET = 65_536;

  // Check global ephemeral setting for maxOutputTokens (set via /set maxOutputTokens)
  // This is a generic setting that providers should translate to their native param
  const liveMaxOutputTokens = settingsService?.get('maxOutputTokens');
  const liveBudget = asNumber(liveMaxOutputTokens);
  if (liveBudget !== undefined && liveBudget > 0) {
    return liveBudget;
  }

  const generationBudget = asNumber(
    (generationConfig as { maxOutputTokens?: unknown }).maxOutputTokens,
  );

  const providerParams = provider?.getModelParams?.();
  const providerBudget = extractCompletionBudgetFromParams(providerParams);

  return generationBudget ?? providerBudget ?? DEFAULT_COMPLETION_BUDGET;
}

/**
 * Estimate token count for pending content that hasn't been added to history yet.
 * Uses historyService tokenizer when available, falls back to text-based estimation.
 * @plan PLAN-20260220-DECOMPOSE.P03
 */
export async function estimatePendingTokens(
  contents: IContent[],
  historyService: HistoryService,
  model: string,
): Promise<number> {
  if (contents.length === 0) {
    return 0;
  }

  try {
    return await historyService.estimateTokensForContents(contents, model);
  } catch (error) {
    logger.debug('Falling back to local token estimate', error);

    let fallback = 0;
    for (const content of contents) {
      fallback += estimateFallbackContentTokens(content, logger);
    }
    return fallback;
  }
}

function estimateFallbackContentTokens(
  content: IContent,
  fallbackLogger: DebugLogger,
): number {
  try {
    const serialized = JSON.stringify(content);
    return estimateTextTokens(serialized);
  } catch (stringifyError) {
    fallbackLogger.debug(
      'Failed to stringify content for fallback token estimate',
      stringifyError,
    );
    return estimateBlockTokens(content);
  }
}

function estimateBlockTokens(content: IContent): number {
  try {
    const blockStrings = content.blocks
      .map((block) => {
        switch (block.type) {
          case 'text':
            return block.text;
          case 'tool_call':
            return JSON.stringify({
              name: block.name,
              parameters: block.parameters,
            });
          case 'tool_response':
            return JSON.stringify({
              callId: block.callId,
              toolName: block.toolName,
              result: block.result,
              error: block.error,
            });
          case 'thinking':
            return block.thought;
          case 'code':
            return block.code;
          case 'media':
            return block.caption ?? '';
          default:
            return '';
        }
      })
      .join('\n');
    if (blockStrings) {
      return estimateTextTokens(blockStrings);
    }
  } catch (blockError) {
    logger.debug('Failed to estimate tokens from blocks', blockError);
  }
  return 0;
}
