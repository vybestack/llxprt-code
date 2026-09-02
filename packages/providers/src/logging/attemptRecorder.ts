/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AttemptEndInfo,
  AttemptLifecycleObserver,
  AttemptStartInfo,
} from './attemptLifecycle.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { logApiError } from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import { ApiErrorEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getPerfPhaseObserver } from '@vybestack/llxprt-code-core/perf/perfPhaseObserver.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type ResponseTokenCounts,
  emitMetricsTelemetry,
  emitResponseTelemetry,
} from './telemetryEmitter.js';
import {
  type TokenCounts,
  extractTokenCountsFromTokenUsage,
} from './tokenCounts.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';

/**
 * Normalizes a numeric value to a non-negative finite number, or 0.
 */
function sanitize(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Normalizes a timestamp to null if not a positive finite number.
 */
function sanitizeTimestamp(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Active attempt state tracked between onAttemptStart and onAttemptEnd.
 */
interface ActiveAttempt {
  readonly attemptId: string;
  readonly attemptIndex: number;
  readonly providerName: string;
  readonly modelName: string;
  readonly requestStartMs: number;
  firstTokenMs: number | null;
  lastTokenMs: number | null;
  /**
   * True once a raw token-delta timing signal (issue #3473) has stamped
   * this attempt. Raw-delta timing is then authoritative: later deferred
   * visible emissions (terminal combined chunk, buffered-text flush) still
   * update usage, streamedText, chunkCount, and finishReasons but must not
   * overwrite first/last token timestamps.
   */
  rawTimingStamped: boolean;
  latestTokenUsage: UsageStats | undefined;
  streamedText: string;
  chunkCount: number;
  hasEmittedTerminal: boolean;
  finishReasons: string[];
}

/**
 * Token counts resolved once at attempt end with the emitAttemptRecord
 * precedence, feeding both the telemetry record and the perf observer's
 * end notification.
 */
interface ResolvedAttemptTokens {
  tokenCounts: ResponseTokenCounts;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  toolTokens: number;
}

/**
 * Options for constructing an AttemptRecorder.
 */
export interface AttemptRecorderOptions {
  readonly providerName: string;
  readonly defaultModelName: string;
  readonly config: Config | undefined;
  readonly logicalRequestId: string;
  /**
   * When true, the wrapper (LoggingProviderWrapper) is the sole lifecycle
   * owner. It will create exactly one attempt via ensureAttemptStarted and
   * finalize it via finalizeAttempt. External lifecycle notifications
   * (onAttemptStart/onAttemptEnd) are accepted but typically not used.
   *
   * When false, an external owner (RetryOrchestrator or a provider-owned
   * transport) is the canonical lifecycle owner. ensureAttemptStarted and
   * finalizeAttempt are no-ops.
   */
  readonly wrapperOwned: boolean;
}

/**
 * The AttemptRecorder implements AttemptLifecycleObserver so the
 * RetryOrchestrator or a provider-owned transport can invoke it for each
 * raw provider attempt.
 *
 * Ownership model:
 * - wrapperOwned=true: The wrapper creates one attempt before provider
 *   invocation and finalizes it at terminal (success/error/aborted).
 * - wrapperOwned=false: External lifecycle owner fires onAttemptStart/
 *   onAttemptEnd per attempt. The wrapper's ensureAttemptStarted and
 *   finalizeAttempt are no-ops.
 *
 * Guarantees:
 * - Exactly one terminal telemetry record per raw attempt
 * - Stable nonempty attempt IDs provided by the lifecycle owner
 * - Monotonic timestamps (performance.now-based)
 * - No phantom attempt when an external owner is present
 * - Fail-open: emit/export errors (emitAttemptRecord, emitMetricsTelemetry,
 *   logApiError) never propagate into the stream path. Perf phase observer
 *   invocations are the exception: they propagate fail-fast per D8 so a
 *   programming error in the observer is surfaced immediately rather than
 *   silently corrupting telemetry.
 */
export class AttemptRecorder implements AttemptLifecycleObserver {
  private readonly logger = new DebugLogger('llxprt:attempt:recorder');
  private readonly attempts = new Map<string, ActiveAttempt>();
  /** Ordered list of attempt IDs for sequential access */
  private readonly attemptOrder: string[] = [];
  private attemptCounter = 0;
  private readonly wrapperOwned: boolean;
  private readonly providerName: string;
  private readonly defaultModelName: string;
  private readonly config: Config | undefined;
  private readonly logicalRequestId: string;

  constructor(opts: AttemptRecorderOptions) {
    this.providerName = opts.providerName;
    this.defaultModelName = opts.defaultModelName;
    this.config = opts.config;
    this.logicalRequestId = opts.logicalRequestId;
    this.wrapperOwned = opts.wrapperOwned;
  }

  /**
   * Called at the start of each raw provider attempt by the lifecycle
   * owner. The attemptId from info is authoritative.
   */
  onAttemptStart(info: AttemptStartInfo): void {
    const attemptId =
      info.attemptId !== ''
        ? info.attemptId
        : `${this.logicalRequestId}#a${this.attemptCounter}`;

    const requestStartMs =
      info.requestStartMs > 0 ? info.requestStartMs : performance.now();

    if (this.attempts.has(attemptId)) return;

    this.attempts.set(attemptId, {
      attemptId,
      attemptIndex: info.attemptIndex,
      providerName: info.providerName ?? this.providerName,
      modelName: info.modelName ?? this.defaultModelName,
      requestStartMs,
      firstTokenMs: null,
      lastTokenMs: null,
      rawTimingStamped: false,
      latestTokenUsage: undefined,
      streamedText: '',
      chunkCount: 0,
      hasEmittedTerminal: false,
      finishReasons: [],
    });
    this.attemptOrder.push(attemptId);
    this.attemptCounter++;

    // Perf phase observer (P07): notify at the exact attempt-start boundary.
    // Default-off: null observer short-circuits. Invoked directly (no
    // try/catch) so internal errors propagate fail-fast (D8).
    const perfObserver = getPerfPhaseObserver();
    if (perfObserver !== null) {
      perfObserver.onProviderAttemptStart({
        attemptId,
        promptId: this.logicalRequestId,
        startMs: requestStartMs,
      });
    }
  }

  /**
   * Record a token-bearing chunk for the given attempt. Updates timing
   * (first/last token timestamps) and accumulates text. Only token-bearing
   * chunks should be passed here — metadata-only chunks must use
   * recordMetadataUsage instead.
   *
   * When raw token-delta timing has already stamped the attempt (issue
   * #3473), those raw stamps are authoritative: this method still updates
   * usage, streamedText, chunkCount, and finishReasons but leaves
   * first/last token timestamps untouched, because deferred visible
   * emissions (terminal combined chunk, buffered-text flush) trail the
   * final raw delta.
   */
  recordTokenBearingChunk(
    attemptId: string,
    usage: UsageStats | undefined,
    text: string,
    finishReason?: string,
  ): void {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    if (!attempt.rawTimingStamped) {
      const now = performance.now();
      attempt.firstTokenMs ??= now;
      attempt.lastTokenMs = now;
    }

    if (usage) {
      attempt.latestTokenUsage = usage;
    }
    attempt.streamedText += text;
    attempt.chunkCount++;
    if (finishReason && !attempt.finishReasons.includes(finishReason)) {
      attempt.finishReasons.push(finishReason);
    }
  }

  /**
   * Record a raw token-delta timing signal for the given attempt (issue
   * #3473). Stamps firstTokenMs/lastTokenMs via performance.now() without
   * touching chunkCount, streamedText, usage, or finishReasons, and makes
   * the raw stamps authoritative over later visible-chunk stamps.
   */
  recordTimingOnly(attemptId: string): void {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    const now = performance.now();
    attempt.firstTokenMs ??= now;
    attempt.lastTokenMs = now;
    attempt.rawTimingStamped = true;
  }

  /**
   * Raw token-delta timing hook (issue #3473): invoked by the provider
   * stream processor through the lifecycle-observer metadata channel at
   * each raw token-bearing delta. Timing travels on this internal channel,
   * never as stream output, so it cannot affect consumer-visible chunk
   * sequences or retry/timeout/load-balancer content semantics.
   */
  onRawTokenDelta(): void {
    const attemptId = this.getCurrentAttemptId();
    if (attemptId) {
      this.recordTimingOnly(attemptId);
    }
  }

  /**
   * Record usage metadata from a metadata-only chunk (no token-bearing
   * output) for the current active attempt. Updates latestTokenUsage
   * independently of token-bearing timing — does NOT touch first/last
   * token timestamps.
   */
  recordMetadataUsage(
    attemptId: string,
    usage: UsageStats | undefined,
    finishReason?: string,
  ): void {
    if (!usage && !finishReason) return;
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    if (usage) {
      attempt.latestTokenUsage = usage;
    }
    if (finishReason && !attempt.finishReasons.includes(finishReason)) {
      attempt.finishReasons.push(finishReason);
    }
  }

  /**
   * Called at the terminal end of each raw attempt by the lifecycle
   * owner. Emits exactly one telemetry record.
   */
  onAttemptEnd(info: AttemptEndInfo): void {
    const attemptId =
      info.attemptId !== ''
        ? info.attemptId
        : this.attemptOrder[this.attemptOrder.length - 1];
    if (!attemptId) return;
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.hasEmittedTerminal) {
      return;
    }
    attempt.hasEmittedTerminal = true;

    // Resolve token counts once with the emitAttemptRecord precedence
    // (non-zero info values win, else counts resolved from accumulated
    // usage/text) — the perf observer below needs the resolved values
    // because orchestrator-owned attempts end with zero info metrics
    // (#3257). Resolution runs inside the fail-open boundary: malformed
    // provider usage (genuinely external data) falls back to the raw info
    // counts so telemetry, pruning, and the perf-observer notification
    // still run.
    let resolved: ResolvedAttemptTokens;
    try {
      resolved = this.resolveAttemptTokens(attempt, info);
    } catch (err) {
      this.logger.error(
        () =>
          `Failed to resolve attempt tokens: ${err instanceof Error ? err.message : String(err)}`,
      );
      resolved = {
        tokenCounts: this.resolveTokenCounts(undefined, ''),
        inputTokens: sanitize(info.inputTokens),
        outputTokens: sanitize(info.outputTokens),
        cachedTokens: sanitize(info.cachedTokens),
        thoughtsTokens: sanitize(info.thoughtsTokens),
        toolTokens: sanitize(info.toolTokens),
      };
    }

    try {
      this.emitAttemptRecord(attempt, info, resolved);
    } catch (err) {
      this.logger.error(
        () =>
          `Failed to emit attempt record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Prune terminal attempts to prevent unbounded memory growth in
    // long-lived recorder instances.
    this.pruneTerminalAttempts();

    // Perf phase observer (P07): notify at the exact attempt-end boundary.
    // Invoked AFTER the try/catch above so an internal observer/programming
    // error propagates fail-fast (D8) rather than being swallowed by the
    // emitAttemptRecord catch. The observer fires before any SDK/export
    // gate so SDK-disabled mode still notifies. Default-off: null observer
    // short-circuits.
    const perfObserver = getPerfPhaseObserver();
    if (perfObserver !== null) {
      const completionMs =
        sanitizeTimestamp(info.completionMs) ?? performance.now();
      perfObserver.onProviderAttemptEnd({
        attemptId,
        promptId: this.logicalRequestId,
        startMs: attempt.requestStartMs,
        endMs: completionMs,
        status: info.status,
        inputTokens: resolved.inputTokens,
        outputTokens: resolved.outputTokens,
      });
    }
  }

  /** Maximum number of terminal attempts to retain before pruning. */
  private static readonly MAX_RETAINED_ATTEMPTS = 50;

  private pruneTerminalAttempts(): void {
    if (this.attemptOrder.length <= AttemptRecorder.MAX_RETAINED_ATTEMPTS) {
      return;
    }
    // Remove terminal attempts from anywhere in the queue until we are
    // within the retention limit. Non-terminal (in-flight) attempts are
    // always kept. This prevents unbounded growth in concurrent scenarios
    // where a long-running attempt sits at the front of attemptOrder.
    let removed = 0;
    const pruneCount =
      this.attemptOrder.length - AttemptRecorder.MAX_RETAINED_ATTEMPTS;
    for (
      let i = this.attemptOrder.length - 1;
      i >= 0 && removed < pruneCount;
      i--
    ) {
      const id = this.attemptOrder[i];
      const attempt = this.attempts.get(id);
      if (attempt?.hasEmittedTerminal === true) {
        this.attempts.delete(id);
        this.attemptOrder.splice(i, 1);
        removed++;
      }
    }
  }

  /**
   * Token counts resolved once per terminal attempt with the precedence:
   * non-zero info values win, else the counts resolved from accumulated
   * usage/text.
   */
  private resolveAttemptTokens(
    attempt: ActiveAttempt,
    info: AttemptEndInfo,
  ): ResolvedAttemptTokens {
    const tokenCounts = this.resolveTokenCounts(
      attempt.latestTokenUsage,
      attempt.streamedText,
    );
    return {
      tokenCounts,
      inputTokens: sanitize(
        info.inputTokens !== 0
          ? info.inputTokens
          : tokenCounts.input_token_count,
      ),
      outputTokens: sanitize(
        info.outputTokens !== 0
          ? info.outputTokens
          : tokenCounts.output_token_count,
      ),
      cachedTokens: sanitize(
        info.cachedTokens !== 0
          ? info.cachedTokens
          : tokenCounts.cached_content_token_count,
      ),
      thoughtsTokens: sanitize(
        info.thoughtsTokens !== 0
          ? info.thoughtsTokens
          : tokenCounts.thoughts_token_count,
      ),
      toolTokens: sanitize(
        info.toolTokens !== 0 ? info.toolTokens : tokenCounts.tool_token_count,
      ),
    };
  }

  /**
   * Emit the terminal telemetry record for a single attempt.
   */
  private emitAttemptRecord(
    attempt: ActiveAttempt,
    info: AttemptEndInfo,
    resolved: ResolvedAttemptTokens,
  ): void {
    const startMs = info.start;
    const completionMs =
      sanitizeTimestamp(info.completionMs) ?? performance.now();
    const firstTokenMs = sanitizeTimestamp(attempt.firstTokenMs);
    const lastTokenMs = sanitizeTimestamp(attempt.lastTokenMs);
    const durationMs = Math.max(0, completionMs - startMs);

    // Convert monotonic absolute timestamps to request-relative offsets
    const ttftMs =
      firstTokenMs !== null ? Math.max(0, firstTokenMs - startMs) : null;
    const lastTokenRelMs =
      lastTokenMs !== null ? Math.max(0, lastTokenMs - startMs) : null;

    const { tokenCounts } = resolved;

    // Preserve actual provider/model from the attempt state rather than
    // the callback info, which may carry wrapper-level names.
    const providerName = info.providerName || attempt.providerName;
    const modelName = info.modelName || attempt.modelName;

    const isConversationLoggingEnabled =
      this.config?.getConversationLoggingEnabled() === true;

    if (info.status === 'success') {
      this.emitSuccessRecord(
        attempt,
        info,
        tokenCounts,
        resolved.inputTokens,
        resolved.outputTokens,
        resolved.cachedTokens,
        resolved.thoughtsTokens,
        resolved.toolTokens,
        providerName,
        modelName,
        durationMs,
        ttftMs,
        lastTokenRelMs,
        isConversationLoggingEnabled,
      );
    } else {
      this.emitErrorRecord(
        attempt,
        info,
        providerName,
        modelName,
        durationMs,
        ttftMs,
        lastTokenRelMs,
        resolved.inputTokens,
        resolved.outputTokens,
        resolved.cachedTokens,
        resolved.thoughtsTokens,
        resolved.toolTokens,
        tokenCounts,
      );
    }
  }

  /**
   * Resolve the finish reasons array for telemetry: prefer the callback
   * info's finishReasons when non-empty, then fall back to the attempt's
   * accumulated finishReasons, then undefined.
   */
  private resolveFinishReasons(
    info: AttemptEndInfo,
    attempt: ActiveAttempt,
  ): string[] | undefined {
    if (info.finishReasons !== undefined && info.finishReasons.length > 0) {
      return info.finishReasons;
    }
    if (attempt.finishReasons.length > 0) {
      return attempt.finishReasons;
    }
    return undefined;
  }

  private emitSuccessRecord(
    attempt: ActiveAttempt,
    info: AttemptEndInfo,
    tokenCounts: ResponseTokenCounts,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    thoughtsTokens: number,
    toolTokens: number,
    providerName: string,
    modelName: string,
    durationMs: number,
    firstTokenMs: number | null,
    lastTokenMs: number | null,
    isConversationLoggingEnabled: boolean,
  ): void {
    const normalizedCounts: ResponseTokenCounts = {
      ...tokenCounts,
      input_token_count: inputTokens,
      output_token_count: outputTokens,
      cached_content_token_count: cachedTokens,
      thoughts_token_count: thoughtsTokens,
      tool_token_count: toolTokens,
    };

    if (isConversationLoggingEnabled && this.config) {
      emitResponseTelemetry(
        this.config,
        normalizedCounts,
        modelName,
        attempt.attemptId,
        durationMs,
        this.resolveFinishReasons(info, attempt),
        true,
        undefined,
        {
          providerName,
          conversationId: this.logicalRequestId,
          turnNumber: attempt.attemptIndex,
          defaultModelName: this.defaultModelName,
        },
        {
          attemptId: attempt.attemptId,
          providerName,
          timeToFirstTokenMs: firstTokenMs,
          lastTokenMs,
          hasUsage: attempt.latestTokenUsage !== undefined,
          startMs: attempt.requestStartMs,
        },
      );
    } else {
      emitMetricsTelemetry(
        this.config,
        normalizedCounts,
        modelName,
        durationMs,
        this.resolveFinishReasons(info, attempt),
        {
          attemptId: attempt.attemptId,
          promptId: this.logicalRequestId,
          providerName,
          timeToFirstTokenMs: firstTokenMs,
          lastTokenMs,
          hasUsage: attempt.latestTokenUsage !== undefined,
          startMs: attempt.requestStartMs,
        },
      );
    }
  }

  /**
   * Emit error/abort telemetry with last token, tokens, categories, cache,
   * and usage presence.
   */
  private emitErrorRecord(
    attempt: ActiveAttempt,
    info: AttemptEndInfo,
    providerName: string,
    modelName: string,
    durationMs: number,
    firstTokenMs: number | null,
    lastTokenMs: number | null,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    thoughtsTokens: number,
    toolTokens: number,
    tokenCounts: ResponseTokenCounts,
  ): void {
    if (!this.config) return;

    try {
      const errorEvent = new ApiErrorEvent(
        modelName,
        info.errorMessage ?? 'Unknown error',
        durationMs,
        this.logicalRequestId,
        info.status === 'aborted' ? 'consumer_abort' : 'stream_error',
        undefined,
        attempt.attemptId,
      );
      errorEvent.provider = providerName;
      errorEvent.time_to_first_token_ms = firstTokenMs;
      errorEvent.last_token_ms = lastTokenMs;
      errorEvent.start_ms = attempt.requestStartMs;
      errorEvent.input_token_count = inputTokens;
      errorEvent.output_token_count = outputTokens;
      errorEvent.cached_content_token_count = cachedTokens;
      errorEvent.thoughts_token_count = thoughtsTokens;
      errorEvent.tool_token_count = toolTokens;
      errorEvent.cache_read_input_tokens = tokenCounts.cache_read_input_tokens;
      errorEvent.cache_creation_input_tokens =
        tokenCounts.cache_creation_input_tokens;
      errorEvent.usage_metadata_present =
        attempt.latestTokenUsage !== undefined;
      errorEvent.provider_owned = true;
      logApiError(this.config, errorEvent);
    } catch (err) {
      this.logger.error(
        () =>
          `logApiError failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Resolve token counts from UsageStats metadata or estimate from text.
   */
  private resolveTokenCounts(
    usage: UsageStats | undefined,
    streamedText: string,
  ): ResponseTokenCounts {
    if (usage) {
      const counts: TokenCounts & {
        cache_creation_input_tokens: number | null;
      } = extractTokenCountsFromTokenUsage(usage, this.logger);
      return counts;
    }
    return {
      input_token_count: 0,
      output_token_count:
        streamedText.length > 0 ? estimateTokens(streamedText) : 0,
      cached_content_token_count: 0,
      thoughts_token_count: 0,
      tool_token_count: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: null,
    };
  }

  /**
   * Get the active attempt ID for the most recent attempt.
   */
  getCurrentAttemptId(): string | undefined {
    if (this.attemptOrder.length === 0) return undefined;
    return this.attemptOrder[this.attemptOrder.length - 1];
  }

  /**
   * Ensure an attempt exists for stream processing. Only creates an
   * attempt when wrapperOwned is true and no attempt exists yet.
   * When an external lifecycle owner is present (wrapperOwned=false),
   * this is a no-op.
   */
  ensureAttemptStarted(): boolean {
    if (!this.wrapperOwned) return false;
    if (this.attemptCounter > 0) return false;
    this.onAttemptStart({
      requestStartMs: performance.now(),
      attemptId: '',
      attemptIndex: 0,
    });
    return true;
  }

  /**
   * Finalize the current attempt with status and token data. This is the
   * sole terminal path for wrapper-owned lifecycle (direct/no-retry
   * providers). When wrapperOwned is false, this is a no-op — the
   * external lifecycle owner is responsible for calling onAttemptEnd.
   * The status passed here is authoritative.
   */
  finalizeAttempt(
    status: 'success' | 'error' | 'aborted',
    modelName: string,
    latestTokenUsage?: UsageStats,
    errorMessage?: string,
  ): void {
    if (!this.wrapperOwned) return;

    const attemptId = this.getCurrentAttemptId();
    if (!attemptId) return;
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.hasEmittedTerminal) return;

    // Update usage from metadata if not already captured
    if (latestTokenUsage && !attempt.latestTokenUsage) {
      attempt.latestTokenUsage = latestTokenUsage;
    }

    // Zero info counts: onAttemptEnd's guarded resolution is the single
    // resolution point for every lifecycle shape, so malformed usage on
    // this path cannot throw before the fail-open boundary (#3257).
    this.onAttemptEnd({
      attemptId: '',
      attemptIndex: attempt.attemptIndex,
      start: attempt.requestStartMs,
      completionMs: performance.now(),
      firstTokenMs: attempt.firstTokenMs,
      lastTokenMs: attempt.lastTokenMs,
      status,
      providerName: this.providerName,
      modelName,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      finishReasons: attempt.finishReasons,
      errorMessage,
    });
  }

  /**
   * Number of attempts started so far.
   */
  get attemptCount(): number {
    return this.attemptCounter;
  }
}
