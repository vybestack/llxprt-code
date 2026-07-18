/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical session-level metrics aggregator.
 *
 * This is the single source of truth for API attempt accounting, token totals,
 * timing, and throughput metrics. It replaces the fragmented approach where
 * UiTelemetryService, ProviderPerformanceTracker, and TokenUsageTracker each
 * tracked their own copies.
 *
 * Design principles:
 * - Compact accumulators, not unbounded histories (except intervals for union)
 * - Deduplication by stable attemptId/toolCallId
 * - All formulas use weighted sums (Σ numerator / Σ denominator), never
 *   arithmetic means of per-request rates
 * - Monotonic-safe: NaN/Infinity treated as zero
 */

export interface ApiAttemptRecord {
  /** Stable unique ID for deduplication */
  attemptId: string;
  model: string;
  provider: string;
  isError: boolean;
  /** True when the provider reported valid usage data for this attempt.
   * Requests without usage must not contribute to rate numerators or
   * denominators. */
  hasUsage: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  toolTokens: number;
  /** Wall-clock duration of the API request (includes TTFT) */
  durationMs: number;
  /** Time to first token, or null if unknown */
  timeToFirstTokenMs: number | null;
  /** Time of last token-bearing chunk (relative to request start), or null */
  lastTokenMs?: number | null;
  /** Cache reads from Anthropic-style usage, or undefined if not reported */
  cacheReads?: number;
  /** Cache writes, or null/undefined if not reported */
  cacheWrites?: number | null;
  /** Monotonic timestamp (ms) when the request started */
  timestampMs: number;
}

export interface ModelBreakdown {
  totalRequests: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalThoughtsTokens: number;
  totalToolTokens: number;
  totalLatencyMs: number;
}

export interface SessionMetricsSnapshot {
  totalApiRequests: number;
  totalApiErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalThoughtsTokens: number;
  totalToolTokens: number;
  totalUncachedInputTokens: number;

  /** 60 * Σ(P+O) / ΣD — excludes gaps, tool time, idle */
  completeTokensPerMinute: number;
  /** Σ(O-1)/ΣG * 1000 tok/s where G = duration - TTFT, only O>=2, G>0 */
  outputGenerationTps: number;
  /** ΣP / ΣTTFT * 1000 tok/s (effective/observed) */
  effectiveInputTps: number;
  /** Σmax(0,P-C) / ΣTTFT * 1000 tok/s, or null if no reliable cache data */
  uncachedInputTps: number | null;
  /** TPM for the last recorded attempt */
  lastRequestTpm: number;

  /** TTFT of the last valid attempt, or null */
  lastTtftMs: number | null;
  /** Weighted-average TTFT: ΣTTFT / count_of_valid_attempts, or null */
  weightedAvgTtftMs: number | null;
  /** Output generation TPS for the last qualifying attempt, or 0 */
  lastOutputGenerationTps: number;
  /** Effective input TPS for the last qualifying attempt, or 0 */
  lastEffectiveInputTps: number;

  /** Σ of all API request durations */
  accumulatedApiTimeMs: number;
  /** Σ of all tool call durations */
  totalToolTimeMs: number;
  /** Union of API + tool activity intervals (overlap counted once) */
  agentActiveTimeMs: number;
  /** API time + tool time (may overlap) */
  accumulatedWorkMs: number;
  /** Session wall-clock start (ms), or null if not set */
  sessionStartMs: number | null;
  /** Current wall-clock time (ms) at snapshot read */
  sessionCurrentMs: number;
  /** Total session wall-clock duration (ms): current - start */
  sessionWallMs: number;

  totalToolCalls: number;
  totalToolSuccesses: number;
  totalToolFailures: number;
  totalToolCancellations: number;

  /** Whether any request reported reliable cache-read or cache-write data */
  hasReliableCacheData: boolean;
  /** Whether any request reported reliable cache-read data */
  hasReliableCacheReads: boolean;
  /** Whether any request reported reliable cache-write data */
  hasReliableCacheWrites: boolean;
  totalCacheReads: number;
  totalCacheWrites: number | null;
  /** Number of requests that reported cache reads (regardless of value) */
  requestsWithCacheReads: number;
  /** Number of requests that reported cache writes (regardless of value) */
  requestsWithCacheWrites: number;

  models: Record<string, ModelBreakdown>;
}

interface Interval {
  start: number;
  end: number;
}

interface CompactTimingSums {
  sumInputPlusOutput: number;
  sumDurationMs: number;
  /** Duration denominator for rate metrics — only successful + positive */
  sumDurationForRateMs: number;
  /** Output generation: Σ(O-1) for O>=2, G>0 */
  sumOutputMinusOne: number;
  /** Σ(first-token-to-final completion) */
  sumGenerationGapMs: number;
  /** Effective input: ΣP for TTFT>0 */
  sumInputForTtft: number;
  sumTtftMs: number;
  /** Count of attempts with valid TTFT for weighted average */
  ttftCount: number;
  /** Uncached input: Σmax(0,P-C) for TTFT>0 when cache data is reliable */
  sumUncachedForTtft: number;
  sumUncachedTtftMs: number;
  lastRequestTokens: number;
  lastRequestDurationMs: number;
  /** TTFT of the last valid attempt */
  lastTtftMs: number | null;
  /** Output tokens of the last qualifying attempt (for last gen TPS) */
  lastOutputTokens: number;
  /** Generation gap of the last qualifying attempt */
  lastGenerationGapMs: number;
  /** Input tokens of the last TTFT-qualifying attempt */
  lastInputForTtft: number;
  /** TTFT of the last TTFT-qualifying attempt */
  lastTtftForRate: number | null;
}

function sanitizeFinite(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Unbounded deduplication set for session-lifetime exactly-once tracking.
 * IDs are retained until reset() so replayed older attempts are not
 * double-counted.
 */
class DedupSet {
  private readonly entries = new Set<string>();

  has(value: string): boolean {
    return this.entries.has(value);
  }

  add(value: string): void {
    this.entries.add(value);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Incrementally maintained, sorted, non-overlapping interval list.
 *
 * Each insertion is O(n) worst-case (binary-search position + neighbor
 * merge) — never a full O(n log n) re-sort. The union is kept exact for
 * the entire session lifetime: no intervals are evicted or merged across
 * gaps, so a late-arriving out-of-order interval that overlaps an earlier
 * one is always applied correctly. Gaps are never bridged.
 */
class IntervalUnion {
  private intervals: Interval[] = [];
  private cachedDuration = 0;

  add(start: number, end: number): void {
    // Reject non-finite endpoints so NaN/Infinity cannot poison the union
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) return;
    this.insertSorted({ start, end });
    this.recomputeDuration();
  }

  get duration(): number {
    return this.cachedDuration;
  }

  get count(): number {
    return this.intervals.length;
  }

  get latestEnd(): number {
    return this.intervals[this.intervals.length - 1]?.end ?? 0;
  }

  getMerged(): readonly Interval[] {
    return this.intervals;
  }

  clear(): void {
    this.intervals = [];
    this.cachedDuration = 0;
  }

  private insertSorted(interval: Interval): void {
    const list = this.intervals;
    if (list.length === 0) {
      list.push(interval);
      return;
    }

    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start < interval.start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo > 0 && list[lo - 1].end >= interval.start) {
      lo--;
      list[lo].end = Math.max(list[lo].end, interval.end);
    } else {
      list.splice(lo, 0, interval);
    }

    const i = lo + 1;
    while (i < list.length && list[i].start <= list[lo].end) {
      list[lo].end = Math.max(list[lo].end, list[i].end);
      list.splice(i, 1);
    }
  }

  private recomputeDuration(): void {
    let total = 0;
    for (const iv of this.intervals) {
      total += iv.end - iv.start;
    }
    this.cachedDuration = total;
  }
}

export class SessionMetricsAggregator {
  private readonly seenAttemptIds = new DedupSet();
  private readonly seenToolCallIds = new DedupSet();
  private readonly activeIntervals = new IntervalUnion();

  private totalApiRequests = 0;
  private totalApiErrors = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedTokens = 0;
  private totalThoughtsTokens = 0;
  private totalToolTokens = 0;

  private totalToolTimeMs = 0;
  private totalToolCalls = 0;
  private totalToolSuccesses = 0;
  private totalToolFailures = 0;
  private totalToolCancellations = 0;

  private hasReliableCacheReads = false;
  private hasReliableCacheWrites = false;
  private totalCacheReads = 0;
  private totalCacheWrites: number | null = null;
  private requestsWithCacheReads = 0;
  private requestsWithCacheWrites = 0;

  /** Monotonic session start timestamp (ms), set on first record */
  private sessionStartMs: number | null = null;

  private readonly timing: CompactTimingSums = {
    sumInputPlusOutput: 0,
    sumDurationMs: 0,
    sumDurationForRateMs: 0,
    sumOutputMinusOne: 0,
    sumGenerationGapMs: 0,
    sumInputForTtft: 0,
    sumTtftMs: 0,
    ttftCount: 0,
    sumUncachedForTtft: 0,
    sumUncachedTtftMs: 0,
    lastRequestTokens: 0,
    lastRequestDurationMs: 0,
    lastTtftMs: null,
    lastOutputTokens: 0,
    lastGenerationGapMs: 0,
    lastInputForTtft: 0,
    lastTtftForRate: null,
  };

  private readonly models: Record<string, ModelBreakdown> = Object.create(
    null,
  ) as Record<string, ModelBreakdown>;

  recordApiAttempt(record: ApiAttemptRecord): boolean {
    if (this.seenAttemptIds.has(record.attemptId)) {
      return false;
    }
    this.seenAttemptIds.add(record.attemptId);

    if (Number.isFinite(record.timestampMs) && record.timestampMs >= 0) {
      if (this.sessionStartMs === null) {
        this.sessionStartMs = record.timestampMs;
      } else {
        this.sessionStartMs = Math.min(this.sessionStartMs, record.timestampMs);
      }
    }

    const inputTokens = sanitizeFinite(record.inputTokens);
    const outputTokens = sanitizeFinite(record.outputTokens);
    const cachedTokens = sanitizeFinite(record.cachedTokens);
    const thoughtsTokens = sanitizeFinite(record.thoughtsTokens);
    const toolTokens = sanitizeFinite(record.toolTokens);
    const durationMs = sanitizeFinite(record.durationMs);
    const rawTtft = record.timeToFirstTokenMs;
    const ttft =
      rawTtft !== null && Number.isFinite(rawTtft) && rawTtft > 0
        ? rawTtft
        : null;
    const rawLastToken = record.lastTokenMs ?? null;
    const lastTokenMs =
      rawLastToken !== null && Number.isFinite(rawLastToken) && rawLastToken > 0
        ? rawLastToken
        : null;

    this.totalApiRequests++;
    if (record.isError) {
      this.totalApiErrors++;
    }

    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCachedTokens += cachedTokens;
    this.totalThoughtsTokens += thoughtsTokens;
    this.totalToolTokens += toolTokens;

    const recordHasCacheReads = record.cacheReads !== undefined;
    const recordHasCacheWrites =
      record.cacheWrites !== undefined && record.cacheWrites !== null;

    // Cache data tracking — reads and writes are tracked independently.
    // Only emit a field when the provider reported usage for this attempt.
    if (record.hasUsage && recordHasCacheReads) {
      this.hasReliableCacheReads = true;
      this.totalCacheReads += sanitizeFinite(record.cacheReads!);
      this.requestsWithCacheReads++;
    }
    if (record.hasUsage && recordHasCacheWrites) {
      this.hasReliableCacheWrites = true;
      this.totalCacheWrites ??= 0;
      this.totalCacheWrites += sanitizeFinite(record.cacheWrites!);
      this.requestsWithCacheWrites++;
    }

    // Per-record cache reliability for uncached TPS: only records that
    // individually report cache reads or writes contribute to the
    // uncached weighted sum, regardless of session-wide flags.
    const recordCacheReliable = recordHasCacheReads || recordHasCacheWrites;

    this.accumulateTiming(
      inputTokens,
      outputTokens,
      cachedTokens,
      durationMs,
      ttft,
      record.isError,
      lastTokenMs,
      recordCacheReliable,
      record.hasUsage,
    );

    // Track API interval in the shared activity union.
    if (durationMs > 0) {
      this.activeIntervals.add(
        record.timestampMs,
        record.timestampMs + durationMs,
      );
    }

    this.updateModelBreakdown(record.model, record.isError, {
      inputTokens,
      outputTokens,
      cachedTokens,
      thoughtsTokens,
      toolTokens,
      durationMs,
    });

    return true;
  }

  private accumulateTiming(
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    durationMs: number,
    ttft: number | null,
    isError: boolean,
    lastTokenMs: number | null,
    recordCacheReliable: boolean,
    hasUsage: boolean,
  ): void {
    // API Time (ΣD) includes ALL attempts regardless of status
    this.timing.sumDurationMs += durationMs;

    const isRateEligible = !isError && hasUsage;

    this.accumulateRateMetrics(
      inputTokens,
      outputTokens,
      durationMs,
      ttft,
      lastTokenMs,
      isRateEligible,
    );

    this.accumulateInputTtftMetrics(
      inputTokens,
      cachedTokens,
      ttft,
      recordCacheReliable,
      isRateEligible,
    );

    // Last-request timing/rate values update only on valid success
    // with provider-reported usage.
    if (isRateEligible && durationMs > 0) {
      this.timing.lastRequestTokens = inputTokens + outputTokens;
      this.timing.lastRequestDurationMs = durationMs;
    }

    // Track last TTFT for display (valid attempts only)
    if (isRateEligible) {
      this.timing.lastTtftMs = ttft;
    }
  }

  private accumulateRateMetrics(
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    ttft: number | null,
    lastTokenMs: number | null,
    isRateEligible: boolean,
  ): void {
    // Rate accumulators include only successful records with valid
    // provider-reported usage and matching positive durations.
    if (isRateEligible && durationMs > 0) {
      this.timing.sumInputPlusOutput += inputTokens + outputTokens;
      this.timing.sumDurationForRateMs += durationMs;
    }

    // Output generation TPS: Σ(O-1)/ΣG, only O>=2, G>0, with usage
    if (this.qualifiesForOutputTps(outputTokens, ttft, isRateEligible)) {
      const positiveTtft = ttft as number;
      const gap =
        lastTokenMs !== null && lastTokenMs > positiveTtft
          ? lastTokenMs - positiveTtft
          : durationMs - positiveTtft;
      if (gap > 0) {
        this.timing.sumOutputMinusOne += outputTokens - 1;
        this.timing.sumGenerationGapMs += gap;
        this.timing.lastOutputTokens = outputTokens - 1;
        this.timing.lastGenerationGapMs = gap;
      }
    }
  }

  private qualifiesForOutputTps(
    outputTokens: number,
    ttft: number | null,
    isRateEligible: boolean,
  ): boolean {
    return outputTokens >= 2 && ttft !== null && ttft > 0 && isRateEligible;
  }

  private accumulateInputTtftMetrics(
    inputTokens: number,
    cachedTokens: number,
    ttft: number | null,
    recordCacheReliable: boolean,
    isRateEligible: boolean,
  ): void {
    // Effective input TPS: ΣP/ΣTTFT (only successful attempts with usage)
    if (!isRateEligible || ttft === null || ttft <= 0) {
      return;
    }

    this.timing.sumInputForTtft += inputTokens;
    this.timing.sumTtftMs += ttft;
    this.timing.ttftCount++;

    this.timing.lastInputForTtft = inputTokens;
    this.timing.lastTtftForRate = ttft;

    // Uncached input TPS: only records that individually report cache
    // reads or writes contribute (per-record reliability, not session-wide).
    if (recordCacheReliable) {
      const uncached = Math.max(0, inputTokens - cachedTokens);
      this.timing.sumUncachedForTtft += uncached;
      this.timing.sumUncachedTtftMs += ttft;
    }
  }

  private updateModelBreakdown(
    model: string,
    isError: boolean,
    tokens: {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      thoughtsTokens: number;
      toolTokens: number;
      durationMs: number;
    },
  ): void {
    const existing = this.models[model] as ModelBreakdown | undefined;
    const breakdown: ModelBreakdown = existing ?? {
      totalRequests: 0,
      totalErrors: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      totalThoughtsTokens: 0,
      totalToolTokens: 0,
      totalLatencyMs: 0,
    };
    if (!existing) {
      this.models[model] = breakdown;
    }
    breakdown.totalRequests++;
    if (isError) breakdown.totalErrors++;
    breakdown.totalInputTokens += tokens.inputTokens;
    breakdown.totalOutputTokens += tokens.outputTokens;
    breakdown.totalCachedTokens += tokens.cachedTokens;
    breakdown.totalThoughtsTokens += tokens.thoughtsTokens;
    breakdown.totalToolTokens += tokens.toolTokens;
    breakdown.totalLatencyMs += tokens.durationMs;
  }

  recordToolActivity(
    toolName: string,
    durationMs: number,
    success: boolean,
    callId?: string,
    startTimestampMs?: number,
    status?: string,
  ): boolean {
    // Finding #3: canonical completed tool events require a stable
    // producer-provided callId for exact dedup. Identity-less records
    // (no callId or empty/whitespace callId) are rejected — they cannot
    // be deduplicated, so accepting them would risk double-counting on
    // replay. Never synthesize random/sequential IDs.
    const validCallId =
      callId !== undefined && callId.trim() !== '' ? callId : undefined;
    if (validCallId === undefined) {
      return false;
    }
    if (this.seenToolCallIds.has(validCallId)) return false;
    this.seenToolCallIds.add(validCallId);

    const duration = sanitizeFinite(durationMs);
    this.totalToolCalls++;
    this.totalToolTimeMs += duration;

    if (
      startTimestampMs !== undefined &&
      Number.isFinite(startTimestampMs) &&
      startTimestampMs >= 0
    ) {
      if (this.sessionStartMs === null) {
        this.sessionStartMs = startTimestampMs;
      } else {
        this.sessionStartMs = Math.min(this.sessionStartMs, startTimestampMs);
      }
    }

    if (status === 'cancelled') {
      this.totalToolCancellations++;
    } else if (success) {
      this.totalToolSuccesses++;
    } else {
      this.totalToolFailures++;
    }

    if (duration > 0 && startTimestampMs !== undefined) {
      this.activeIntervals.add(startTimestampMs, startTimestampMs + duration);
    }

    return true;
  }

  getSnapshot(): SessionMetricsSnapshot {
    const timing = this.computeTimingMetrics();
    // Keep the current timestamp in the monotonic domain and never place it
    // before an explicitly recorded completed interval.
    const sessionCurrentMs = Math.max(
      performance.now(),
      this.activeIntervals.latestEnd,
    );
    const agentActiveTimeMs = this.computeAgentActiveTimeMs(sessionCurrentMs);

    return {
      totalApiRequests: this.totalApiRequests,
      totalApiErrors: this.totalApiErrors,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCachedTokens: this.totalCachedTokens,
      totalThoughtsTokens: this.totalThoughtsTokens,
      totalToolTokens: this.totalToolTokens,
      totalUncachedInputTokens: Math.max(
        0,
        this.totalInputTokens - this.totalCachedTokens,
      ),
      ...timing,
      accumulatedApiTimeMs: this.timing.sumDurationMs,
      totalToolTimeMs: this.totalToolTimeMs,
      agentActiveTimeMs,
      accumulatedWorkMs: this.timing.sumDurationMs + this.totalToolTimeMs,
      sessionStartMs: this.sessionStartMs,
      sessionCurrentMs,
      sessionWallMs: this.computeSessionWallMs(sessionCurrentMs),
      totalToolCalls: this.totalToolCalls,
      totalToolSuccesses: this.totalToolSuccesses,
      totalToolFailures: this.totalToolFailures,
      totalToolCancellations: this.totalToolCancellations,
      hasReliableCacheData:
        this.hasReliableCacheReads || this.hasReliableCacheWrites,
      hasReliableCacheReads: this.hasReliableCacheReads,
      hasReliableCacheWrites: this.hasReliableCacheWrites,
      totalCacheReads: this.totalCacheReads,
      totalCacheWrites: this.totalCacheWrites,
      requestsWithCacheReads: this.requestsWithCacheReads,
      requestsWithCacheWrites: this.requestsWithCacheWrites,
      models: Object.fromEntries(
        Object.entries(this.models).map(([k, v]) => [k, { ...v }]),
      ),
    };
  }

  private computeTimingMetrics() {
    const completeTokensPerMinute =
      this.timing.sumDurationForRateMs > 0
        ? (60000 * this.timing.sumInputPlusOutput) /
          this.timing.sumDurationForRateMs
        : 0;

    const outputGenerationTps =
      this.timing.sumGenerationGapMs > 0
        ? (this.timing.sumOutputMinusOne / this.timing.sumGenerationGapMs) *
          1000
        : 0;

    const effectiveInputTps =
      this.timing.sumTtftMs > 0
        ? (this.timing.sumInputForTtft / this.timing.sumTtftMs) * 1000
        : 0;

    const uncachedInputTps = this.computeUncachedInputTps();

    const lastRequestTpm =
      this.timing.lastRequestDurationMs > 0
        ? (60000 * this.timing.lastRequestTokens) /
          this.timing.lastRequestDurationMs
        : 0;

    const weightedAvgTtftMs =
      this.timing.ttftCount > 0
        ? this.timing.sumTtftMs / this.timing.ttftCount
        : null;

    const lastOutputGenerationTps =
      this.timing.lastGenerationGapMs > 0
        ? (this.timing.lastOutputTokens / this.timing.lastGenerationGapMs) *
          1000
        : 0;

    const lastEffectiveInputTps =
      this.timing.lastTtftForRate !== null && this.timing.lastTtftForRate > 0
        ? (this.timing.lastInputForTtft / this.timing.lastTtftForRate) * 1000
        : 0;

    return {
      completeTokensPerMinute,
      outputGenerationTps,
      effectiveInputTps,
      uncachedInputTps,
      lastRequestTpm,
      lastTtftMs: this.timing.lastTtftMs,
      weightedAvgTtftMs,
      lastOutputGenerationTps,
      lastEffectiveInputTps,
    };
  }

  private computeUncachedInputTps(): number | null {
    const hasReliableCacheData =
      this.hasReliableCacheReads || this.hasReliableCacheWrites;
    if (!hasReliableCacheData) return null;
    if (this.timing.sumUncachedTtftMs <= 0) return 0;
    return (
      (this.timing.sumUncachedForTtft / this.timing.sumUncachedTtftMs) * 1000
    );
  }

  private computeSessionWallMs(sessionCurrentMs: number): number {
    if (this.sessionStartMs === null) return 0;
    return Math.max(0, sessionCurrentMs - this.sessionStartMs);
  }

  private computeAgentActiveTimeMs(sessionCurrentMs: number): number {
    const rawAgentActiveTimeMs = this.activeIntervals.duration;
    // When sessionStartMs is null (no positive timestamps recorded), we
    // cannot compute a meaningful wall-clock clamp. Return the raw union
    // duration to avoid artificially zeroing out activity time.
    if (this.sessionStartMs === null) return rawAgentActiveTimeMs;
    // Only apply the wall-clock clamp when the clock domains are consistent
    // (sessionCurrentMs is on the same timeline as sessionStartMs). When
    // sessionCurrentMs < sessionStartMs, the timestamps were recorded on a
    // different clock (e.g. explicit test values or out-of-order events),
    // so the clamp would incorrectly zero out all activity time.
    if (sessionCurrentMs < this.sessionStartMs) return rawAgentActiveTimeMs;
    const sessionWallMs = this.computeSessionWallMs(sessionCurrentMs);
    return Math.min(rawAgentActiveTimeMs, sessionWallMs);
  }

  reset(): void {
    this.seenAttemptIds.clear();
    this.seenToolCallIds.clear();
    this.activeIntervals.clear();
    this.totalApiRequests = 0;
    this.totalApiErrors = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.totalThoughtsTokens = 0;
    this.totalToolTokens = 0;
    this.totalToolTimeMs = 0;
    this.totalToolCalls = 0;
    this.totalToolSuccesses = 0;
    this.totalToolFailures = 0;
    this.totalToolCancellations = 0;
    this.hasReliableCacheReads = false;
    this.hasReliableCacheWrites = false;
    this.totalCacheReads = 0;
    this.totalCacheWrites = null;
    this.requestsWithCacheReads = 0;
    this.requestsWithCacheWrites = 0;
    this.sessionStartMs = null;
    this.timing.sumInputPlusOutput = 0;
    this.timing.sumDurationMs = 0;
    this.timing.sumDurationForRateMs = 0;
    this.timing.sumOutputMinusOne = 0;
    this.timing.sumGenerationGapMs = 0;
    this.timing.sumInputForTtft = 0;
    this.timing.sumTtftMs = 0;
    this.timing.ttftCount = 0;
    this.timing.sumUncachedForTtft = 0;
    this.timing.sumUncachedTtftMs = 0;
    this.timing.lastRequestTokens = 0;
    this.timing.lastRequestDurationMs = 0;
    this.timing.lastTtftMs = null;
    this.timing.lastOutputTokens = 0;
    this.timing.lastGenerationGapMs = 0;
    this.timing.lastInputForTtft = 0;
    this.timing.lastTtftForRate = null;
    for (const key of Object.keys(this.models)) {
      delete this.models[key];
    }
  }
}
