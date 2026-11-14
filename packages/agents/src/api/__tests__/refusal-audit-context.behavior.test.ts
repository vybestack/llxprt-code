/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { runScriptedPrompt } from './helpers/refusal-endpoint.js';

setDefaultTimeout(90_000);

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected record payload');
  }
  return Object.fromEntries(Object.entries(value));
}

describe('refusal audit context (REQ-4101-D1, REQ-4101-D2)', () => {
  it('records partial text, thinking and unfinished tool input without committing or executing it', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text: 'A partial answer',
          thinking: 'A coalesced thought',
          partialToolCall: {
            id: 'unfinished-call',
            name: 'todo_write',
            input: '{"todos":[{"content":"must not run"',
          },
          outputTokens: 9,
        },
      ],
      ['please process the task'],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 0, 'refusal.rewrite': false },
      },
    );

    const refusal = run.journalRecords.find(
      (record) => record['type'] === 'refusal',
    );
    expect(refusal).toBeDefined();
    const payload = asRecord(refusal?.['payload']);
    expect(payload['partial_output']).toMatchObject({
      truncated: false,
      items: [
        { type: 'text', text: 'A partial answer' },
        { type: 'thinking', text: 'A coalesced thought' },
        {
          type: 'tool_input',
          id: 'unfinished-call',
          name: 'todo_write',
          input: '{"todos":[{"content":"must not run"',
          complete: false,
        },
      ],
    });
    expect(payload['output_tokens']).toBe(9);
    expect(payload['first_byte_to_refusal_ms']).toBeNumber();
    expect(payload['first_byte_to_refusal_ms']).toBeGreaterThanOrEqual(0);
    expect(payload['context_fingerprint']).toMatchObject({
      added_entries: expect.any(Array),
      pending_entries: expect.any(Array),
      compression_count: expect.any(Number),
      digest: expect.any(String),
      prompt_tokens: expect.any(Number),
      cache_read_tokens: expect.any(Number),
    });
    expect(run.events.some((event) => event.type === 'tool-call')).toBe(false);
    expect(
      run.historyAfter
        .filter((content) => content.speaker === 'ai')
        .flatMap((content) => content.blocks),
    ).toStrictEqual([]);
  });

  it('caps combined Unicode previews and reports source byte counts explicitly', async () => {
    const text = Array.from(
      { length: 6_000 },
      (_, index) => `${index.toString(36)}é`,
    ).join('');
    const thinking = Array.from(
      { length: 4_000 },
      (_, index) => `${index.toString(36)}🧠`,
    ).join('');
    const toolInput = `{"payload":"${Array.from(
      { length: 2_000 },
      (_, index) => `${index.toString(36)}界`,
    ).join('')}`;
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text,
          thinking,
          partialToolCall: {
            id: 'large-call',
            name: 'todo_write',
            input: toolInput,
          },
          outputTokens: 7,
        },
      ],
      ['large context request'],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 0, 'refusal.rewrite': false },
      },
    );
    const refusal = run.journalRecords.find(
      (record) => record['type'] === 'refusal',
    );
    if (refusal === undefined) throw new Error(JSON.stringify(run.events));
    const payload = asRecord(refusal['payload']);
    const partial = asRecord(payload['partial_output']);
    const items = partial['items'];
    expect(partial['truncated']).toBe(true);
    expect(partial['original_bytes']).toBeGreaterThan(32 * 1024);
    expect(partial['preview_bytes']).toBeLessThanOrEqual(32 * 1024);
    expect(items).toBeArray();
    expect(JSON.stringify(items)).toContain('[truncated]');
    expect(JSON.stringify(items)).toContain('original_bytes');
  });

  it('records empty previews and zero reported output tokens for a pre-output refusal', async () => {
    const run = await runScriptedPrompt(
      [{ kind: 'finish', finishReason: 'refusal', outputTokens: 0 }],
      ['pre-output refusal'],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 0, 'refusal.rewrite': false },
      },
    );
    const refusal = run.journalRecords.find(
      (record) => record['type'] === 'refusal',
    );
    const payload = asRecord(refusal?.['payload']);
    const partial = asRecord(payload['partial_output']);
    expect(partial['items']).toStrictEqual([]);
    expect(payload['output_tokens']).toBe(0);
  });

  it('keeps old refusal records without audit fields replayable', async () => {
    const run = await runScriptedPrompt(
      [{ kind: 'finish', finishReason: 'refusal', outputTokens: 0 }],
      ['please process the task'],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 0, 'refusal.rewrite': false },
      },
    );

    expect(
      run.journalRecords.filter((record) => record['type'] === 'refusal'),
    ).toHaveLength(1);
  });
});
