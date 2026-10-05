/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RowOwnership } from '../../../../core/src/recording/rowOwnership.js';
import { streamHistoryItems } from './streamHistoryItems.js';
import { ToolCallStatus } from '../types.js';
import {
  createHistoryLedger,
  projectHistory,
} from '../stores/turn/historyLedger.js';
import { rowIdentityKey } from './rowIdentity.js';

const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('bounded tool response projection', () => {
  it(
    'preserves one chronology span and distinct page identities alongside a live call',
    verifyPreservesOneChronologySpanAndDistinctPageIdentitiesAlongsideALiveCall,
  );

  it(
    'caps wide response payloads before retaining a display page',
    verifyCapsWideResponsePayloadsBeforeRetainingADisplayPage,
  );

  it.each([32, 1024, 4096])(
    'bounds %s responses while preserving the final matched response',
    verifyBoundsCountResponsesWhilePreservingTheFinalMatchedResponse,
  );

  it.each([1024, 4096])(
    'pages %s calls without retaining their response context in UI rows',
    verifyPagesCountCallsWithoutRetainingTheirResponseContextInUIRows,
  );
});

async function verifyPreservesOneChronologySpanAndDistinctPageIdentitiesAlongsideALiveCall(): Promise<void> {
  const ledger = createHistoryLedger();
  ledger.append({
    id: 1,
    type: 'tool_group',
    rowIdentity: { kind: 'pending', pendingKey: 'live' },
    tools: [
      {
        callId: '0',
        name: 'read_file',
        description: 'live',
        resultDisplay: undefined,
        status: ToolCallStatus.Pending,
        confirmationDetails: undefined,
      },
    ],
  });
  async function* rows(): AsyncIterable<IContent> {
    yield {
      speaker: 'ai',
      metadata: {
        chronology: { seq: 10, userTurn: 1, step: 1, recordedAt: 0 },
      },
      blocks: Array.from({ length: 33 }, (_, index) => ({
        type: 'tool_call',
        id: String(index),
        name: 'read_file',
        parameters: {},
      })),
    };
    for (let index = 32; index >= 0; index -= 1)
      yield {
        speaker: 'tool',
        metadata: {
          chronology: {
            seq: 43 - index,
            userTurn: 1,
            step: 2,
            recordedAt: 0,
          },
        },
        blocks: [
          {
            type: 'tool_response',
            callId: String(index),
            toolName: 'read_file',
            result: index,
          },
        ],
      };
  }
  for await (const item of streamHistoryItems(rows())) {
    expect(item.seqSpan).toStrictEqual([10, 43]);
    ledger.append(item);
  }
  const items = projectHistory(ledger.getState());
  expect(items.length).toBe(4);
  const keys = items.map((item) => {
    if (!item.rowIdentity) throw new Error('Missing identity');
    return rowIdentityKey(item.rowIdentity);
  });
  expect(keys).toStrictEqual([
    'pending:live',
    'legacy:0:toolGroup',
    'legacy:0:toolGroup:tools:16',
    'legacy:0:toolGroup:tools:32',
  ]);
  expect(new Set(items.map((item) => item.id)).size).toBe(4);
  ledger.clear();
}

async function verifyCapsWideResponsePayloadsBeforeRetainingADisplayPage(): Promise<void> {
  const ownership = new RowOwnership();
  async function* rows(): AsyncIterable<IContent> {
    yield {
      speaker: 'ai',
      blocks: Array.from({ length: 32 }, (_, index) => ({
        type: 'tool_call',
        id: String(index),
        name: 'read_file',
        parameters: {},
      })),
    };
    for (let index = 0; index < 32; index += 1) {
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: String(index),
            toolName: 'read_file',
            result: 'x'.repeat(1024 * 1024),
          },
        ],
      };
    }
  }
  let calls = 0;
  for await (const item of streamHistoryItems(rows(), 'allowed', ownership)) {
    if (item.type !== 'tool_group') throw new Error('Expected tool group');
    calls += item.tools.length;
    for (const tool of item.tools) expect(tool.retention?.capped).toBe(true);
  }
  expect(calls).toBe(32);
  await writeFile(
    'tmp/verify854/p05d/toolpeak-wide.json',
    JSON.stringify(ownership.snapshot(), null, 2),
  );
  expect(
    ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
  ).toBe(true);
  expect(ownership.snapshot().liveRows).toBe(0);
}

async function verifyBoundsCountResponsesWhilePreservingTheFinalMatchedResponse(
  count: number,
): Promise<void> {
  const ownership = new RowOwnership();
  async function* rows(): AsyncIterable<IContent> {
    yield {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: 'a', name: 'read_file', parameters: {} },
        {
          type: 'tool_call',
          id: 'missing',
          name: 'write_file',
          parameters: {},
        },
        { type: 'tool_call', id: 'a', name: 'read_file', parameters: {} },
      ],
    };
    for (let index = 0; index < count; index += 1) {
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: index % 2 === 0 ? 'a' : 'unmatched',
            toolName: 'response_name',
            result: `${index}:${'x'.repeat(4096)}`,
            error: index === count - 2 ? 'failed' : undefined,
          },
        ],
      };
    }
  }
  let groups = 0;
  for await (const item of streamHistoryItems(rows(), 'allowed', ownership)) {
    if (item.type !== 'tool_group') throw new Error('Expected tool group');
    groups += 1;
    expect(
      item.tools.map((tool) => [tool.callId, tool.name, tool.status]),
    ).toStrictEqual([
      ['a', 'read_file', ToolCallStatus.Error],
      ['missing', 'write_file', ToolCallStatus.Pending],
      ['a', 'read_file', ToolCallStatus.Error],
    ]);
    expect(
      String(item.tools[0].resultDisplay).startsWith(`${count - 2}:`),
    ).toBe(true);
    expect(item.tools[2].resultDisplay).toBe(item.tools[0].resultDisplay);
  }
  expect(groups).toBe(1);
  await writeFile(
    `tmp/verify854/p05d/toolpeak-${count}.json`,
    JSON.stringify(ownership.snapshot(), null, 2),
  );
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(ownership.within(bound)).toBe(true);
}

async function verifyPagesCountCallsWithoutRetainingTheirResponseContextInUIRows(
  count: number,
): Promise<void> {
  const ownership = new RowOwnership();
  async function* rows(): AsyncIterable<IContent> {
    yield {
      speaker: 'ai',
      blocks: Array.from({ length: count }, (_, index) => ({
        type: 'tool_call',
        id: String(index),
        name: 'read_file',
        parameters: {},
      })),
    };
    for (let index = count - 1; index >= 0; index -= 1) {
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: String(index),
            toolName: 'read_file',
            result: `${index}:${'x'.repeat(4096)}`,
          },
        ],
      };
    }
  }
  let calls = 0;
  const identities = new Set<string>();
  for await (const item of streamHistoryItems(rows(), 'allowed', ownership)) {
    if (item.type !== 'tool_group') throw new Error('Expected tool group');
    expect(item.tools.length).toBeLessThanOrEqual(16);
    expect(item.toolPage).toStrictEqual({
      start: calls,
      total: count,
      groupIndex: 0,
    });
    identities.add(JSON.stringify(item.rowIdentity));
    for (const tool of item.tools) {
      expect(tool.callId).toBe(String(calls));
      expect(String(tool.resultDisplay).startsWith(`${calls}:`)).toBe(true);
      calls += 1;
    }
  }
  expect(calls).toBe(count);
  expect(identities.size).toBe(Math.ceil(count / 16));
  await writeFile(
    `tmp/verify854/p05d/toolpeak-calls-${count}.json`,
    JSON.stringify(ownership.snapshot(), null, 2),
  );
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(ownership.within(bound)).toBe(true);
}
