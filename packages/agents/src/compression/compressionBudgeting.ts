/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { estimateTokens as estimateTextTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { serializeWireContentForEstimate } from '@vybestack/llxprt-code-core/services/history/historyTokenEstimation.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import {
  buildInvalidContextBudgetError,
  InvalidContextBudgetError,
} from './invalidContextBudgetError.js';

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
 * Absolute fallback output reservation, capped to half of the context window
 * via {@link DEFAULT_COMPLETION_FRACTION} so it can never equal or exceed the
 * whole window on small context models.
 */
export const DEFAULT_COMPLETION_BUDGET = 65_536;

/**
 * Fraction of the context window reserved for completion tokens when no budget
 * is explicitly configured. This keeps the unconfigured default proportional
 * to the window so a small context limit never collapses the compression
 * trigger to zero. For windows >= 131,072 the proportional default equals the
 * flat {@link DEFAULT_COMPLETION_BUDGET} (65536), preserving existing cloud
 * behaviour.
 */
export const DEFAULT_COMPLETION_FRACTION = 0.5;

/**
 * Get completion budget from generation config, provider params, or a
 * context-limit-aware default. Used to reserve output tokens when calculating
 * context limits.
 *
 * - An explicitly configured budget (ephemeral `maxOutputTokens`,
 *   `generationConfig`, or provider params) that is `>= contextLimit` throws
 *   {@link InvalidContextBudgetError}: that is a genuinely impossible
 *   configuration that must fail fast rather than silently collapsing the
 *   effective limit to zero.
 * - When nothing is configured, the budget is
 *   `min(DEFAULT_COMPLETION_BUDGET, floor(contextLimit * DEFAULT_COMPLETION_FRACTION))`
 *   so the default never consumes the whole window. This is our bug, not the
 *   user's, so the unconfigured case never throws.
 *
 * @plan PLAN-20260220-DECOMPOSE.P03
 */
export function getCompletionBudget(
  generationConfig: ModelGenerationSettings,
  _model: string,
  provider: IProvider | undefined,
  settingsService: { get: (key: string) => unknown } | undefined,
  contextLimit: number,
): number {
  if (!Number.isFinite(contextLimit) || contextLimit <= 0) {
    throw new RangeError(
      `Context limit must be a positive finite number: got ${contextLimit}`,
    );
  }

  // Check global ephemeral setting for maxOutputTokens (set via /set maxOutputTokens)
  const liveMaxOutputTokens = settingsService?.get('maxOutputTokens');
  const liveBudget = asNumber(liveMaxOutputTokens);
  if (liveBudget !== undefined && liveBudget > 0) {
    if (liveBudget >= contextLimit) {
      throw buildInvalidContextBudgetError(
        liveBudget,
        contextLimit,
        'maxOutputTokens',
      );
    }
    return liveBudget;
  }

  const generationBudget = asNumber(
    (generationConfig as { maxOutputTokens?: unknown }).maxOutputTokens,
  );
  if (generationBudget !== undefined && generationBudget > 0) {
    if (generationBudget >= contextLimit) {
      throw buildInvalidContextBudgetError(
        generationBudget,
        contextLimit,
        'generationConfig',
      );
    }
    return generationBudget;
  }

  const providerParams = provider?.getModelParams?.();
  const providerBudget = extractCompletionBudgetFromParams(providerParams);
  if (providerBudget !== undefined) {
    if (providerBudget >= contextLimit) {
      throw buildInvalidContextBudgetError(
        providerBudget,
        contextLimit,
        'providerParams',
      );
    }
    return providerBudget;
  }

  return Math.min(
    DEFAULT_COMPLETION_BUDGET,
    Math.floor(contextLimit * DEFAULT_COMPLETION_FRACTION),
  );
}

export { InvalidContextBudgetError };

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
    const serialized = serializeWireContentForEstimate(content);
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
