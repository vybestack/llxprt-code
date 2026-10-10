/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestShapeSessionMemory } from './tokenUsageRequestShape.js';
import { BoundedToolCallNames } from './tokenUsageToolCallNames.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { BoundarySnapshotDisk } from './boundary-snapshot-disk.js';
import {
  fallbackCount,
  shapeState,
} from './__tests__/support/token-usage-source-fixture.js';

const root = sourceRootSetup();

const png = (data: string): IContent => ({
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'look' },
    { type: 'media', encoding: 'base64', mimeType: 'image/png', data },
  ],
});
const call = (id: string, name: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name, parameters: { id } }],
});
const result = (callId: string, toolName: string, body: string): IContent => ({
  speaker: 'tool',
  blocks: [{ type: 'tool_response', callId, toolName, result: body }],
});

const mixedHistory: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
  png('YWJj'),
  call('a', 'read_file'),
  call('b', 'grep'),
  result('a', '', 'file body'),
  result('b', 'grep', 'match [Output truncated due to token limit]'),
  { speaker: 'ai', blocks: [{ type: 'thinking', thought: 'hm' }] },
  result('orphan', 'named_only', 'orphan body'),
  result('nameless', '', 'nameless body'),
  { speaker: 'ai', blocks: [{ type: 'code', code: 'x', language: 'ts' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'both' },
      { type: 'tool_call', id: 'c', name: 'write', parameters: {} },
    ],
  },
  result('c', '', 'written'),
  {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId: 'a', toolName: '', result: 1 }],
  },
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'ctx' }],
    metadata: { synthetic: true },
  },
];

async function sourceShape(
  memory: RequestShapeSessionMemory,
  history: readonly IContent[],
) {
  const disk = new BoundarySnapshotDisk(root());
  await disk.capture('after', {
    count: history.length,
    async *openReader(): AsyncGenerator<IContent, void, unknown> {
      for (const row of history) yield row;
    },
  });
  try {
    return await memory.recordSourceRequestShape({
      requestRows: disk.selection('after'),
      tools: [{ name: 'read_file' }],
      instructionsText: 'system',
      countTokens: fallbackCount,
    });
  } finally {
    disk.close();
  }
}

describe('source request shape admits tool and media rows', () => {
  it('produces the array route records, buckets and session state across two sends', async () => {
    const arrayMemory = new RequestShapeSessionMemory(64);
    const sourceMemory = new RequestShapeSessionMemory(64);
    for (let send = 0; send < 2; send++) {
      const expected = arrayMemory.recordRequestShape({
        requestContents: mixedHistory,
        tools: [{ name: 'read_file' }],
        instructionsText: 'system',
        countTokens: fallbackCount,
      });
      const actual = await sourceShape(sourceMemory, mixedHistory);
      expect(actual).toStrictEqual(expected);
      expect(shapeState(sourceMemory)).toStrictEqual(shapeState(arrayMemory));
    }
    const names = (
      await sourceShape(new RequestShapeSessionMemory(64), mixedHistory)
    ).toolCalls.map((entry) => [entry.callId, entry.toolName]);
    expect(names).toStrictEqual([
      ['a', 'read_file'],
      ['b', 'grep'],
      ['orphan', 'named_only'],
      ['nameless', '__unresolved_tool__'],
      ['c', 'write'],
      ['a', 'read_file'],
    ]);
  });

  it('attributes parallel calls to results in any order', async () => {
    const history = [
      call('x', 'one'),
      call('y', 'two'),
      result('y', '', 'yy'),
      result('x', '', 'xx'),
    ];
    const expected = new RequestShapeSessionMemory(8).recordRequestShape({
      requestContents: history,
      tools: [],
      instructionsText: undefined,
      countTokens: fallbackCount,
    });
    expect(
      await sourceShape(new RequestShapeSessionMemory(8), history),
    ).toStrictEqual(expect.objectContaining({ toolCalls: expected.toolCalls }));
  });
});

describe('BoundedToolCallNames', () => {
  it('retains at most its capacity of the most recent calls', () => {
    const names = new BoundedToolCallNames(2);
    for (const id of ['a', 'b', 'c']) names.observe(call(id, `tool-${id}`));
    expect(names.get('a')).toBeUndefined();
    expect(names.get('b')).toBe('tool-b');
    expect(names.get('c')).toBe('tool-c');
  });

  it('keeps a re-observed call id as the most recent', () => {
    const names = new BoundedToolCallNames(2);
    names.observe(call('a', 'first'));
    names.observe(call('b', 'bee'));
    names.observe(call('a', 'again'));
    names.observe(call('c', 'sea'));
    expect(names.get('b')).toBeUndefined();
    expect(names.get('a')).toBe('again');
  });
});
