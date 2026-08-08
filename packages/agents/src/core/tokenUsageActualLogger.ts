/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsageLogger } from './TokenUsageLogger.js';
import type {
  TokenUsageActualInput,
  TokenUsageAttemptOutcome,
} from './tokenUsageRecords.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * Neutral token-usage input for actual-usage recording. Accepts the full set
 * of neutral `UsageStats` fields that providers already populate, plus
 * attempt-level metadata (AC-3 cost completion + AC-4 attempt truth).
 *
 * Cache precedence for the LEGACY `cached_tokens` / `effective_actual_tokens`
 * fields (AC-11): `cachedTokens` wins over `cache_read_input_tokens`; when
 * neither is present the legacy cache total defaults to 0 — this must not
 * change.
 *
 * The NEW `cache_read_tokens` / `cache_write_tokens` fields (AC-3) follow the
 * same precedence but are OMITTED when the provider did not report them —
 * omission and a true zero must stay distinguishable.
 */
export interface ActualTokenUsageInput {
  promptTokens?: number;
  cachedTokens?: number;
  cache_read_input_tokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  toolTokens?: number;
  cacheCreationTokens?: number;
  cache_creation_input_tokens?: number;
  attemptIndex?: number;
  attemptOutcome?: TokenUsageAttemptOutcome;
}

interface ActualTokenUsageRecorder {
  isEnabled(): boolean;
  recordActual(promptId: string, actual: TokenUsageActualInput): Promise<void>;
}

const logger = new DebugLogger('llxprt:token-usage-actual');

/**
 * Map a neutral `UsageStats` (from the provider response) to the
 * `ActualTokenUsageInput` shape accepted by `recordActualTokenUsage`.
 * Optionally stamps attempt metadata (AC-4).
 */
export function usageStatsToActualInput(
  usage: UsageStats,
  attempt?: {
    attemptIndex: number;
    attemptOutcome: TokenUsageAttemptOutcome;
  },
): ActualTokenUsageInput {
  const base: ActualTokenUsageInput = {
    promptTokens: usage.promptTokens,
    cachedTokens: usage.cachedTokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    toolTokens: usage.toolTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
  };
  if (attempt === undefined) return base;
  return {
    ...base,
    attemptIndex: attempt.attemptIndex,
    attemptOutcome: attempt.attemptOutcome,
  };
}

/** The history-service surface needed to reconcile a turn's token counts. */
interface TokenSyncHistory {
  waitForTokenUpdates(): Promise<void>;
  syncTotalTokens(total: number): void;
}

/**
 * Reconcile history's running token total with what the provider reported for
 * a completed turn, then record the turn's actual usage.
 *
 * Prefers the provider's prompt-token count and falls back to the last count
 * observed mid-stream. Extracted from TurnProcessor to keep that file within
 * its `max-lines` budget; behaviour is unchanged.
 */
export async function syncAndRecordTurnUsage(input: {
  history: TokenSyncHistory;
  usageLogger: ActualTokenUsageRecorder | TokenUsageLogger | null | undefined;
  usage: UsageStats | undefined;
  lastPromptTokenCount: number | null;
  attemptIndex: number;
  promptId?: string;
}): Promise<void> {
  const { history, usage, lastPromptTokenCount } = input;
  await history.waitForTokenUpdates();

  const fallback = lastPromptTokenCount;
  const usableFallback =
    fallback !== null && !Number.isNaN(fallback) ? fallback : 0;
  const total = usage?.promptTokens ?? usableFallback;
  if (total > 0) {
    history.syncTotalTokens(total);
    await history.waitForTokenUpdates();
  }

  if (input.promptId === undefined) return;
  await recordActualTokenUsage(
    input.usageLogger,
    input.promptId,
    buildSuccessfulTurnUsage(usage, fallback, input.attemptIndex),
  );
}

/**
 * Build the actual-usage input for a turn that completed successfully.
 *
 * Prefers the provider-reported usage; falls back to the last observed prompt
 * token count when the provider reported none. Returns `undefined` when
 * neither source has a usable count, so nothing is recorded rather than a
 * fabricated zero.
 */
export function buildSuccessfulTurnUsage(
  usage: UsageStats | undefined,
  lastPromptTokenCount: number | null,
  attemptIndex: number,
): ActualTokenUsageInput | undefined {
  const attempt = { attemptIndex, attemptOutcome: 'success' as const };
  if (usage !== undefined) {
    return usageStatsToActualInput(usage, attempt);
  }
  if (lastPromptTokenCount !== null && lastPromptTokenCount > 0) {
    return { promptTokens: lastPromptTokenCount, ...attempt };
  }
  return undefined;
}

/**
 * Resolve the effective cache-read token count from the two provider shapes.
 * Returns `undefined` when neither was reported so the caller can omit it.
 */
function resolveCacheReadTokens(
  usage: ActualTokenUsageInput,
): number | undefined {
  return usage.cachedTokens ?? usage.cache_read_input_tokens;
}

/**
 * Resolve the effective cache-write token count from the two provider shapes.
 * Returns `undefined` when neither was reported so the caller can omit it.
 */
function resolveCacheWriteTokens(
  usage: ActualTokenUsageInput,
): number | undefined {
  return usage.cacheCreationTokens ?? usage.cache_creation_input_tokens;
}

export async function recordActualTokenUsage(
  usageLogger: ActualTokenUsageRecorder | TokenUsageLogger | null | undefined,
  promptId: string,
  usage: ActualTokenUsageInput | undefined,
): Promise<void> {
  try {
    if (usageLogger?.isEnabled() !== true) return;
    if (usage?.promptTokens === undefined) return;

    const cacheReadTokens = resolveCacheReadTokens(usage);
    const cacheWriteTokens = resolveCacheWriteTokens(usage);

    const actual: TokenUsageActualInput = {
      actualPromptTokens: usage.promptTokens,
      cachedTokens: cacheReadTokens ?? 0,
      ...(usage.completionTokens !== undefined && {
        outputTokens: usage.completionTokens,
      }),
      ...(usage.totalTokens !== undefined && {
        totalTokens: usage.totalTokens,
      }),
      ...(usage.reasoningTokens !== undefined && {
        reasoningTokens: usage.reasoningTokens,
      }),
      ...(usage.toolTokens !== undefined && {
        toolTokens: usage.toolTokens,
      }),
      ...(cacheReadTokens !== undefined && { cacheReadTokens }),
      ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
      ...(usage.attemptIndex !== undefined && {
        attemptIndex: usage.attemptIndex,
      }),
      ...(usage.attemptOutcome !== undefined && {
        attemptOutcome: usage.attemptOutcome,
      }),
    };

    await usageLogger.recordActual(promptId, actual);
  } catch (error) {
    logger.error(`Failed to record token usage for prompt ${promptId}`, error);
  }
}

/**
 * Record a failed/abandoned stream attempt as its own token-usage record so
 * the billed attempt is visible in the telemetry (AC-4). Does not overwrite
 * the successful attempt's record — the pending entry is preserved, not
 * consumed.
 *
 * Uses `attemptUsage` (the last `UsageStats` seen from a streamed chunk) when
 * available, otherwise falls back to `fallbackTokens`.
 */
export async function recordAbandonedStreamAttempt(
  usageLogger: ActualTokenUsageRecorder | TokenUsageLogger | null | undefined,
  promptId: string,
  attempt: number,
  hasYieldedChunk: boolean,
  attemptUsage: UsageStats | undefined,
  fallbackTokens: number | null,
): Promise<void> {
  const promptTokens =
    attemptUsage?.promptTokens ?? fallbackTokens ?? undefined;
  if (promptTokens === undefined) return;
  await recordActualTokenUsage(usageLogger, promptId, {
    ...(attemptUsage === undefined
      ? {}
      : usageStatsToActualInput(attemptUsage)),
    promptTokens,
    attemptIndex: attempt,
    attemptOutcome: hasYieldedChunk ? 'abandoned' : 'error',
  });
}
