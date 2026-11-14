/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { CallerOwnedToolQuery } from './caller-owned-tool-query.js';

function rowAt(index: number): IContent {
  return index % 2 === 0
    ? {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_shared',
            name: 'read',
            parameters: {},
          },
        ],
      }
    : {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_shared',
            toolName: 'read',
            result: index,
          },
        ],
      };
}

describe('caller-owned tool index row scope', () => {
  it('reads each row once without keeping a nested row reader open', async () => {
    let reads = 0;
    let readers = 0;
    const rows: ProviderRequestRows = {
      callerOwned: true,
      count: 1024,
      readAt(index) {
        reads++;
        return rowAt(index);
      },
      async *openReader() {
        readers++;
        for (let index = 0; index < 1024; index++) yield rowAt(index);
      },
    };
    const query = await CallerOwnedToolQuery.create(rows);
    expect(await query.normalizedCount(1, 0, 'call_shared')).toBe(512);
    expect(await query.normalizedCount(1, 1, 'call_shared')).toBe(512);
    expect(await query.normalizedPosition(1, 0, 'call_shared', 512)).toBe(1022);
    expect(
      await query.normalizedCount(1, 1, 'call_shared', { from: 127, to: 256 }),
    ).toBe(65);
    expect(reads).toBe(rows.count);
    expect(readers).toBe(0);
  });

  it('preserves source positions and leading-tool eligibility when projection removes rows', async () => {
    const contents: readonly IContent[] = [
      rowAt(1),
      { speaker: 'human', blocks: [{ type: 'text', text: 'removed' }] },
      rowAt(3),
      rowAt(4),
      rowAt(5),
    ];
    const rows: ProviderRequestRows = {
      callerOwned: true,
      count: contents.length,
      readAt: (index) => contents[index],
      async *openReader() {
        yield* contents;
      },
    };
    const query = await CallerOwnedToolQuery.create(rows, (row) =>
      row.speaker === 'human' ? undefined : row,
    );
    expect(await query.normalizedCount(1, 1, 'call_shared')).toBe(3);
    expect(await query.normalizedPosition(1, 0, 'call_shared', 1)).toBe(3);
    expect(await query.normalizedCount(2, 1, 'toolu_shared')).toBe(1);
    expect(await query.normalizedPosition(2, 1, 'toolu_shared', 1)).toBe(4);
  });
});
