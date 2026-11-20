/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { findDanglingCalls } from './responses-dangling-calls.js';

function call(id: string, name: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name, parameters: {} }],
  };
}
function result(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId, toolName: 'read', result: 'done' },
    ],
  };
}
function source(rows: readonly IContent[]): () => AsyncIterable<IContent> {
  return async function* () {
    yield* rows;
  };
}

describe('native Responses dangling call selection', () => {
  it('returns no call row or missing calls for text-only history', async () => {
    const found = await findDanglingCalls(
      source([
        { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
      ]),
    );
    expect(found.lastCallRow).toBe(-1);
    expect([...found.missing]).toStrictEqual([]);
  });
  it('settles normalized responses even when they precede their calls', async () => {
    const found = await findDanglingCalls(
      source([
        result('call_a'),
        call('hist_tool_a', 'read'),
        call('call_b', 'write'),
        result('hist_tool_b'),
      ]),
    );
    expect(found.lastCallRow).toBe(2);
    expect([...found.missing]).toStrictEqual([]);
  });
  it('keeps missing calls in call order and names only from the last call row', async () => {
    const found = await findDanglingCalls(
      source([call('call_a', 'read'), call('call_b', 'write')]),
    );
    expect(found.lastCallRow).toBe(1);
    expect([...found.missing]).toStrictEqual([
      ['hist_tool_a', undefined],
      ['hist_tool_b', 'write'],
    ]);
  });
  it('returns the reader and preserves the exact abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stop dangling scan');
    let returned = false;
    const rows = async function* (): AsyncGenerator<IContent> {
      try {
        yield call('call_a', 'read');
        controller.abort(reason);
        yield result('call_a');
      } finally {
        returned = true;
      }
    };
    await expect(findDanglingCalls(rows, controller.signal)).rejects.toBe(
      reason,
    );
    expect(returned).toBe(true);
  });
});
