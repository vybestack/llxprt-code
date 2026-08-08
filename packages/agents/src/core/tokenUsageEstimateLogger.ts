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
import type { TokenUsageTurnContext } from './tokenUsageRecords.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

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

/**
 * Attach the AC-1 join keys to the pending estimate for `promptId` so the
 * eventual turn record can be joined back to the conversation. Called at both
 * send seams (StreamProcessor and TurnProcessor) immediately after
 * {@link recordFinalizedPromptEnvelopeEstimate}.
 *
 * The join keys come from two sources:
 * - `runtimeState` provides `sessionId`, `runtimeId`, `parentRuntimeId`,
 *   and `subagentName`.
 * - `historyService.getCurrentTurnMarker()` provides `turnId`, `userTurn`,
 *   and `step`. When no chronology marker exists yet, these are `null` —
 *   never invented, never 0-as-unknown.
 *
 * @issue #3130
 */
export function recordTurnJoinContext(
  usageLogger: TokenUsageLogger | null | undefined,
  promptId: string,
  runtimeState: AgentRuntimeState,
  historyService: HistoryService,
): void {
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;

  const marker = historyService.getCurrentTurnMarker();

  const context: TokenUsageTurnContext = {
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    parentRuntimeId: runtimeState.parentRuntimeId ?? null,
    subagentName: runtimeState.subagentName ?? null,
    turnId: marker?.turnId ?? null,
    userTurn: marker?.userTurn ?? null,
    step: marker?.step ?? null,
  };

  usageLogger.attachTurnContext(promptId, context);
}
