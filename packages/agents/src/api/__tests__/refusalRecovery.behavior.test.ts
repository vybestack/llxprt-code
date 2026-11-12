/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036 phase 2: a refused request is resent unchanged, after an
 * abortable backoff, within a retry budget that belongs to the logical
 * request.
 *
 * Every test drives the PUBLIC `agent.stream()` over the real OpenAI provider
 * and a local OpenAI-compatible HTTP endpoint that records the wire requests.
 * The only injected piece is the backoff wait, so the tests see the requested
 * delays without sleeping.
 */

import { describe, expect, it } from 'bun:test';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { isDoneEvent, isNoticeEvent } from './helpers/agentHarness.js';
import {
  aiTexts,
  emptyRefusalReply,
  pendingTodoReply,
  refusedTodoReply,
  runScriptedPrompt,
  stopReply,
  textRefusalReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';
import type { ScriptedRun } from './helpers/refusal-endpoint.js';

const UNREQUESTED = 'this response must never be requested';
const PROMPT = 'please summarise the work';

function doneReasons(run: ScriptedRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function notices(run: ScriptedRun): string[] {
  return run.events.filter(isNoticeEvent).map((notice) => notice.message);
}

function outcomes(run: ScriptedRun): unknown[] {
  return turnRecords(run.tokenRecords).map((r) => r['attempt_outcome']);
}

function journalActions(run: ScriptedRun): unknown[] {
  return run.journalRecords
    .filter((record) => record['type'] === 'refusal')
    .map((record) => (record['payload'] as { action: string }).action);
}

function humanTexts(history: ScriptedRun['historyAfter']): string[] {
  return history
    .filter((message) => message.speaker === 'human')
    .flatMap((message) => message.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

const TWO_RETRIES = {
  'refusal.retries': 2,
  'refusal.backoff-ms': 15000,
  'refusal.rewrite': false,
} as const;

describe('refused request that recovers on a retry (issue #4036)', () => {
  const recovered = (): Promise<ScriptedRun> =>
    runScriptedPrompt(
      [emptyRefusalReply(), emptyRefusalReply(), stopReply('recovered')],
      [PROMPT],
      { settings: TWO_RETRIES, modelParams: { temperature: 0.3 } },
    );

  it('waits 15 s and then 60 s before resending', async () => {
    const run = await recovered();

    expect(run.waits).toStrictEqual([15000, 60000]);
  });

  it('resends the identical wire request each time', async () => {
    const run = await recovered();

    expect(run.requests).toHaveLength(3);
    const [first, ...rest] = run.requests;
    expect(first.temperature).toBe(0.3);
    for (const resent of rest) {
      expect(resent.model).toBe(first.model);
      expect(resent.temperature).toBe(first.temperature);
      expect(resent.messages).toStrictEqual(first.messages);
    }
  });

  it('logs every refused attempt under its own attempt index, then the success', async () => {
    const run = await recovered();

    const records = turnRecords(run.tokenRecords);
    expect(outcomes(run)).toStrictEqual(['refusal', 'refusal', 'success']);
    expect(records.map((r) => r['attempt_index'])).toStrictEqual([0, 1, 2]);
  });

  it('ends once with done stop and tells the user about each retry', async () => {
    const run = await recovered();

    expect(doneReasons(run)).toStrictEqual(['stop']);
    expect(notices(run)).toStrictEqual([
      'Model scripted-model refused the request; retrying in 15 s (retry 1 of 2).',
      'Model scripted-model refused the request; retrying in 60 s (retry 2 of 2).',
    ]);
  });

  it('tells the host to discard each refused attempt', async () => {
    const run = await recovered();

    expect(run.events.filter((e) => e.type === 'retry')).toHaveLength(2);
  });

  it('commits the user message and the answer to history exactly once', async () => {
    const run = await recovered();

    expect(aiTexts(run.historyAfter)).toStrictEqual(['recovered']);
    expect(humanTexts(run.historyAfter)).toStrictEqual([PROMPT]);
  });

  it('journals the retried attempts with the retry action', async () => {
    const run = await recovered();

    expect(journalActions(run)).toStrictEqual(['retry', 'retry']);
  });

  it('discards the text of a visible-text refusal and answers normally', async () => {
    const run = await runScriptedPrompt(
      [textRefusalReply('I cannot help with that.'), stopReply('done')],
      [PROMPT],
      { settings: { ...TWO_RETRIES, 'refusal.retries': 1 } },
    );

    expect(aiTexts(run.historyAfter)).toStrictEqual(['done']);
    expect(doneReasons(run)).toStrictEqual(['stop']);
  });

  it('uses two retries and the 15 s base when no setting is given', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), emptyRefusalReply(), stopReply('recovered')],
      [PROMPT],
      { settings: { 'refusal.retries': undefined } },
    );

    expect(run.waits).toStrictEqual([15000, 60000]);
    expect(doneReasons(run)).toStrictEqual(['stop']);
  });
});

describe('refusal that survives every retry (issue #4036)', () => {
  const exhausted = (
    settings: Record<string, unknown> = TWO_RETRIES,
  ): Promise<ScriptedRun> =>
    runScriptedPrompt(
      [
        emptyRefusalReply(),
        emptyRefusalReply(),
        emptyRefusalReply(),
        stopReply(UNREQUESTED),
      ],
      [PROMPT],
      { settings },
    );

  it('stops after the third refusal with done reason refusal', async () => {
    const run = await exhausted();

    expect(run.requests).toHaveLength(3);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
    expect(outcomes(run)).toStrictEqual(['refusal', 'refusal', 'refusal']);
  });

  it('summarises what was tried', async () => {
    const run = await exhausted();

    expect(lastOf(notices(run))).toBe(
      'Model scripted-model refused 3 times (2 retries with backoff 15 s, 60 s). Stopping.',
    );
  });

  it('journals retry, retry, stop', async () => {
    const run = await exhausted();

    expect(journalActions(run)).toStrictEqual(['retry', 'retry', 'stop']);
  });

  it('keeps the conversation history unchanged', async () => {
    const run = await exhausted();

    expect(run.historyAfter).toStrictEqual(run.historyBefore);
  });

  it('stops the same way when rewrite is on, because review is not available yet', async () => {
    const run = await exhausted({ ...TWO_RETRIES, 'refusal.rewrite': true });

    expect(run.requests).toHaveLength(3);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
    expect(journalActions(run)).toStrictEqual(['retry', 'retry', 'stop']);
  });
});

describe('refusal.retries 0 (issue #4036)', () => {
  it('behaves like phase 1: one request, a terminal refusal and no notice', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), stopReply(UNREQUESTED)],
      [PROMPT],
      { settings: { 'refusal.retries': 0 } },
    );

    expect(run.requests).toHaveLength(1);
    expect(run.waits).toStrictEqual([]);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
    expect(notices(run)).toStrictEqual([]);
    expect(journalActions(run)).toStrictEqual(['stop']);
  });
});

describe('cancelling during the backoff (issue #4036)', () => {
  it('ends promptly as cancelled and sends no further request', async () => {
    const controller = new AbortController();
    const started = Date.now();

    const run = await runScriptedPrompt(
      [emptyRefusalReply(), stopReply(UNREQUESTED)],
      [PROMPT],
      {
        settings: {
          'refusal.retries': 2,
          'refusal.backoff-ms': 120000,
          'refusal.rewrite': false,
        },
        signal: controller.signal,
        // The real abortable timer, cancelled 50 ms into a two minute wait.
        wait: ({ ms, signal }) => {
          setTimeout(() => controller.abort(), 50);
          return delay(ms, signal);
        },
      },
    );

    expect(Date.now() - started).toBeLessThan(60000);
    expect(doneReasons(run)).toStrictEqual(['aborted']);
    expect(run.requests).toHaveLength(1);
  });
});

describe('retry budget belongs to the logical request (issue #4036)', () => {
  it('does not give the task-list continuation a fresh budget', async () => {
    // Request 2 answers the tool result and is refused once, then recovers
    // (one of two retries used). The task-list continuation that follows
    // under the same prompt id is refused twice. Only one retry is left, so
    // it gets that one and then stops.
    const run = await runScriptedPrompt(
      [
        pendingTodoReply(),
        emptyRefusalReply(),
        stopReply('Working on the report.'),
        emptyRefusalReply(),
        emptyRefusalReply(),
        stopReply(UNREQUESTED),
      ],
      [PROMPT],
      { settings: TWO_RETRIES },
    );

    expect(run.requests).toHaveLength(5);
    expect(run.waits).toStrictEqual([15000, 60000]);
    expect(lastOf(doneReasons(run))).toBe('refusal');
  });
});

describe('tool calls carried by a refused attempt (issue #4036)', () => {
  it('runs only the tool call of the attempt that was not refused', async () => {
    const run = await runScriptedPrompt(
      [refusedTodoReply(), pendingTodoReply(), stopReply('all done')],
      [PROMPT],
      { settings: { ...TWO_RETRIES, 'refusal.retries': 1 } },
    );

    expect(run.events.filter((e) => e.type === 'tool-result')).toHaveLength(1);
  });

  it('runs no tool call when the refused attempt exhausts its retries', async () => {
    const run = await runScriptedPrompt(
      [refusedTodoReply(), refusedTodoReply(), stopReply(UNREQUESTED)],
      [PROMPT],
      { settings: { ...TWO_RETRIES, 'refusal.retries': 1 } },
    );

    expect(run.events.filter((e) => e.type === 'tool-result')).toHaveLength(0);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
  });
});

describe('policy is captured when the request is admitted (issue #4036)', () => {
  it('ignores a raised retry count set during the backoff', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), emptyRefusalReply(), stopReply(UNREQUESTED)],
      [PROMPT],
      {
        settings: { ...TWO_RETRIES, 'refusal.retries': 1 },
        wait: ({ agent }) => {
          agent.setEphemeralSetting('refusal.retries', 5);
          return Promise.resolve();
        },
      },
    );

    expect(run.requests).toHaveLength(2);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
  });

  it('ignores a retry count lowered to zero during the backoff', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), emptyRefusalReply(), stopReply('recovered')],
      [PROMPT],
      {
        settings: TWO_RETRIES,
        wait: ({ agent }) => {
          agent.setEphemeralSetting('refusal.retries', 0);
          return Promise.resolve();
        },
      },
    );

    expect(run.requests).toHaveLength(3);
    expect(doneReasons(run)).toStrictEqual(['stop']);
  });

  it('applies the changed setting to the next request', async () => {
    const run = await runScriptedPrompt(
      [
        emptyRefusalReply(),
        stopReply('first'),
        emptyRefusalReply(),
        stopReply(UNREQUESTED),
      ],
      ['first prompt', 'second prompt'],
      {
        settings: { ...TWO_RETRIES, 'refusal.retries': 1 },
        wait: ({ agent }) => {
          agent.setEphemeralSetting('refusal.retries', 0);
          return Promise.resolve();
        },
      },
    );

    expect(doneReasons(run)).toStrictEqual(['stop', 'refusal']);
    expect(run.requests).toHaveLength(3);
  });
});
