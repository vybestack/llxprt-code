/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036 phase 1: a provider attempt that ends with the canonical finish
 * reason `refusal` is a typed refusal, not an invalid empty stream.
 *
 * These tests drive the PUBLIC `agent.stream()` over the real OpenAI provider
 * talking to a local OpenAI-compatible HTTP endpoint (the only stub). The
 * endpoint records every request, so a retry with a changed temperature, a
 * "System: Please continue." request or a task-list continuation is visible as an
 * extra request.
 */

import { describe, expect, it } from 'bun:test';
import { isDoneEvent, isErrorEvent } from './helpers/agentHarness.js';
import {
  aiTexts,
  emptyFinishReply,
  emptyRefusalReply,
  pendingTodoReply,
  runScriptedPrompt,
  stopReply,
  textRefusalReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';
import type { ScriptedRun } from './helpers/refusal-endpoint.js';

const UNREQUESTED = 'this response must never be requested';

function doneReasons(run: ScriptedRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

function invalidStreamEvents(run: ScriptedRun): number {
  return run.events.filter((event) => event.type === 'invalid-stream').length;
}

describe('empty metadata-only refusal (issue #4036)', () => {
  it('ends the request with done reason refusal', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(doneReasons(run)).toStrictEqual(['refusal']);
  });

  it('reports no error and no invalid stream', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(run.events.filter(isErrorEvent)).toHaveLength(0);
    expect(invalidStreamEvents(run)).toBe(0);
  });

  it('sends exactly one provider request', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(run.requests).toHaveLength(1);
  });

  it('leaves the conversation history unchanged', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(run.historyAfter).toStrictEqual(run.historyBefore);
  });

  it('records one refusal attempt with the finish reasons and real usage', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    const records = turnRecords(run.tokenRecords);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      attempt_outcome: 'refusal',
      finish_reason: 'refusal',
      raw_stop_reason: 'refusal',
      actual_prompt_tokens: 120,
      output_tokens: 0,
    });
  });

  it('does not invent a time to first token for an attempt with no output', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(turnRecords(run.tokenRecords)[0]).not.toHaveProperty('ttft_ms');
  });

  it('writes a refusal record to the session journal with the stop action', async () => {
    const run = await runScriptedPrompt([
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    const refusals = run.journalRecords.filter((r) => r['type'] === 'refusal');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]['payload']).toMatchObject({
      provider: 'openai',
      model: 'scripted-model',
      finishReason: 'refusal',
      rawStopReason: 'refusal',
      action: 'stop',
      attemptIndex: 0,
    });
  });
});

describe('visible-text refusal (issue #4036)', () => {
  const refusalText = 'I cannot help with that.';

  it('ends the request with done reason refusal after one request', async () => {
    const run = await runScriptedPrompt([
      textRefusalReply(refusalText),
      stopReply(UNREQUESTED),
    ]);

    expect(doneReasons(run)).toStrictEqual(['refusal']);
    expect(run.requests).toHaveLength(1);
  });

  it('keeps the refused text out of the history', async () => {
    const run = await runScriptedPrompt([
      textRefusalReply(refusalText),
      stopReply(UNREQUESTED),
    ]);

    expect(aiTexts(run.historyAfter)).toStrictEqual([]);
    expect(run.historyAfter).toStrictEqual(run.historyBefore);
  });

  it('records the attempt once as a refusal with its output tokens', async () => {
    const run = await runScriptedPrompt([
      textRefusalReply(refusalText),
      stopReply(UNREQUESTED),
    ]);

    const records = turnRecords(run.tokenRecords);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      attempt_outcome: 'refusal',
      finish_reason: 'refusal',
      output_tokens: 6,
    });
  });
});

describe('refusal while the task list has pending items (issue #4036)', () => {
  it('does not send a task-list continuation request', async () => {
    const run = await runScriptedPrompt([
      pendingTodoReply(),
      emptyRefusalReply(),
      stopReply(UNREQUESTED),
    ]);

    expect(run.requests).toHaveLength(2);
    expect(doneReasons(run)).toStrictEqual(['refusal']);
  });
});

describe('successful turn token accounting (issue #4036)', () => {
  it('records the finish reason on a success record', async () => {
    const run = await runScriptedPrompt([stopReply('all done')]);

    const records = turnRecords(run.tokenRecords);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      attempt_outcome: 'success',
      finish_reason: 'stop',
    });
  });

  it('keeps the answer in the history and reports done reason stop', async () => {
    const run = await runScriptedPrompt([stopReply('all done')]);

    expect(aiTexts(run.historyAfter)).toStrictEqual(['all done']);
    expect(doneReasons(run)).toStrictEqual(['stop']);
  });
});

describe('safety finish reason is not classified as a refusal (issue #4036)', () => {
  it('still treats an empty content-filter stop as an invalid stream and retries', async () => {
    const run = await runScriptedPrompt([
      emptyFinishReply('content_filter'),
      stopReply('recovered after the safety stop'),
    ]);

    expect(aiTexts(run.historyAfter)).toStrictEqual([
      'recovered after the safety stop',
    ]);
    expect(doneReasons(run)).toStrictEqual(['stop']);
  });

  it('records no refusal outcome for it', async () => {
    const run = await runScriptedPrompt([
      emptyFinishReply('content_filter'),
      stopReply('recovered after the safety stop'),
    ]);

    const outcomes = turnRecords(run.tokenRecords).map(
      (record) => record['attempt_outcome'],
    );
    expect(outcomes).not.toContain('refusal');
  });
});

describe('session stats count refusals (issue #4036)', () => {
  it('counts a refusal and a success as two requests, one refusal and no errors', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), stopReply('fine')],
      ['first request', 'second request'],
    );

    expect(run.stats).toMatchObject({
      apiRequests: 2,
      apiRefusals: 1,
      apiErrors: 0,
    });
  });
});
