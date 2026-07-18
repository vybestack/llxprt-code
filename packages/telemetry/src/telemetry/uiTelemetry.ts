/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import {
  EVENT_API_ERROR,
  EVENT_API_RESPONSE,
  EVENT_TOOL_CALL,
} from './constants.js';

import { ToolCallDecision } from './tool-call-decision.js';
import type {
  ApiErrorEvent,
  ApiResponseEvent,
  ToolCallEvent,
} from './types.js';
import {
  SessionMetricsAggregator,
  type SessionMetricsSnapshot,
} from './sessionMetricsAggregator.js';

export type UiEvent =
  | (ApiResponseEvent & { 'event.name': typeof EVENT_API_RESPONSE })
  | (ApiErrorEvent & { 'event.name': typeof EVENT_API_ERROR })
  | (ToolCallEvent & { 'event.name': typeof EVENT_TOOL_CALL });

export interface ToolCallStats {
  count: number;
  success: number;
  fail: number;
  cancelled: number;
  durationMs: number;
  decisions: {
    [ToolCallDecision.ACCEPT]: number;
    [ToolCallDecision.REJECT]: number;
    [ToolCallDecision.MODIFY]: number;
    [ToolCallDecision.AUTO_ACCEPT]: number;
  };
}

export interface ModelMetrics {
  api: {
    totalRequests: number;
    totalErrors: number;
    totalLatencyMs: number;
  };
  tokens: {
    input: number;
    prompt: number;
    candidates: number;
    total: number;
    cached: number;
    thoughts: number;
    tool: number;
  };
}

export interface SessionTimingMetrics {
  /** Complete session TPM: 60 * Σ(P+O) / ΣD */
  completeTokensPerMinute: number;
  /** Output generation TPS: Σ(O-1)/ΣG * 1000 */
  outputGenerationTps: number;
  /** Effective input TPS: ΣP/ΣTTFT * 1000 */
  effectiveInputTps: number;
  /** Uncached input TPS, or null if no reliable cache data */
  uncachedInputTps: number | null;
  /** Last request TPM */
  lastRequestTpm: number;
  /** TTFT of the last valid attempt, or null */
  lastTtftMs: number | null;
  /** Weighted-average TTFT: ΣTTFT/count, or null */
  weightedAvgTtftMs: number | null;
  /** Output generation TPS for the last qualifying attempt */
  lastOutputGenerationTps: number;
  /** Effective input TPS for the last qualifying attempt */
  lastEffectiveInputTps: number;
  /** Accumulated API time (ΣD) */
  accumulatedApiTimeMs: number;
  /** Accumulated tool time */
  accumulatedToolTimeMs: number;
  /** Union of API + tool intervals (overlap counted once) */
  agentActiveTimeMs: number;
  /** API + tool time (may overlap) */
  accumulatedWorkMs: number;
}

export interface SessionMetrics {
  models: Record<string, ModelMetrics>;
  tools: {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    totalCancelled: number;
    totalDurationMs: number;
    totalDecisions: {
      [ToolCallDecision.ACCEPT]: number;
      [ToolCallDecision.REJECT]: number;
      [ToolCallDecision.MODIFY]: number;
      [ToolCallDecision.AUTO_ACCEPT]: number;
    };
    byName: Record<string, ToolCallStats>;
  };
  files: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
  tokenTracking: {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
    timeToFirstToken: number | null;
    tokensPerSecond: number;
    sessionTokenUsage: {
      input: number;
      output: number;
      cache: number;
      tool: number;
      thought: number;
      total: number;
    };
  };
  /** Weighted timing metrics from the canonical aggregator */
  timing: SessionTimingMetrics;
  /** Aggregate cache data */
  cache: {
    hasReliableCacheData: boolean;
    hasReliableCacheReads: boolean;
    hasReliableCacheWrites: boolean;
    totalCacheReads: number;
    totalCacheWrites: number | null;
    requestsWithCacheReads: number;
    requestsWithCacheWrites: number;
  };
}

const createInitialTimingMetrics = (): SessionTimingMetrics => ({
  completeTokensPerMinute: 0,
  outputGenerationTps: 0,
  effectiveInputTps: 0,
  uncachedInputTps: null,
  lastRequestTpm: 0,
  lastTtftMs: null,
  weightedAvgTtftMs: null,
  lastOutputGenerationTps: 0,
  lastEffectiveInputTps: 0,
  accumulatedApiTimeMs: 0,
  accumulatedToolTimeMs: 0,
  agentActiveTimeMs: 0,
  accumulatedWorkMs: 0,
});

const createInitialMetrics = (): SessionMetrics => ({
  models: {},
  tools: {
    totalCalls: 0,
    totalSuccess: 0,
    totalFail: 0,
    totalCancelled: 0,
    totalDurationMs: 0,
    totalDecisions: {
      [ToolCallDecision.ACCEPT]: 0,
      [ToolCallDecision.REJECT]: 0,
      [ToolCallDecision.MODIFY]: 0,
      [ToolCallDecision.AUTO_ACCEPT]: 0,
    },
    byName: {},
  },
  files: {
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
  tokenTracking: {
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    timeToFirstToken: null,
    tokensPerSecond: 0,
    sessionTokenUsage: {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    },
  },
  timing: createInitialTimingMetrics(),
  cache: {
    hasReliableCacheData: false,
    hasReliableCacheReads: false,
    hasReliableCacheWrites: false,
    totalCacheReads: 0,
    totalCacheWrites: null,
    requestsWithCacheReads: 0,
    requestsWithCacheWrites: 0,
  },
});

/**
 * Normalize a numeric field at the event boundary to a finite non-negative
 * value. Applied once before the aggregator and SessionMetrics projection
 * so neither layer can accumulate NaN/Infinity/negative values.
 */
function norm(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export class UiTelemetryService extends EventEmitter {
  #metrics: SessionMetrics = createInitialMetrics();
  #lastPromptTokenCount = 0;
  #aggregator = new SessionMetricsAggregator();

  addEvent(event: UiEvent) {
    let changed = true;
    switch (event['event.name']) {
      case EVENT_API_RESPONSE:
        changed = this.processApiResponse(event);
        break;
      case EVENT_API_ERROR:
        changed = this.processApiError(event);
        break;
      case EVENT_TOOL_CALL:
        changed = this.processToolCall(event);
        break;
      default:
        return;
    }

    if (changed) {
      this.emit('update', {
        metrics: this.#metrics,
        lastPromptTokenCount: this.#lastPromptTokenCount,
      });
    }
  }

  getMetrics(): SessionMetrics {
    return this.#metrics;
  }

  /**
   * Get the canonical session snapshot from the aggregator.
   * This is the source of truth for weighted timing metrics.
   */
  getSessionSnapshot(): SessionMetricsSnapshot {
    return this.#aggregator.getSnapshot();
  }

  /**
   * Reset all canonical metrics for a new session (called on /clear).
   * Clears the aggregator, model/tools/files/timing/cache state, and
   * last prompt token count.
   */
  reset(): void {
    this.#aggregator.reset();
    this.#metrics = createInitialMetrics();
    this.#lastPromptTokenCount = 0;
    this.emit('update', {
      metrics: this.#metrics,
      lastPromptTokenCount: this.#lastPromptTokenCount,
    });
  }

  getLastPromptTokenCount(): number {
    return this.#lastPromptTokenCount;
  }

  setLastPromptTokenCount(lastPromptTokenCount: number): void {
    this.#lastPromptTokenCount = lastPromptTokenCount;
    this.emit('update', {
      metrics: this.#metrics,
      lastPromptTokenCount: this.#lastPromptTokenCount,
    });
  }

  setTokenTrackingMetrics(metrics: {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
    timeToFirstToken: number | null;
    tokensPerSecond: number;
    sessionTokenUsage: {
      input: number;
      output: number;
      cache: number;
      tool: number;
      thought: number;
      total: number;
    };
  }) {
    // Preserve the canonical session TPM from the aggregator — the polling
    // source only provides throttle/timing/session usage data.
    const canonicalTpm = this.#aggregator.getSnapshot().completeTokensPerMinute;
    this.#metrics.tokenTracking = {
      ...metrics,
      tokensPerMinute: canonicalTpm,
    };
    this.emit('update', {
      metrics: this.#metrics,
      lastPromptTokenCount: this.#lastPromptTokenCount,
    });
  }

  /**
   * Project all model metrics from the aggregator's canonical breakdown.
   * This replaces the partial manual increments so that totalErrors and
   * error-attempt token totals are included consistently with the
   * aggregator snapshot.
   */
  private projectModelMetricsFromAggregator(): void {
    const snap = this.#aggregator.getSnapshot();
    const newModels: Record<string, ModelMetrics> = {};
    for (const [modelName, breakdown] of Object.entries(snap.models)) {
      newModels[modelName] = {
        api: {
          totalRequests: breakdown.totalRequests,
          totalErrors: breakdown.totalErrors,
          totalLatencyMs: breakdown.totalLatencyMs,
        },
        tokens: {
          input: Math.max(
            0,
            breakdown.totalInputTokens - breakdown.totalCachedTokens,
          ),
          prompt: breakdown.totalInputTokens,
          candidates: breakdown.totalOutputTokens,
          total: breakdown.totalInputTokens + breakdown.totalOutputTokens,
          cached: breakdown.totalCachedTokens,
          thoughts: breakdown.totalThoughtsTokens,
          tool: breakdown.totalToolTokens,
        },
      };
    }
    this.#metrics.models = newModels;
  }

  private processApiResponse(event: ApiResponseEvent): boolean {
    if (event.provider_owned !== true) {
      return false;
    }
    return this.recordApiEvent(event, event.error !== undefined);
  }

  private processApiError(event: ApiErrorEvent): boolean {
    if (event.provider_owned !== true) {
      return false;
    }
    return this.recordApiEvent(event, true);
  }

  /**
   * Shared projection for API response and error events. Centralizes the
   * normalization, attempt ID resolution, and aggregator call so both
   * paths emit identical telemetry shapes.
   */
  private recordApiEvent(
    event: ApiResponseEvent | ApiErrorEvent,
    isError: boolean,
  ): boolean {
    const durationMs = norm(event.duration_ms);
    const inputTokens = norm(event.input_token_count);
    const outputTokens = norm(event.output_token_count);
    const cachedTokens = norm(event.cached_content_token_count);
    const thoughtsTokens = norm(event.thoughts_token_count);
    const toolTokens = norm(event.tool_token_count);
    const ttft = event.time_to_first_token_ms ?? null;
    const attemptId = event.attempt_id ?? event.prompt_id;

    const isNew = this.#aggregator.recordApiAttempt({
      attemptId,
      model: event.model,
      provider: event.provider ?? 'unknown',
      isError,
      hasUsage: event.usage_metadata_present === true,
      inputTokens,
      outputTokens,
      cachedTokens,
      thoughtsTokens,
      toolTokens,
      durationMs,
      timeToFirstTokenMs: ttft,
      lastTokenMs: event.last_token_ms ?? undefined,
      cacheReads:
        event.cache_read_input_tokens ??
        (cachedTokens > 0 ? cachedTokens : undefined),
      cacheWrites: event.cache_creation_input_tokens ?? undefined,
      timestampMs: event.start_ms ?? performance.now() - durationMs,
    });

    if (!isNew) {
      return false;
    }

    this.projectModelMetricsFromAggregator();
    this.syncTimingFromAggregator();
    return true;
  }

  private syncTimingFromAggregator(): void {
    const snap = this.#aggregator.getSnapshot();
    this.#metrics.timing = {
      completeTokensPerMinute: snap.completeTokensPerMinute,
      outputGenerationTps: snap.outputGenerationTps,
      effectiveInputTps: snap.effectiveInputTps,
      uncachedInputTps: snap.uncachedInputTps,
      lastRequestTpm: snap.lastRequestTpm,
      lastTtftMs: snap.lastTtftMs,
      weightedAvgTtftMs: snap.weightedAvgTtftMs,
      lastOutputGenerationTps: snap.lastOutputGenerationTps,
      lastEffectiveInputTps: snap.lastEffectiveInputTps,
      accumulatedApiTimeMs: snap.accumulatedApiTimeMs,
      accumulatedToolTimeMs: snap.totalToolTimeMs,
      agentActiveTimeMs: snap.agentActiveTimeMs,
      accumulatedWorkMs: snap.accumulatedWorkMs,
    };
    this.#metrics.cache = {
      hasReliableCacheData: snap.hasReliableCacheData,
      hasReliableCacheReads: snap.hasReliableCacheReads,
      hasReliableCacheWrites: snap.hasReliableCacheWrites,
      totalCacheReads: snap.totalCacheReads,
      totalCacheWrites: snap.totalCacheWrites,
      requestsWithCacheReads: snap.requestsWithCacheReads,
      requestsWithCacheWrites: snap.requestsWithCacheWrites,
    };
    this.#metrics.tokenTracking.tokensPerMinute = snap.completeTokensPerMinute;
  }

  private processToolCall(event: ToolCallEvent): boolean {
    const { tools, files } = this.#metrics;
    const callId = event.call_id;

    // Finding #3: identity-less tool events (no call_id) must not be
    // accepted as distinct. Without a stable producer-provided identity,
    // replays would double-count. Reject them at the service boundary.
    if (callId === undefined || callId === '') {
      return false;
    }

    const isCancelled = event.status === 'cancelled';
    const durationMs =
      event.start_ms !== undefined && event.end_ms !== undefined
        ? norm(event.end_ms - event.start_ms)
        : norm(event.duration_ms);

    const isNew = this.#aggregator.recordToolActivity(
      event.function_name,
      durationMs,
      event.success,
      callId,
      event.start_ms,
      event.status,
    );

    if (!isNew) {
      return false;
    }

    tools.totalCalls++;
    tools.totalDurationMs += durationMs;
    if (isCancelled) tools.totalCancelled++;
    else if (event.success) tools.totalSuccess++;
    else tools.totalFail++;

    if (!(event.function_name in tools.byName)) {
      tools.byName[event.function_name] = {
        count: 0,
        success: 0,
        fail: 0,
        cancelled: 0,
        durationMs: 0,
        decisions: {
          [ToolCallDecision.ACCEPT]: 0,
          [ToolCallDecision.REJECT]: 0,
          [ToolCallDecision.MODIFY]: 0,
          [ToolCallDecision.AUTO_ACCEPT]: 0,
        },
      };
    }

    const toolStats = tools.byName[event.function_name];
    toolStats.count++;
    toolStats.durationMs += durationMs;
    if (isCancelled) toolStats.cancelled++;
    else if (event.success) toolStats.success++;
    else toolStats.fail++;

    this.recordToolDecision(event, tools, toolStats);
    this.recordFileLineCounts(event, files);

    this.syncTimingFromAggregator();
    return true;
  }

  private recordToolDecision(
    event: ToolCallEvent,
    tools: SessionMetrics['tools'],
    toolStats: ToolCallStats,
  ): void {
    const decision = event.decision as unknown;
    if (decision !== undefined && decision !== '') {
      const toolDecision = event.decision;
      if (toolDecision !== undefined) {
        tools.totalDecisions[toolDecision]++;
        toolStats.decisions[toolDecision]++;
      }
    }
  }

  private recordFileLineCounts(
    event: ToolCallEvent,
    files: SessionMetrics['files'],
  ): void {
    if (!event.metadata) return;
    if (
      event.metadata['ai_added_lines'] !== undefined &&
      typeof event.metadata['ai_added_lines'] === 'number'
    ) {
      files.totalLinesAdded += event.metadata['ai_added_lines'];
    }
    if (
      event.metadata['ai_removed_lines'] !== undefined &&
      typeof event.metadata['ai_removed_lines'] === 'number'
    ) {
      files.totalLinesRemoved += event.metadata['ai_removed_lines'];
    }
  }
}

export const uiTelemetryService = new UiTelemetryService();
