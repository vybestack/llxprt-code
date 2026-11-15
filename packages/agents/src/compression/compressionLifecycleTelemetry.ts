/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsageLogger } from '../core/TokenUsageLogger.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionAuditProvenance,
  CompressionProviderResult,
  CompressionResultMetadata,
  CompressionStrategyName,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { findCurrentTurnMarker } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';

/**
 * Resolves the compression model and provider from the provider-resolver
 * result. `model` is null when the resolver reports no concrete model.
 *
 * This deliberately does NOT catch: the caller owns the single fail-open
 * boundary for compression telemetry, so a resolver failure is reported there
 * once rather than being silently turned into null provenance here.
 */
/**
 * What compression telemetry reads from the runtime: the session identity and
 * the compression profile name that decided the model.
 */
export interface CompressionTelemetryRuntime {
  readonly state: { readonly sessionId: string; readonly model: string };
  readonly ephemerals: { compressionProfile(): string | undefined };
}

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
 * What the strategy that produced an applied compression reported about this
 * run. Usage comes from the applied result, never an older summary in history.
 */
export interface AppliedCompressionTelemetry {
  readonly strategy: CompressionStrategyName;
  readonly llmCallMade: boolean;
  readonly usage: UsageStats | undefined;
  readonly attempts: number;
}

/** Counts strategy invocations and retains metadata from the applied result. */
export class CompressionRunReport {
  private applied: CompressionResultMetadata | undefined;
  private attempts = 0;

  begin(): void {
    this.applied = undefined;
    this.attempts = 0;
  }

  countAttempt(): void {
    this.attempts += 1;
  }

  recordApplied(metadata: CompressionResultMetadata): void {
    this.applied = metadata;
  }

  telemetry(): AppliedCompressionTelemetry {
    if (this.applied === undefined) {
      throw new Error(
        'Compression was applied without a recorded strategy result',
      );
    }
    return {
      strategy: this.applied.strategyUsed,
      llmCallMade: this.applied.llmCallMade,
      usage: this.applied.usage,
      attempts: this.attempts,
    };
  }
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
 * Emits nothing when the logger is disabled. Any failure propagates to the
 * caller, which owns the single fail-open boundary — the compression itself
 * has already succeeded and observing it must never undo that.
 *
 * @param logger      The per-session token-usage logger (null when disabled)
 * @param runtimeCtx  The agent runtime context (for session ID and ephemerals)
 * @param history     The history service (for the current turn marker)
 * @param resolveProvider The compression provider resolver
 * @param tokensBefore Token count captured before compression began
 * @param tokensAfter  Token count after compression completed
 * @param applied      The metadata reported by the strategy result that was applied
 * @param provenance   The summary author attached to the applied strategy result
 */
export async function emitCompressionLifecycleEvent(
  logger: TokenUsageLogger | null,
  runtimeCtx: CompressionTelemetryRuntime,
  history: HistoryService,
  resolveProvider: (
    profileName?: string,
  ) => CompressionProviderResult | Promise<CompressionProviderResult>,
  tokensBefore: number,
  tokensAfter: number,
  applied: AppliedCompressionTelemetry,
  provenance?: CompressionAuditProvenance,
): Promise<void> {
  if (logger === null) return;
  if (!logger.isEnabled()) return;

  const sessionId = runtimeCtx.state.sessionId;
  const turnMarker = findCurrentTurnMarker(history.getRawHistory());
  const turnId = turnMarker?.turnId ?? null;

  const resolved =
    provenance === undefined
      ? await resolveCompressionModelProvider(
          resolveProvider,
          runtimeCtx.ephemerals.compressionProfile(),
        )
      : undefined;
  const compressionModel =
    provenance === undefined
      ? (resolved?.model ?? runtimeCtx.state.model)
      : provenance.summaryAuthorModel;
  const compressionProvider =
    provenance === undefined
      ? (resolved?.provider ?? null)
      : provenance.summaryAuthorProvider;

  const { usage } = applied;

  await logger.recordLifecycleEvent({
    type: 'compression',
    sessionId,
    turnId,
    tokensBefore,
    tokensAfter,
    compressionModel,
    compressionProvider,
    compressionStrategy: applied.strategy,
    llmCallMade: applied.llmCallMade,
    compressionAttempts: applied.attempts,
    ...(usage !== undefined && {
      compressionPromptTokens: usage.promptTokens,
      compressionOutputTokens: usage.completionTokens,
    }),
  });
}

export async function recordCompressionTelemetry(
  logger: DebugLogger,
  tokenUsageLogger: TokenUsageLogger | null,
  runtimeContext: CompressionTelemetryRuntime,
  historyService: HistoryService,
  providerResolver: (
    profileName?: string,
  ) => CompressionProviderResult | Promise<CompressionProviderResult>,
  tokensBefore: number,
  applied: AppliedCompressionTelemetry,
  provenance?: CompressionAuditProvenance,
): Promise<void> {
  // Emit the compression lifecycle event into the token-usage log (#3130
  // AC-7). Exactly-once: this branch runs only on a genuine 'applied'
  // outcome; retry logic is internal to runCompressionWithRetryAndFallback.
  // The compression itself has already succeeded and history is updated.
  // Observing it must not undo that, so this is the one fail-open boundary
  // for the emission; the emitter stays guard-free inside.
  await emitCompressionLifecycleEvent(
    tokenUsageLogger,
    runtimeContext,
    historyService,
    providerResolver,
    tokensBefore,
    historyService.getTotalTokens(),
    applied,
    provenance,
  ).catch((error: unknown) => {
    logger.error('Failed to record compression telemetry', error);
  });
}
