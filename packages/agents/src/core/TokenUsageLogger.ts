/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  TOKEN_USAGE_SCHEMA_VERSION,
  type TokenUsageTurnContext,
  type TokenUsageActualInput,
  type TokenUsageLifecycleEvent,
  type TokenUsageCompressionEvent,
  type TokenUsageProviderSwitchEvent,
  type TokenUsageModelSwitchEvent,
  type TokenUsageSessionResumeEvent,
  type TokenUsageContextTruncationEvent,
  type SerializedTokenUsageLifecycleRecord,
  type SerializedTokenUsageRecord,
  type TokenUsageAttemptOutcome,
} from './tokenUsageRecords.js';
import { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';

// Re-export for backward compatibility — SerializedTokenUsageRecord now lives
// in the schema module as an alias of SerializedTokenUsageTurnRecord.
export type { SerializedTokenUsageRecord } from './tokenUsageRecords.js';
export type { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';

export type TokenEstimatorType =
  | 'openai-tiktoken'
  | 'anthropic-char'
  | 'core-fallback';

export interface PendingTokenEstimate {
  readonly ts: string;
  readonly promptId: string;
  readonly provider: string;
  readonly model: string;
  readonly estimatedTokens: number;
  readonly estimator: TokenEstimatorType;
  readonly estimatorMethod?: 'exact' | 'calibrated';
  readonly estimatorFamily?: string;
  readonly estimatorVersion?: string;
  readonly assetRevision?: string;
  readonly projectionRevision?: number;
  readonly protocol?: string;
  readonly tiktokenTokens: number | null;
  readonly tiktokenEstimationFailed?: boolean;
}

export interface TokenUsageRecord extends PendingTokenEstimate {
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly effectiveActualTokens: number;
}

export const PENDING_CAP = 100;

/**
 * True for the outcomes that are followed by another billed attempt for the
 * same prompt. Any other outcome ends the turn.
 */
function isRetriedOutcome(
  outcome: TokenUsageAttemptOutcome | undefined,
): boolean {
  return outcome === 'abandoned' || outcome === 'error';
}

/** True when a pending entry has all the estimate fields required to emit a turn record. */

/**
 * Internal pending entry.  Estimate fields are optional so a turn-context-only
 * stub (created by `attachTurnContext` before any estimate) can occupy the
 * same eviction-bounded map slot as a full estimate.  Once `recordEstimate`
 * fires the estimate fields are populated and `turnContext` is preserved.
 */
interface PendingEntry {
  readonly ts: string;
  readonly promptId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly estimatedTokens?: number;
  readonly estimator?: TokenEstimatorType;
  readonly estimatorMethod?: 'exact' | 'calibrated';
  readonly estimatorFamily?: string;
  readonly estimatorVersion?: string;
  readonly assetRevision?: string;
  readonly projectionRevision?: number;
  readonly protocol?: string;
  readonly tiktokenTokens?: number | null;
  readonly tiktokenEstimationFailed?: boolean;
  readonly turnContext?: Partial<TokenUsageTurnContext>;
  /**
   * Attempt indices already written for this promptId.  One logical turn can
   * produce several billed attempts (#3130 AC-4), so the pending entry is not
   * consumed on the first `recordActual`.  Recording the indices instead keeps
   * the original duplicate-write protection: a second completion for an
   * attempt that was already recorded is dropped rather than double-counted,
   * which would inflate the very burn totals this log exists to measure.
   */
  readonly recordedAttempts: Set<number>;
}

/** Cost + attempt extras extracted from the widened `recordActual` input. */
type ActualExtras = Omit<
  TokenUsageActualInput,
  'actualPromptTokens' | 'cachedTokens'
>;

/** Internal record ready for serialization. */
interface WritableTurnRecord {
  readonly ts: string;
  readonly promptId: string;
  readonly provider: string;
  readonly model: string;
  readonly estimatedTokens: number;
  readonly estimator: TokenEstimatorType;
  readonly estimatorMethod?: 'exact' | 'calibrated';
  readonly estimatorFamily?: string;
  readonly estimatorVersion?: string;
  readonly assetRevision?: string;
  readonly projectionRevision?: number;
  readonly protocol?: string;
  readonly tiktokenTokens: number | null;
  readonly tiktokenEstimationFailed?: boolean;
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly effectiveActualTokens: number;
  readonly turnContext?: Partial<TokenUsageTurnContext>;
  readonly actualExtras: ActualExtras;
}

export class TokenUsageLogger {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly errorLogger = new DebugLogger('llxprt:token-usage-logger');
  private dirEnsured = false;
  private writeChain: Promise<void> = Promise.resolve();
  /**
   * Per-session request-shape memory for the AC-5 new-vs-carried split and
   * the AC-6 prefix-fingerprint change detection. Lives on the logger because
   * the logger is already per-session; bounded internally.
   */
  private readonly shapeMemory = new RequestShapeSessionMemory();

  constructor(
    private readonly enabled: boolean,
    private readonly logFilePath: string | undefined,
  ) {}

  /**
   * Per-session request-shape memory (callId tracking + fingerprint history).
   * Used by the request-shape seam helper to compute AC-5/AC-6 values.
   */
  getShapeMemory(): RequestShapeSessionMemory {
    return this.shapeMemory;
  }

  /**
   * The provider/model that served the previous send in this session, or
   * `undefined` before the first send. Used to detect a provider or model
   * switch by observation at the send seam, which is where the per-session
   * logger is reachable — the settings-layer sites that initiate a switch
   * have no path to it.
   */
  private lastServedBy: { provider: string; model: string } | undefined;

  /**
   * Record which provider/model is serving this send and report the switch
   * that just became observable, or `null` when nothing changed. The caller
   * turns a non-null result into a lifecycle record.
   */
  observeServingProvider(
    provider: string,
    model: string,
  ): { fromProvider: string; fromModel: string } | null {
    const previous = this.lastServedBy;
    this.lastServedBy = { provider, model };
    if (previous === undefined) return null;
    if (previous.provider === provider && previous.model === model) return null;
    return { fromProvider: previous.provider, fromModel: previous.model };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Merge a partial turn context (join keys, request-shape, tool attribution,
   * cache key) into the pending entry for the given promptId.  If no pending
   * entry exists yet, a context-only stub is created — subject to the same
   * PENDING_CAP eviction as estimates — so a later `recordEstimate` /
   * `refineEstimate` for the same promptId preserves it.
   */
  attachTurnContext(
    promptId: string,
    context: Partial<TokenUsageTurnContext>,
  ): void {
    if (!this.enabled) return;
    const existing = this.pending.get(promptId);
    if (existing !== undefined) {
      this.pending.set(promptId, {
        ...existing,
        turnContext: { ...existing.turnContext, ...context },
      });
      return;
    }
    this.evictIfFull();
    this.pending.set(promptId, {
      ts: new Date().toISOString(),
      promptId,
      turnContext: context,
      recordedAttempts: new Set(),
    });
  }

  /**
   * Update the estimate for a prompt that already has a pending record,
   * preserving the tiktoken comparison measured earlier in the turn. Used when
   * a later stage (the finalized prompt envelope) produces a better token
   * count but cannot re-measure tiktoken.
   *
   * When no pending record exists for the promptId the finalized estimate is
   * still recorded, with a null tiktoken baseline: the finalized envelope is
   * the authoritative estimate for the send, and dropping it would lose the
   * estimate entirely. The null baseline records that no tiktoken comparison
   * was measured for this prompt rather than borrowing another prompt's.
   */
  refineEstimate(
    promptId: string,
    data: Omit<
      PendingTokenEstimate,
      'ts' | 'promptId' | 'tiktokenTokens' | 'tiktokenEstimationFailed'
    >,
  ): void {
    if (!this.enabled) return;
    const existing = this.pending.get(promptId);
    this.recordEstimate(promptId, {
      ...data,
      tiktokenTokens: existing?.tiktokenTokens ?? null,
      tiktokenEstimationFailed: existing?.tiktokenEstimationFailed ?? false,
    });
  }

  recordEstimate(
    promptId: string,
    data: Omit<PendingTokenEstimate, 'ts' | 'promptId'>,
  ): void {
    if (!this.enabled) return;
    if (!this.pending.has(promptId)) {
      this.evictIfFull();
    }
    const existing = this.pending.get(promptId);
    const entry: PendingEntry = {
      ts: new Date().toISOString(),
      promptId,
      provider: data.provider,
      model: data.model,
      estimatedTokens: data.estimatedTokens,
      estimator: data.estimator,
      estimatorMethod: data.estimatorMethod,
      estimatorFamily: data.estimatorFamily,
      estimatorVersion: data.estimatorVersion,
      assetRevision: data.assetRevision,
      projectionRevision: data.projectionRevision,
      protocol: data.protocol,
      tiktokenTokens: data.tiktokenTokens,
      tiktokenEstimationFailed: data.tiktokenEstimationFailed,
      turnContext: existing?.turnContext,
      // Carried over, not reset: a re-estimate fires at every send seam
      // (including each retry attempt), and forgetting which attempts were
      // already written would reopen the duplicate-write window.
      recordedAttempts: existing?.recordedAttempts ?? new Set(),
    };
    this.pending.set(promptId, entry);
  }

  private evictIfFull(): void {
    if (this.pending.size >= PENDING_CAP) {
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey !== undefined) {
        this.pending.delete(oldestKey);
        this.errorLogger.debug('Evicted unmatched token estimate at capacity', {
          promptId: oldestKey,
          pendingCap: PENDING_CAP,
        });
      }
    }
  }

  async recordActual(
    promptId: string,
    actual: TokenUsageActualInput,
  ): Promise<void> {
    if (!this.enabled) return;
    const pending = this.pending.get(promptId);
    if (pending === undefined) return;
    // Split guard keeps each expression under the 3-operator complexity limit
    // while preserving TypeScript narrowing for the fields below.
    if (pending.provider === undefined || pending.model === undefined) return;
    if (
      pending.estimatedTokens === undefined ||
      pending.estimator === undefined ||
      pending.tiktokenTokens === undefined
    ) {
      // Context-only stub with no estimate — cannot emit a turn record.
      return;
    }
    // One logical turn can produce several billed attempts, so a non-terminal
    // attempt keeps the pending entry alive for the retry that follows.
    // Duplicate protection becomes "one record per attempt": mark the attempt
    // before awaiting, so a concurrent completion for the same attempt cannot
    // write a second record.
    const attemptIndex = actual.attemptIndex ?? 0;
    if (pending.recordedAttempts.has(attemptIndex)) return;
    pending.recordedAttempts.add(attemptIndex);
    // A terminal outcome ends the turn, so the entry is consumed exactly as it
    // was before multi-attempt support existed. Only 'abandoned' and 'error'
    // are followed by another attempt for the same prompt.
    if (!isRetriedOutcome(actual.attemptOutcome)) {
      this.pending.delete(promptId);
    }

    const effectiveActualTokens = Math.max(
      0,
      actual.actualPromptTokens - actual.cachedTokens,
    );
    const record: WritableTurnRecord = {
      ts: pending.ts,
      promptId: pending.promptId,
      provider: pending.provider,
      model: pending.model,
      estimatedTokens: pending.estimatedTokens,
      estimator: pending.estimator,
      estimatorMethod: pending.estimatorMethod,
      estimatorFamily: pending.estimatorFamily,
      estimatorVersion: pending.estimatorVersion,
      assetRevision: pending.assetRevision,
      projectionRevision: pending.projectionRevision,
      protocol: pending.protocol,
      tiktokenTokens: pending.tiktokenTokens,
      tiktokenEstimationFailed: pending.tiktokenEstimationFailed,
      actualPromptTokens: actual.actualPromptTokens,
      cachedTokens: actual.cachedTokens,
      effectiveActualTokens,
      turnContext: pending.turnContext,
      actualExtras: {
        outputTokens: actual.outputTokens,
        reasoningTokens: actual.reasoningTokens,
        cacheWriteTokens: actual.cacheWriteTokens,
        cacheReadTokens: actual.cacheReadTokens,
        toolTokens: actual.toolTokens,
        totalTokens: actual.totalTokens,
        attemptIndex: actual.attemptIndex,
        attemptOutcome: actual.attemptOutcome,
        retryReason: actual.retryReason,
        httpStatus: actual.httpStatus,
        backendProfile: actual.backendProfile,
      },
    };
    await this._writeTurnRecord(record);
  }

  /**
   * Write a typed lifecycle record (compression, provider switch, etc.) into
   * the same JSONL file through the same serialised write chain.  No-op when
   * the logger is disabled.
   */
  async recordLifecycleEvent(event: TokenUsageLifecycleEvent): Promise<void> {
    if (!this.enabled) return;
    const record = this._toLifecycleRecord(event);
    await this._appendJsonl(record);
  }

  // -----------------------------------------------------------------------
  // Serialization helpers
  // -----------------------------------------------------------------------

  private async _writeTurnRecord(record: WritableTurnRecord): Promise<void> {
    await this._appendJsonl(this._toSerializedTurnRecord(record));
  }

  private async _appendJsonl(record: object): Promise<void> {
    const logFilePath = this.logFilePath;
    if (logFilePath === undefined) return;

    const write = this.writeChain.then(async () => {
      if (!this.dirEnsured) {
        await mkdir(path.dirname(logFilePath), { recursive: true });
        this.dirEnsured = true;
      }
      const line = JSON.stringify(record) + '\n';
      await appendFile(logFilePath, line);
    });
    this.writeChain = write.catch((error: unknown) => {
      this.errorLogger.error('Failed to write token usage record', error);
    });
    await this.writeChain;
  }

  private _toSerializedTurnRecord(
    record: WritableTurnRecord,
  ): SerializedTokenUsageRecord {
    return {
      record_type: 'turn',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ...this._serializeCoreEstimateFields(record),
      ...this._serializeContextFields(record.turnContext),
      ...this._serializeExtraFields(record.actualExtras),
    };
  }

  private _serializeCoreEstimateFields(record: WritableTurnRecord) {
    return {
      ts: record.ts,
      prompt_id: record.promptId,
      provider: record.provider,
      model: record.model,
      estimated_tokens: record.estimatedTokens,
      estimator: record.estimator,
      ...(record.estimatorMethod !== undefined && {
        estimator_method: record.estimatorMethod,
      }),
      ...(record.estimatorFamily !== undefined && {
        estimator_family: record.estimatorFamily,
      }),
      ...(record.estimatorVersion !== undefined && {
        estimator_version: record.estimatorVersion,
      }),
      ...(record.assetRevision !== undefined && {
        asset_revision: record.assetRevision,
      }),
      ...(record.projectionRevision !== undefined && {
        projection_revision: record.projectionRevision,
      }),
      ...(record.protocol !== undefined && { protocol: record.protocol }),
      tiktoken_tokens: record.tiktokenTokens,
      tiktoken_estimation_failed: record.tiktokenEstimationFailed ?? false,
      actual_prompt_tokens: record.actualPromptTokens,
      cached_tokens: record.cachedTokens,
      effective_actual_tokens: record.effectiveActualTokens,
    };
  }

  /**
   * lastToken-ttft window in ms, only when both endpoints are measured and
   * the window is strictly positive — never a total-duration fallback
   * (ProviderPerformanceTracker Finding #7).
   */
  private _generationWindowMs(
    ctx: Partial<TokenUsageTurnContext>,
  ): number | undefined {
    if (typeof ctx.ttftMs !== 'number' || typeof ctx.lastTokenMs !== 'number') {
      return undefined;
    }
    const windowMs = ctx.lastTokenMs - ctx.ttftMs;
    return windowMs > 0 ? windowMs : undefined;
  }

  private _serializeContextFields(
    ctx: Partial<TokenUsageTurnContext> | undefined,
  ) {
    const c = ctx ?? {};
    const generationMs = this._generationWindowMs(c);
    return {
      ...(c.sessionId !== undefined && { session_id: c.sessionId }),
      ...(c.turnId !== undefined && { turn_id: c.turnId }),
      ...(c.userTurn !== undefined && { user_turn: c.userTurn }),
      ...(c.step !== undefined && { step: c.step }),
      ...(c.runtimeId !== undefined && { runtime_id: c.runtimeId }),
      ...(c.parentRuntimeId !== undefined && {
        parent_runtime_id: c.parentRuntimeId,
      }),
      ...(c.subagentName !== undefined && {
        subagent_name: c.subagentName,
      }),
      ...(c.toolCalls !== undefined && {
        tool_calls: c.toolCalls.map((tc) => ({
          call_id: tc.callId,
          tool_name: tc.toolName,
          result_tokens: tc.resultTokens,
          was_truncated: tc.wasTruncated,
        })),
      }),
      ...(c.newToolResultTokens !== undefined && {
        new_tool_result_tokens: c.newToolResultTokens,
      }),
      ...(c.carriedToolResultTokens !== undefined && {
        carried_tool_result_tokens: c.carriedToolResultTokens,
      }),
      ...(c.instructionsTokens !== undefined && {
        instructions_tokens: c.instructionsTokens,
      }),
      ...(c.toolsSchemaTokens !== undefined && {
        tools_schema_tokens: c.toolsSchemaTokens,
      }),
      ...(c.historyTokens !== undefined && {
        history_tokens: c.historyTokens,
      }),
      ...(c.mediaTokens !== undefined && { media_tokens: c.mediaTokens }),
      ...(c.injectedTokens !== undefined && {
        injected_tokens: c.injectedTokens,
      }),
      ...(c.promptCacheKey !== undefined && {
        prompt_cache_key: c.promptCacheKey,
      }),
      ...(c.prefixFingerprint !== undefined && {
        prefix_fingerprint: c.prefixFingerprint,
      }),
      ...(c.prefixFingerprintChanged !== undefined && {
        prefix_fingerprint_changed: c.prefixFingerprintChanged,
      }),
      // #3257: emit only measured values, never zero-filled.
      ...(typeof c.ttftMs === 'number' && { ttft_ms: c.ttftMs }),
      ...(generationMs !== undefined && { generation_ms: generationMs }),
      ...(typeof c.providerRequestMs === 'number' && {
        provider_request_ms: c.providerRequestMs,
      }),
      ...(c.chunkCount !== undefined && { chunk_count: c.chunkCount }),
    };
  }

  private _serializeExtraFields(extras: ActualExtras) {
    return {
      ...(extras.outputTokens !== undefined && {
        output_tokens: extras.outputTokens,
      }),
      ...(extras.reasoningTokens !== undefined && {
        reasoning_tokens: extras.reasoningTokens,
      }),
      ...(extras.cacheWriteTokens !== undefined && {
        cache_write_tokens: extras.cacheWriteTokens,
      }),
      ...(extras.cacheReadTokens !== undefined && {
        cache_read_tokens: extras.cacheReadTokens,
      }),
      ...(extras.toolTokens !== undefined && {
        tool_tokens: extras.toolTokens,
      }),
      ...(extras.totalTokens !== undefined && {
        total_tokens: extras.totalTokens,
      }),
      ...(extras.attemptIndex !== undefined && {
        attempt_index: extras.attemptIndex,
      }),
      ...(extras.attemptOutcome !== undefined && {
        attempt_outcome: extras.attemptOutcome,
      }),
      ...(extras.retryReason !== undefined && {
        retry_reason: extras.retryReason,
      }),
      ...(extras.httpStatus !== undefined && {
        http_status: extras.httpStatus,
      }),
      ...(extras.backendProfile !== undefined && {
        backend_profile: extras.backendProfile,
      }),
    };
  }

  private _toLifecycleRecord(
    event: TokenUsageLifecycleEvent,
  ): SerializedTokenUsageLifecycleRecord {
    switch (event.type) {
      case 'compression':
        return this._toCompressionRecord(event);
      case 'provider_switch':
        return this._toProviderSwitchRecord(event);
      case 'model_switch':
        return this._toModelSwitchRecord(event);
      case 'session_resume':
        return this._toSessionResumeRecord(event);
      case 'context_truncation':
        return this._toContextTruncationRecord(event);
      default:
        // Exhaustive guard — unreachable for a well-typed TokenUsageLifecycleEvent.
        throw new Error(
          `TokenUsageLoggerError: unhandled lifecycle event type`,
        );
    }
  }

  private _toCompressionRecord(
    event: TokenUsageCompressionEvent,
  ): SerializedTokenUsageLifecycleRecord {
    return {
      record_type: 'compression',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ts: event.ts ?? new Date().toISOString(),
      session_id: event.sessionId,
      turn_id: event.turnId ?? null,
      tokens_before: event.tokensBefore,
      tokens_after: event.tokensAfter,
      compression_model: event.compressionModel ?? null,
      compression_provider: event.compressionProvider ?? null,
      ...(event.compressionPromptTokens !== undefined && {
        compression_prompt_tokens: event.compressionPromptTokens,
      }),
      ...(event.compressionOutputTokens !== undefined && {
        compression_output_tokens: event.compressionOutputTokens,
      }),
    };
  }

  private _toProviderSwitchRecord(
    event: TokenUsageProviderSwitchEvent,
  ): SerializedTokenUsageLifecycleRecord {
    return {
      record_type: 'provider_switch',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ts: event.ts ?? new Date().toISOString(),
      session_id: event.sessionId,
      turn_id: event.turnId ?? null,
      from_provider: event.fromProvider ?? null,
      to_provider: event.toProvider,
      from_model: event.fromModel ?? null,
      to_model: event.toModel ?? null,
    };
  }

  private _toModelSwitchRecord(
    event: TokenUsageModelSwitchEvent,
  ): SerializedTokenUsageLifecycleRecord {
    return {
      record_type: 'model_switch',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ts: event.ts ?? new Date().toISOString(),
      session_id: event.sessionId,
      turn_id: event.turnId ?? null,
      from_model: event.fromModel ?? null,
      to_model: event.toModel,
      provider: event.provider,
    };
  }

  private _toSessionResumeRecord(
    event: TokenUsageSessionResumeEvent,
  ): SerializedTokenUsageLifecycleRecord {
    return {
      record_type: 'session_resume',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ts: event.ts ?? new Date().toISOString(),
      session_id: event.sessionId,
      turn_id: event.turnId ?? null,
      resumed_session_id: event.resumedSessionId ?? null,
      restored_history_items: event.restoredHistoryItems,
      restored_tokens: event.restoredTokens ?? null,
    };
  }

  private _toContextTruncationRecord(
    event: TokenUsageContextTruncationEvent,
  ): SerializedTokenUsageLifecycleRecord {
    return {
      record_type: 'context_truncation',
      schema_version: TOKEN_USAGE_SCHEMA_VERSION,
      ts: event.ts ?? new Date().toISOString(),
      session_id: event.sessionId,
      turn_id: event.turnId ?? null,
      tokens_before: event.tokensBefore,
      tokens_after: event.tokensAfter,
      dropped_items: event.droppedItems,
      reason: event.reason ?? null,
    };
  }
}
