/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { streamHistoryItems } from './streamHistoryItems.js';
import { ToolCallStatus } from '../types.js';

describe('streamed resume projection', () => {
  it('pairs split tool responses and preserves ordering and unique row identities', async () => {
    async function* rows(): AsyncIterable<IContent> {
      yield { speaker: 'human', blocks: [{ type: 'text', text: 'inspect' }] };
      yield {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'a', name: 'read', parameters: {} },
          { type: 'tool_call', id: 'b', name: 'read', parameters: {} },
        ],
      };
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'b',
            toolName: 'read',
            result: 'second',
          },
        ],
      };
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'a',
            toolName: 'read',
            result: 'first',
          },
        ],
      };
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
    }
    const items = [];
    for await (const item of streamHistoryItems(rows(), 'allowed'))
      items.push(item);
    expect(items.map((item) => item.type)).toStrictEqual([
      'user',
      'tool_group',
      'gemini',
    ]);
    const group = items[1];
    if (group.type !== 'tool_group') throw new Error('Expected tool group');
    expect(
      group.tools.map((tool) => [tool.callId, tool.resultDisplay, tool.status]),
    ).toStrictEqual([
      ['a', 'first', ToolCallStatus.Success],
      ['b', 'second', ToolCallStatus.Success],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
    expect(
      new Set(items.map((item) => JSON.stringify(item.rowIdentity))).size,
    ).toBe(3);
  });
});
