/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsageLogger } from '../core/TokenUsageLogger.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { findCurrentTurnMarker } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';

/**
 * Resolves the compression model and provider from the provider-resolver
 * result. Returns null model/provider when the provider cannot be resolved
 * (fail-open for telemetry — the compression itself has already succeeded).
 */
interface ResolvedCompressionModel {
  readonly model: string | null;
  readonly provider: string | null;
}

async function resolveCompressionModelProvider(
  resolveProvider: (
    profileName?: string,
  ) => CompressionProviderResult | Promise<CompressionProviderResult>,
  compressionProfileName: string | undefined,
): Promise<ResolvedCompressionModel> {
  const result = await resolveProvider(compressionProfileName);
  return {
    model: result.resolved?.model ?? null,
    provider: result.provider.name,
  };
}

/**
 * Extract the compression call's own token usage from the summary content's
 * metadata. Returns undefined when the strategy did not report usage.
 */
function extractCompressionUsage(
  summary: IContent | undefined,
): { promptTokens: number; outputTokens: number } | undefined {
  const usage = summary?.metadata?.usage;
  if (usage === undefined) return undefined;
  return {
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
  };
}

/**
 * Emit a `compression` lifecycle event into the token-usage log after a
 * completed compression. This is the single emission point — called once per
 * real compression by `CompressionHandler.performCompression` after the
 * outcome is determined as `'applied'`.
 *
 * Exactly-once guarantee: `performCompression` calls this only on the
 * `'applied'` branch. Retry logic is internal to
 * `runCompressionWithRetryAndFallback`; the caller invokes
 * `performCompression` at most once per external trigger.
 *
 * Fail-open: if the provider cannot be resolved or the logger is disabled,
 * the event is silently skipped — the compression itself has already
 * succeeded and telemetry must never block it.
 *
 * @param logger      The per-session token-usage logger (null when disabled)
 * @param runtimeCtx  The agent runtime context (for session ID and ephemerals)
 * @param history     The history service (for the current turn marker)
 * @param resolveProvider The compression provider resolver
 * @param tokensBefore Token count captured before compression began
 * @param tokensAfter  Token count after compression completed
 * @param summary      The compression summary content (carries usage metadata)
 */
export async function emitCompressionLifecycleEvent(
  logger: TokenUsageLogger | null,
  runtimeCtx: AgentRuntimeContext,
  history: HistoryService,
  resolveProvider: (
    profileName?: string,
  ) => CompressionProviderResult | Promise<CompressionProviderResult>,
  tokensBefore: number,
  tokensAfter: number,
  summary: IContent | undefined,
): Promise<void> {
  if (logger === null) return;
  if (!logger.isEnabled()) return;

  const sessionId = runtimeCtx.state.sessionId;
  const turnMarker = findCurrentTurnMarker(history.getRawHistory());
  const turnId = turnMarker?.turnId ?? null;

  const compressionProfileName = runtimeCtx.ephemerals.compressionProfile();
  const resolved = await resolveCompressionModelProvider(
    resolveProvider,
    compressionProfileName,
  );

  // Fall back to the session model/provider when the resolved result does not
  // carry model info (e.g. no compression profile override).
  const compressionModel = resolved.model ?? runtimeCtx.state.model;
  const compressionProvider = resolved.provider;

  const usage = extractCompressionUsage(summary);

  await logger.recordLifecycleEvent({
    type: 'compression',
    sessionId,
    turnId,
    tokensBefore,
    tokensAfter,
    compressionModel,
    compressionProvider,
    ...(usage !== undefined && {
      compressionPromptTokens: usage.promptTokens,
      compressionOutputTokens: usage.outputTokens,
    }),
  });
}
