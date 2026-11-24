/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import {
  resolveTimeoutRetryPolicy,
  retryOnStreamTimeout,
  type IdleFlag,
} from './turnTimeoutRetry.js';

const TIMEOUT_EVENT: ServerAgentStreamEvent = {
  type: AgentEventType.StreamIdleTimeout,
  value: { error: { message: 'timed out', status: undefined } },
};
const CONTENT_EVENT: ServerAgentStreamEvent = {
  type: AgentEventType.Content,
  value: 'partial',
};

async function* script(
  events: readonly ServerAgentStreamEvent[],
  idleFlag?: IdleFlag,
): AsyncGenerator<ServerAgentStreamEvent> {
  if (idleFlag !== undefined) {
    idleFlag.timedOut = true;
    idleFlag.fire = {
      guard: 'first-response',
      thresholdMs: 300_000,
      configSource: 'env',
    };
  }
  for (const event of events) yield event;
}

async function collect(
  gen: AsyncGenerator<ServerAgentStreamEvent>,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function noticeTexts(events: readonly ServerAgentStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === AgentEventType.SystemNotice ? [event.value] : [],
  );
}

describe('resolveTimeoutRetryPolicy (issue #4093)', () => {
  it('defaults to 2 retries and the 15 s refusal backoff', () => {
    expect(resolveTimeoutRetryPolicy({})).toStrictEqual({
      retries: 2,
      backoffMs: 15_000,
    });
  });

  it('uses live values and ignores invalid ones', () => {
    expect(
      resolveTimeoutRetryPolicy({
        'stream-timeout-retries': 0,
        'refusal.backoff-ms': 50,
      }),
    ).toStrictEqual({ retries: 0, backoffMs: 50 });
    expect(
      resolveTimeoutRetryPolicy({
        'stream-timeout-retries': 99,
        'refusal.backoff-ms': -5,
      }),
    ).toStrictEqual({ retries: 2, backoffMs: 15_000 });
  });
});

describe('retryOnStreamTimeout (issue #4093)', () => {
  it('passes a healthy attempt through untouched', async () => {
    const events = await collect(
      retryOnStreamTimeout({
        attempt: () => script([CONTENT_EVENT]),
        policy: { retries: 2, backoffMs: 15_000 },
        signal: new AbortController().signal,
        wait: () => Promise.reject(new Error('must not wait')),
      }),
    );

    expect(events).toStrictEqual([CONTENT_EVENT]);
  });

  it('discards a timed-out attempt, waits the backoff schedule and resends', async () => {
    const waits: number[] = [];
    let attempts = 0;
    const events = await collect(
      retryOnStreamTimeout({
        attempt: (flag) => {
          attempts += 1;
          return attempts < 3
            ? script([CONTENT_EVENT, TIMEOUT_EVENT], flag)
            : script([CONTENT_EVENT]);
        },
        policy: { retries: 2, backoffMs: 15_000 },
        signal: new AbortController().signal,
        wait: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      }),
    );

    expect(waits).toStrictEqual([15_000, 60_000]);
    expect(events.map((e) => e.type)).toStrictEqual([
      AgentEventType.Content,
      AgentEventType.Retry,
      AgentEventType.SystemNotice,
      AgentEventType.Content,
      AgentEventType.Retry,
      AgentEventType.SystemNotice,
      AgentEventType.Content,
    ]);
    expect(noticeTexts(events)).toStrictEqual([
      'Request timed out (first response, 300 s); retrying in 15 s (attempt 1 of 2).',
      'Request timed out (first response, 300 s); retrying in 60 s (attempt 2 of 2).',
    ]);
  });

  it('ends with the timeout and a count once the retries are spent', async () => {
    const events = await collect(
      retryOnStreamTimeout({
        attempt: (flag) => script([TIMEOUT_EVENT], flag),
        policy: { retries: 1, backoffMs: 0 },
        signal: new AbortController().signal,
        wait: () => Promise.resolve(),
      }),
    );

    expect(noticeTexts(events)).toStrictEqual([
      'Request timed out (first response, 300 s); retrying now (attempt 1 of 1).',
      'Request timed out on all 2 attempts. Stopping.',
    ]);
    expect(events[events.length - 1]).toStrictEqual(TIMEOUT_EVENT);
  });

  it('ends at the first timeout without a notice when retries are 0', async () => {
    const events = await collect(
      retryOnStreamTimeout({
        attempt: (flag) => script([TIMEOUT_EVENT], flag),
        policy: { retries: 0, backoffMs: 15_000 },
        signal: new AbortController().signal,
        wait: () => Promise.reject(new Error('must not wait')),
      }),
    );

    expect(events).toStrictEqual([TIMEOUT_EVENT]);
  });

  it('ends with the timeout, resending nothing, when the answer is already in history', async () => {
    let attempts = 0;
    const events = await collect(
      retryOnStreamTimeout({
        attempt: (flag) => {
          attempts += 1;
          return script([CONTENT_EVENT, TIMEOUT_EVENT], flag);
        },
        policy: { retries: 2, backoffMs: 15_000 },
        answerCommitted: () => true,
        signal: new AbortController().signal,
        wait: () => Promise.reject(new Error('must not wait')),
      }),
    );

    expect(attempts).toBe(1);
    expect(events).toStrictEqual([CONTENT_EVENT, TIMEOUT_EVENT]);
  });

  it('reports a cancel during the wait as UserCancelled and resends nothing', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const events = await collect(
      retryOnStreamTimeout({
        attempt: (flag) => {
          attempts += 1;
          return script([TIMEOUT_EVENT], flag);
        },
        policy: { retries: 2, backoffMs: 15_000 },
        signal: controller.signal,
        wait: () => {
          controller.abort();
          return Promise.reject(new Error('Aborted'));
        },
      }),
    );

    expect(attempts).toBe(1);
    expect(events[events.length - 1]).toStrictEqual({
      type: AgentEventType.UserCancelled,
    });
  });
});
