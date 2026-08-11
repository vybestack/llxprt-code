/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow optional perf phase observer seam owned by telemetry (P07, issue #3167).
 *
 * A module-level subscription point that lower layers (providers'
 * AttemptRecorder, telemetry's tool-call logger) invoke at exact lifecycle
 * boundaries. The CLI's operation lifecycle registry installs an
 * implementation when perf is enabled; when absent (default-off), the getters
 * return null and the callers short-circuit with zero allocation.
 *
 * Layering: telemetry owns the seam. Providers import it (directly or through
 * core re-exports); the CLI registry sets it. packages/agents is never
 * involved. No agents→telemetry dependency edge is created (AC scope).
 *
 * D8: observer callbacks are direct and never swallowed. They MUST be invoked
 * outside any generic catch-and-log boundary so internal/programming errors
 * propagate fail-fast. SDK-disabled mode still notifies (the observer is
 * invoked before any SDK/export gate).
 */

// ---------------------------------------------------------------------------
// Provider attempt lifecycle (AttemptRecorder start/end boundaries)
// ---------------------------------------------------------------------------

export interface PerfProviderAttemptStartInfo {
  /** Stable per-attempt ID (matches AttemptRecorder's attemptId). */
  readonly attemptId: string;
  /**
   * The AttemptRecorder's logicalRequestId (the agent's prompt/logical request
   * identity). The registry derives the operation_id via deriveOperationId so
   * the attempt associates to the correct operation — NOT to the foreground op
   * by position (concurrent subagent/unrelated requests are not misattributed).
   * Continuation IDs collapse via the exact D1 split.
   */
  readonly promptId: string;
  /** Monotonic timestamp (ms) at the start of the attempt. */
  readonly startMs: number;
}

export interface PerfProviderAttemptEndInfo {
  /** Stable per-attempt ID (matches AttemptRecorder's attemptId). */
  readonly attemptId: string;
  /**
   * The prompt/logical-request identity (AttemptRecorder.logicalRequestId),
   * used to associate the attempt to an operation via deriveOperationId (D1).
   */
  readonly promptId: string;
  /** Monotonic timestamp (ms) when the attempt started. */
  readonly startMs: number;
  /** Monotonic timestamp (ms) at terminal completion. */
  readonly endMs: number;
  /** Explicit terminal status. */
  readonly status: 'success' | 'error' | 'aborted';
  /** Input/prompt tokens reported at the boundary, or 0 when unknown. */
  readonly inputTokens: number;
  /** Output/completion tokens reported at the boundary, or 0 when unknown. */
  readonly outputTokens: number;
}

// ---------------------------------------------------------------------------
// Tool call completion (ToolCallEvent logger seam)
// ---------------------------------------------------------------------------

export interface PerfToolCallCompletedInfo {
  /**
   * The agent's prompt_id carried by the tool call request. Associated to the
   * operation via `deriveOperationId(promptId)` so continuation prompt IDs
   * collapse to the shared operation_id (D1).
   */
  readonly promptId: string;
  /** Unique tool call ID for deduplication, or undefined when absent. */
  readonly callId: string | undefined;
  /** Monotonic start timestamp (ms) for interval unioning, or undefined. */
  readonly startMs: number | undefined;
  /** Monotonic end timestamp (ms) for interval unioning, or undefined. */
  readonly endMs: number | undefined;
  /** Duration (ms) of the tool call. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Observer contract
// ---------------------------------------------------------------------------

export interface PerfPhaseObserver {
  onProviderAttemptStart(info: PerfProviderAttemptStartInfo): void;
  onProviderAttemptEnd(info: PerfProviderAttemptEndInfo): void;
  onToolCallCompleted(info: PerfToolCallCompletedInfo): void;
}

// ---------------------------------------------------------------------------
// Module-level seam (default-off: null means no observer installed)
// ---------------------------------------------------------------------------

let activeObserver: PerfPhaseObserver | null = null;

/**
 * Installs (or clears) the global perf phase observer. The CLI registry calls
 * this when perf is enabled; tests call it with null to reset deterministically.
 *
 * Default-off: when this is never called (or called with null), all getters
 * return null and no observer invocation or interval/counter allocation occurs
 * in hot telemetry paths.
 */
export function setPerfPhaseObserver(observer: PerfPhaseObserver | null): void {
  activeObserver = observer;
}

/**
 * Returns the currently installed perf phase observer, or null when none is
 * installed (default-off). Lower-layer callers (AttemptRecorder, tool logger)
 * check this and short-circuit when null.
 */
export function getPerfPhaseObserver(): PerfPhaseObserver | null {
  return activeObserver;
}
