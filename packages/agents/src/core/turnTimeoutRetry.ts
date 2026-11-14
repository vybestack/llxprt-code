/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getSettingSpec,
  validateSetting,
} from '@vybestack/llxprt-code-settings';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { StreamTimeoutPolicy } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { StreamWatchdogFire } from '@vybestack/llxprt-code-core/utils/streamWatchdog.js';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { formatRefusalDelay } from '../refusal/refusalNotices.js';
import { refusalBackoffMs } from '../refusal/refusalPolicy.js';

/** What the watchdog of one stream attempt observed. */
export interface IdleFlag {
  timedOut: boolean;
  fire: StreamWatchdogFire | undefined;
  livenessObserved: boolean;
}

export function newIdleFlag(): IdleFlag {
  return { timedOut: false, fire: undefined, livenessObserved: false };
}

/** The stream timeout recovery settings in force for one request. */
export interface TimeoutRetryPolicy {
  /** Resends allowed after a watchdog timeout. */
  readonly retries: number;
  /** Base wait of the refusal backoff schedule, in milliseconds. */
  readonly backoffMs: number;
}

function settingOrDefault(
  key: 'stream-timeout-retries' | 'refusal.backoff-ms',
  live: unknown,
): number {
  const checked = validateSetting(key, live);
  const value =
    live !== undefined && checked.success ? checked.value : undefined;
  const fallback = getSettingSpec(key)?.default;
  const resolved = value ?? fallback;
  if (typeof resolved !== 'number')
    throw new Error(`Missing default for ${key}`);
  return resolved;
}

/**
 * Reads the retry count and base wait from the live policy. A value that fails
 * the registry validator is ignored in favour of the default, so a corrupt
 * profile cannot turn recovery into an unbounded loop.
 */
export function resolveTimeoutRetryPolicy(
  policy: StreamTimeoutPolicy,
): TimeoutRetryPolicy {
  return {
    retries: settingOrDefault(
      'stream-timeout-retries',
      policy['stream-timeout-retries'],
    ),
    backoffMs: settingOrDefault(
      'refusal.backoff-ms',
      policy['refusal.backoff-ms'],
    ),
  };
}

function timeoutLabel(fire: StreamWatchdogFire | undefined): string {
  if (fire === undefined) return 'stream';
  const guard = fire.guard === 'first-response' ? 'first response' : 'idle';
  return `${guard}, ${formatRefusalDelay(fire.thresholdMs)}`;
}

/** Shown when a timed-out request is about to be resent. */
export function describeTimeoutRetry(input: {
  readonly fire: StreamWatchdogFire | undefined;
  readonly delayMs: number;
  readonly attempt: number;
  readonly retries: number;
}): string {
  const wait =
    input.delayMs <= 0 ? 'now' : `in ${formatRefusalDelay(input.delayMs)}`;
  return `Request timed out (${timeoutLabel(input.fire)}); retrying ${wait} (attempt ${input.attempt} of ${input.retries}).`;
}

/** Shown when the retries are spent and the turn ends. */
export function describeTimeoutStop(attempts: number): string {
  return `Request timed out on all ${attempts} attempts. Stopping.`;
}

export interface TimeoutRetryDeps {
  /** Runs one attempt; a watchdog fire ends it with a StreamIdleTimeout event. */
  readonly attempt: (
    idleFlag: IdleFlag,
  ) => AsyncGenerator<ServerAgentStreamEvent>;
  readonly policy: TimeoutRetryPolicy;
  readonly signal: AbortSignal;
  /** Abortable wait; rejects as soon as the signal aborts. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Runs a request and resends it unchanged when a stream watchdog ends the
 * attempt, within the retry budget. An attempt that timed out is announced
 * with the same Retry event a content retry gives, so hosts discard its
 * partial output; the final timeout is passed on only once the budget is
 * spent. Cancelling during the wait ends the request at once.
 */
export async function* retryOnStreamTimeout(
  deps: TimeoutRetryDeps,
): AsyncGenerator<ServerAgentStreamEvent> {
  const { retries, backoffMs } = deps.policy;
  const wait = deps.wait ?? delay;
  for (let timeouts = 1; ; timeouts++) {
    const idleFlag = newIdleFlag();
    let timeoutEvent: ServerAgentStreamEvent | undefined;
    for await (const event of deps.attempt(idleFlag)) {
      if (event.type === AgentEventType.StreamIdleTimeout) timeoutEvent = event;
      else yield event;
    }
    if (timeoutEvent === undefined) return;
    if (timeouts > retries) {
      if (timeouts > 1) yield stopNotice(timeouts);
      yield timeoutEvent;
      return;
    }
    const delayMs = refusalBackoffMs(backoffMs, timeouts);
    yield { type: AgentEventType.Retry };
    yield {
      type: AgentEventType.SystemNotice,
      value: describeTimeoutRetry({
        fire: idleFlag.fire,
        delayMs,
        attempt: timeouts,
        retries,
      }),
      source: 'stream-timeout-retry',
    };
    try {
      await wait(delayMs, deps.signal);
    } catch (error) {
      if (!deps.signal.aborted) throw error;
      yield { type: AgentEventType.UserCancelled };
      return;
    }
  }
}

function stopNotice(attempts: number): ServerAgentStreamEvent {
  return {
    type: AgentEventType.SystemNotice,
    value: describeTimeoutStop(attempts),
    source: 'stream-timeout-retry',
  };
}
