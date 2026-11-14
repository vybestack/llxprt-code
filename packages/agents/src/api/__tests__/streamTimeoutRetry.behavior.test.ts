/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: a stream watchdog timeout is a transient failure. The agent
 * resends the identical request after an abortable backoff, within a retry
 * budget, and stops only once that budget is spent.
 *
 * Every test drives the PUBLIC `agent.stream()` over the real OpenAI provider
 * and a local HTTP endpoint that accepts the request and never answers. The
 * first-response watchdog is armed at 1 s so a stalled attempt times out
 * for real.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { isDoneEvent, isNoticeEvent } from './helpers/agentHarness.js';
import {
  aiTexts,
  runScriptedPrompt,
  stallAfterTextReply,
  stallReply,
  stopReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';
import type { ScriptedRun } from './helpers/refusal-endpoint.js';

setDefaultTimeout(90_000);

const PROMPT = 'please summarise the work';
const FAST_TIMEOUT = {
  'stream-first-response-timeout-ms': 1000,
  'refusal.backoff-ms': 1,
} as const;

function doneReasons(run: ScriptedRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

function notices(run: ScriptedRun): string[] {
  return run.events.filter(isNoticeEvent).map((notice) => notice.message);
}

describe('request that stalls once and then answers (issue #4093)', () => {
  const recovered = (): Promise<ScriptedRun> =>
    runScriptedPrompt([stallReply(), stopReply('recovered')], [PROMPT], {
      settings: FAST_TIMEOUT,
    });

  it('completes the turn with no user action', async () => {
    const run = await recovered();

    expect(doneReasons(run)).toStrictEqual(['stop']);
    expect(aiTexts(run.historyAfter)).toStrictEqual(['recovered']);
  });

  it('resends the identical wire request', async () => {
    const run = await recovered();

    expect(run.requests).toHaveLength(2);
    expect(run.requests[1].messages).toStrictEqual(run.requests[0].messages);
    expect(run.requests[1].model).toBe(run.requests[0].model);
  });

  it('tells the host to discard the timed-out attempt and why it is retrying', async () => {
    const run = await recovered();

    expect(run.events.filter((e) => e.type === 'retry')).toHaveLength(1);
    expect(run.events.filter((e) => e.type === 'idle-timeout')).toHaveLength(0);
    expect(notices(run)).toStrictEqual([
      'Request timed out (first response, 1 s); retrying in 1 ms (attempt 1 of 2).',
    ]);
  });

  it('commits the user message to history once', async () => {
    const run = await recovered();

    const human = run.historyAfter
      .filter((message) => message.speaker === 'human')
      .flatMap((message) => message.blocks)
      .flatMap((block) => (block.type === 'text' ? [block.text] : []));
    expect(human).toStrictEqual([PROMPT]);
  });

  it('logs the timed-out attempt and the successful one under their own indexes', async () => {
    const run = await recovered();

    const records = turnRecords(run.tokenRecords);
    expect(records.map((r) => r['attempt_index'])).toStrictEqual([0, 1]);
    expect(records.map((r) => r['attempt_outcome'])).toStrictEqual([
      'error',
      'success',
    ]);
  });
});

describe('stream that goes silent after some text (issue #4093)', () => {
  const run = (): Promise<ScriptedRun> =>
    runScriptedPrompt(
      [stallAfterTextReply('half an ans'), stopReply('whole answer')],
      [PROMPT],
      {
        settings: {
          'stream-idle-timeout-ms': 1000,
          'refusal.backoff-ms': 1,
        },
      },
    );

  it('discards the partial text and commits only the answer that completed', async () => {
    const result = await run();

    expect(aiTexts(result.historyAfter)).toStrictEqual(['whole answer']);
    expect(doneReasons(result)).toStrictEqual(['stop']);
  });

  it('shows the partial text, then tells the host to discard it and why', async () => {
    const result = await run();

    const types = result.events.map((e) => e.type);
    const partial = types.indexOf('text');
    const retry = types.indexOf('retry');
    expect(partial).toBeGreaterThanOrEqual(0);
    expect(retry).toBeGreaterThan(partial);
    expect(notices(result)).toStrictEqual([
      'Request timed out (idle, 1 s); retrying in 1 ms (attempt 1 of 2).',
    ]);
  });
});

describe('request that always stalls (issue #4093)', () => {
  const exhausted = (): Promise<ScriptedRun> =>
    runScriptedPrompt([stallReply(), stallReply(), stallReply()], [PROMPT], {
      settings: { ...FAST_TIMEOUT, 'stream-timeout-retries': 2 },
    });

  it('stops after the configured number of attempts', async () => {
    const run = await exhausted();

    expect(run.requests).toHaveLength(3);
    expect(run.events.filter((e) => e.type === 'idle-timeout')).toHaveLength(1);
    expect(doneReasons(run)).toStrictEqual(['error']);
  });

  it('says how many attempts timed out', async () => {
    const run = await exhausted();

    expect(notices(run)).toStrictEqual([
      'Request timed out (first response, 1 s); retrying in 1 ms (attempt 1 of 2).',
      'Request timed out (first response, 1 s); retrying in 4 ms (attempt 2 of 2).',
      'Request timed out on all 3 attempts. Stopping.',
    ]);
  });

  it('keeps timed-out output out of history', async () => {
    const run = await exhausted();

    expect(aiTexts(run.historyAfter)).toStrictEqual([]);
  });

  it('stops at the first timeout when retries are set to 0', async () => {
    const run = await runScriptedPrompt(
      [stallReply(), stopReply('unrequested')],
      [PROMPT],
      { settings: { ...FAST_TIMEOUT, 'stream-timeout-retries': 0 } },
    );

    expect(run.requests).toHaveLength(1);
    expect(doneReasons(run)).toStrictEqual(['error']);
  });
});

describe('cancelling during the wait before a resend (issue #4093)', () => {
  it('ends promptly as cancelled and sends no further request', async () => {
    const controller = new AbortController();
    const started = Date.now();

    const run = await runScriptedPrompt(
      [stallReply(), stopReply('unrequested')],
      [PROMPT],
      {
        settings: { ...FAST_TIMEOUT, 'refusal.backoff-ms': 120_000 },
        signal: controller.signal,
        onEvent: (event) => {
          if (isNoticeEvent(event) && event.message.includes('retrying in'))
            controller.abort();
          return Promise.resolve();
        },
      },
    );

    expect(Date.now() - started).toBeLessThan(60_000);
    expect(doneReasons(run)).toStrictEqual(['aborted']);
    expect(run.requests).toHaveLength(1);
  });
});

describe('cancelling while the stream is stalled (issue #4093)', () => {
  it('ends as cancelled without waiting for the watchdog or retrying', async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 5_000);

    const run = await runScriptedPrompt(
      [stallReply(), stopReply('unrequested')],
      [PROMPT],
      {
        settings: {
          ...FAST_TIMEOUT,
          'stream-first-response-timeout-ms': 10_000,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(abortTimer);

    expect(doneReasons(run)).toStrictEqual(['aborted']);
    expect(run.requests).toHaveLength(1);
    expect(notices(run)).toStrictEqual([]);
    expect(run.events.filter((event) => event.type === 'retry')).toHaveLength(
      0,
    );
  });
});
