/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted from StreamProcessor to keep it under the eslint `max-lines`
 * budget (issue #3130 slice 3). Handles telemetry logging + actual token
 * usage recording after a stream attempt completes successfully.
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { logApiResponse } from './turnLogging.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { safeJsonStringify } from './turnJsonUtils.js';
import {
  recordActualTokenUsage,
  usageStatsToActualInput,
} from './tokenUsageActualLogger.js';

/**
 * Per-attempt provider timing measured at the agents-layer stream seam,
 * relative to the start of the provider stream (issue #3257).
 */
export interface StreamTimingMeasurement {
  readonly firstTokenMs: number | null;
  readonly lastTokenMs: number | null;
  readonly providerRequestMs: number;
  readonly chunkCount: number;
}

function isTokenBearingBlock(block: ContentBlock): boolean {
  if (block.type === 'text') {
    return typeof block.text === 'string' && block.text.length > 0;
  }
  if (block.type === 'thinking') {
    return typeof block.thought === 'string' && block.thought.length > 0;
  }
  if (block.type === 'code') {
    return typeof block.code === 'string' && block.code.length > 0;
  }
  if (block.type === 'tool_call') {
    return (
      typeof block.name === 'string' &&
      block.name.length > 0 &&
      block.parameters !== undefined
    );
  }
  return false;
}

/**
 * True when a raw IContent chunk carries token-bearing output. Mirrors the
 * providers' `hasTokenBearingOutput` semantics without importing from the
 * providers package surface.
 */
function isTokenBearingChunk(chunk: IContent): boolean {
  if (!Array.isArray(chunk.blocks)) return false;
  return chunk.blocks.some(isTokenBearingBlock);
}

/**
 * Measures the provider stream lifecycle for one attempt: constructed when
 * generator execution begins (the provider call boundary), fed every raw
 * chunk before any conversion or hook processing, and read out at stream
 * end. Excludes send-seam estimation, which runs before the provider call.
 *
 * Timing source precedence (issue #3493): firstTokenMs/lastTokenMs are
 * stamped from raw token deltas via recordRawTokenDelta whenever that
 * signal arrives, falling back to visible token-bearing chunks when it
 * does not. Once a raw delta has stamped the attempt, visible chunks still
 * count toward chunkCount but must not move the token window, because
 * deferred visible emissions (a terminal combined chunk, a buffered-text
 * flush) trail the final raw delta. This mirrors the providers-layer
 * AttemptRecorder rule from issue #3473 (`rawTimingStamped` guarding
 * `recordTokenBearingChunk` after `recordTimingOnly`), so both layers
 * agree on the same token window.
 */
export class StreamTimingTracker {
  private readonly startMs = performance.now();
  private firstTokenMs: number | null = null;
  private lastTokenMs: number | null = null;
  private chunkCount = 0;
  private rawTimingStamped = false;

  /**
   * Record a raw token-delta timing signal for this attempt (issue #3493).
   * Stamps firstTokenMs/lastTokenMs without touching chunkCount, and makes
   * the raw stamps authoritative over later visible-chunk stamps.
   */
  recordRawTokenDelta(): void {
    const now = performance.now() - this.startMs;
    this.firstTokenMs ??= now;
    this.lastTokenMs = now;
    this.rawTimingStamped = true;
  }

  recordChunk(chunk: IContent): void {
    this.chunkCount++;
    if (!this.rawTimingStamped && isTokenBearingChunk(chunk)) {
      const now = performance.now() - this.startMs;
      this.firstTokenMs ??= now;
      this.lastTokenMs = now;
    }
  }

  measure(): StreamTimingMeasurement {
    return {
      firstTokenMs: this.firstTokenMs,
      lastTokenMs: this.lastTokenMs,
      providerRequestMs: performance.now() - this.startMs,
      chunkCount: this.chunkCount,
    };
  }
}

/**
 * Stable indirection between request metadata and the per-attempt tracker
 * (issue #3493). Request metadata is built in _buildStreamChatOptions
 * before the provider call, while the tracker only comes into existence at
 * the generator-body start of _convertIContentStream — the provider-call
 * boundary that keeps provider_request_ms free of send-seam estimation
 * (#3257). The bridge is threaded into metadata first and attached to the
 * tracker when that boundary is crossed, so the sink identity stays stable
 * across the two moments. `notify` is an arrow-function property so it can
 * be passed as a bare function value without losing `this`.
 */
export class RawTokenDeltaBridge {
  private tracker: StreamTimingTracker | null = null;
  /** Stable sink threaded into request metadata before the tracker exists. */
  readonly notify = (): void => {
    this.tracker?.recordRawTokenDelta();
  };
  attach(tracker: StreamTimingTracker): void {
    this.tracker = tracker;
  }
}

/**
 * Log the API response telemetry and record actual token usage for a
 * completed stream attempt.
 *
 * `attemptIndex` stamps the 0-based attempt number (AC-4). A successful
 * stream completion always carries `attempt_outcome: 'success'`.
 */
export async function logStreamTelemetry(
  runtimeContext: AgentRuntimeContext,
  telemetry:
    | {
        promptId: string;
        startTime: number;
        attemptIndex?: number;
      }
    | undefined,
  lastIContent: IContent | undefined,
  tokenUsageLogger: TokenUsageLogger | null | undefined,
  timing?: StreamTimingMeasurement,
): Promise<void> {
  // An empty stream (no chunks) still carries elapsed provider time; the
  // caller throws EmptyStreamError after this returns, outside the
  // generator's catch, so this is the only attach point for that failed
  // attempt (#3257).
  attachStreamTiming(tokenUsageLogger, telemetry, timing);
  if (telemetry === undefined || lastIContent === undefined) return;
  try {
    await emitStreamTelemetry(
      runtimeContext,
      telemetry,
      lastIContent,
      tokenUsageLogger,
    );
  } catch (error) {
    // Fail-open boundary: this runs on the completion path of a real turn, so
    // a telemetry adapter that throws must not surface as a failed request.
    new DebugLogger('llxprt:stream-telemetry').error(
      `Failed to log stream telemetry for prompt ${telemetry.promptId}`,
      error,
    );
  }
}

/**
 * Attach measured stream timing to the pending token-usage entry for the
 * prompt. Guarded like logStreamTelemetry: a telemetry-side failure must
 * never escape into the stream path. All four keys are attached every
 * time — null where unmeasured — so a retry attempt fully replaces the
 * prior attempt's timing via the spread-merge. Also used on the
 * stream-error path so a failed attempt's partial timing (with
 * provider_request_ms as elapsed-so-far) reaches the abandoned-attempt
 * record (#3257).
 */
export function attachStreamTiming(
  tokenUsageLogger: TokenUsageLogger | null | undefined,
  telemetry: { promptId: string } | undefined,
  timing: StreamTimingMeasurement | undefined,
): void {
  if (telemetry === undefined) return;
  try {
    tokenUsageLogger?.attachTurnContext(telemetry.promptId, {
      ttftMs: timing?.firstTokenMs ?? null,
      lastTokenMs: timing?.lastTokenMs ?? null,
      providerRequestMs: timing?.providerRequestMs ?? null,
      chunkCount: timing?.chunkCount ?? null,
    });
  } catch (error) {
    new DebugLogger('llxprt:stream-telemetry').error(
      `Failed to attach stream timing for prompt ${telemetry.promptId}`,
      error,
    );
  }
}

async function emitStreamTelemetry(
  runtimeContext: AgentRuntimeContext,
  telemetry: { promptId: string; startTime: number; attemptIndex?: number },
  lastIContent: IContent,
  tokenUsageLogger: TokenUsageLogger | null | undefined,
): Promise<void> {
  const durationMs = Date.now() - telemetry.startTime;
  const usage = lastIContent.metadata?.usage;
  logApiResponse(
    runtimeContext,
    runtimeContext.state,
    runtimeContext.state.model,
    telemetry.promptId,
    durationMs,
    usage ? { ...usage } : undefined,
    safeJsonStringify(lastIContent),
  );
  await recordActualTokenUsage(
    tokenUsageLogger,
    telemetry.promptId,
    usage
      ? usageStatsToActualInput(usage, {
          attemptIndex: telemetry.attemptIndex ?? 0,
          attemptOutcome: 'success',
        })
      : undefined,
  );
}
