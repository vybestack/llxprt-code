/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

const heartbeatLogger = new DebugLogger('llxprt:task');

/**
 * Default liveness interval. A healthy synchronous Task must emit at least one
 * status event before any supported outer stream-inactivity guard expires.
 * Provider-side stream-idle watchdogs (issue #1905) operate on first-response
 * and inter-chunk cadence at the model layer and are intentionally much
 * shorter; this heartbeat concerns only the public Task live-output boundary
 * while a subagent waits on a long-running nested tool.
 *
 * 10s keeps heartbeat volume bounded (<=6/min) while comfortably below the
 * shortest configured interactive inactivity budget.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Creates the typed `status` live-output update for a given sequence number.
 * Exported so tests can assert the exact snapshot shape without duplicating
 * the literal.
 */
export function createLivenessStatus(seq: number): LiveOutputUpdate {
  return { mode: 'status', status: { kind: 'liveness', seq } };
}

/**
 * Handle returned by {@link startTaskHeartbeat}. `stop()` is idempotent and
 * clears the pending timer; `reset()` (re)arms the timer after real activity.
 */
export interface TaskHeartbeat {
  /**
   * (Re)arms the heartbeat timer. Real progress (subagent messages, nested
   * tool output) supersedes liveness timing and should call this to defer the
   * next heartbeat until after a fresh quiet period.
   */
  reset: () => void;
  /**
   * Clears the pending timer and marks the heartbeat stopped so no further
   * status events fire. Idempotent; safe to call from any terminal path.
   */
  stop: () => void;
}

/**
 * Starts a periodic liveness heartbeat that emits non-content `status`
 * live-output updates across the public stream boundary (issue #2540).
 *
 * The heartbeat is structurally distinct from model text and tool-result
 * content: {@link accumulateLiveOutput} ignores `status` updates, the
 * subagent message channel skips them, and the public AgentToolInvocation
 * adapter does not forward them as text. A snapshot consumer that tracks the
 * latest `status.seq` therefore holds a constant-size view regardless of how
 * many heartbeats fire.
 *
 * The heartbeat does NOT extend `timeout_seconds`/`max_time_minutes` and does
 * NOT reset provider first-response/inter-chunk watchdogs — it only emits
 * across the Task tool's own `updateOutput` boundary.
 *
 * The interval defaults to {@link DEFAULT_HEARTBEAT_INTERVAL_MS} and must be
 * strictly positive; an invalid interval disables the heartbeat (returns a
 * no-op handle) rather than firing in a tight loop.
 */
export function startTaskHeartbeat(
  updateOutput: ((update: LiveOutputUpdate) => void) | undefined,
  intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS,
): TaskHeartbeat {
  if (updateOutput === undefined || !(intervalMs > 0)) {
    return { reset: () => {}, stop: () => {} };
  }

  let seq = 0;
  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const tick = (): void => {
    if (stopped) return;
    seq += 1;
    heartbeatLogger.debug(() => `emit liveness seq=${seq}`);
    // The updateOutput callback is consumer-supplied and may throw on a
    // downstream stream/serialization error. Such an error must not kill the
    // timer chain: the heartbeat's whole purpose is to keep ticking across
    // silent waits. Swallow the error (logged) and reschedule so an isolated
    // callback failure cannot cause a false-positive outer-inactivity timeout.
    try {
      updateOutput(createLivenessStatus(seq));
    } catch (error) {
      heartbeatLogger.warn(
        () =>
          `liveness updateOutput threw (seq=${seq}); continuing: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    timerId = setTimeout(tick, intervalMs);
  };

  const reset = (): void => {
    if (stopped) return;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(tick, intervalMs);
  };

  const stop = (): void => {
    stopped = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  timerId = setTimeout(tick, intervalMs);
  return { reset, stop };
}
