/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import { streamHistoryItems } from '../../utils/streamHistoryItems.js';
import type { HistoryItem } from '../../types.js';
import { ResumeCursorBoot } from '../../../../../core/src/recording/resumeCursorBoot.js';

function callId(index: number): string {
  if (index === 34) return 'missing';
  return index === 16 ? 'c0' : `c${index}`;
}

function fixture(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'before' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'inspection' },
        ...Array.from({ length: 35 }, (_, index) => ({
          type: 'tool_call' as const,
          id: callId(index),
          name: 'read_file',
          parameters: { path: `file${index}` },
        })),
      ],
      metadata: { chronology: { seq: 2, userTurn: 1, step: 1, recordedAt: 0 } },
    },
    ...Array.from(
      { length: 1024 },
      (_, index): IContent => ({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: index === 1023 ? 'c0' : `c${index}`,
            toolName: 'read_file',
            result: `result${index}`,
            ...(index === 3 ? { error: 'failed' } : {}),
          },
        ],
        metadata: {
          chronology: { seq: index + 3, userTurn: 1, step: 1, recordedAt: 0 },
        },
      }),
    ),
    { speaker: 'human', blocks: [{ type: 'text', text: 'after' }] },
  ];
}

function labels(items: readonly HistoryItem[]): unknown[] {
  return items.map((item) =>
    item.type === 'tool_group'
      ? {
          page: item.toolPage,
          span: item.seqSpan,
          tools: item.tools.map((tool) => ({
            id: tool.callId,
            result: tool.resultDisplay,
            status: tool.status,
          })),
        }
      : { type: item.type, text: item.text },
  );
}

async function repage(
  store: ReturnType<typeof createScrollbackPagerStore>,
  expected: unknown[],
  keys: string[],
): Promise<void> {
  store.reportViewport();
  vi.useFakeTimers();
  try {
    store.pageOut('newer');
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
  expect(store.getState().rows).toHaveLength(1);
  for (let page = 0; page < 6; page += 1) await store.pageForward();
  expect(labels(store.getState().rows.map((row) => row.item))).toStrictEqual(
    expected,
  );
  expect(store.getState().rows.map((row) => row.key)).toStrictEqual(keys);
}

let directory: string;

describe('journal logical tool pages', () => {
  beforeEach(async () => {
    directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/toolpaging-fixture-'),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'reconstructs every bounded page, text and duplicate occurrence on backward replay and reopen',
    verifyToolPageReplay,
  );
});

async function initialJournalProjection(): Promise<{
  filePath: string;
  initial: HistoryItem[];
}> {
  const source = fixture();
  const filePath = join(directory, 'journal.jsonl');
  const lines = source.map(
    (content, index) =>
      JSON.stringify({
        v: 1,
        seq: index + 1,
        ts: '',
        type: 'content',
        payload: { content },
      }) + '\n',
  );
  await writeFile(filePath, lines.join(''));
  let offset = 0;
  const offsets = lines.map((line) => {
    const start = offset;
    offset += Buffer.byteLength(line);
    return start;
  });
  const initial: HistoryItem[] = [];
  const boot = await ResumeCursorBoot.open(filePath, source.length, offset);
  try {
    for await (const item of streamHistoryItems(
      boot.streamRows(),
      undefined,
      undefined,
      {
        sourceFor: (_row, index) => ({
          kind: 'journal',
          offset: offsets[index],
        }),
      },
    ))
      initial.push(item);
  } finally {
    await boot.close();
  }
  return { filePath, initial };
}

async function verifyToolPageReplay(): Promise<void> {
  const { filePath, initial } = await initialJournalProjection();
  const expectedTools = Array.from({ length: 35 }, (_, index) => {
    if (index === 34)
      return { id: 'missing', result: undefined, status: 'Pending' };
    return {
      id: index === 16 ? 'c0' : `c${index}`,
      result: index === 0 || index === 16 ? 'result1023' : `result${index}`,
      status: index === 3 ? 'Error' : 'Success',
    };
  });
  const expected = [
    { type: 'user', text: 'before' },
    { type: 'gemini', text: 'inspection' },
    ...[0, 16, 32].map((start) => ({
      page: { start, total: 35, groupIndex: 1 },
      span: [2, 1026],
      tools: expectedTools.slice(start, start + 16),
    })),
    { type: 'user', text: 'after' },
  ];
  expect(labels(initial)).toStrictEqual(expected);
  for (let reopen = 0; reopen < 2; reopen += 1) {
    const viewport = {
      visibleKeys: [] as string[],
      viewportLines: 1,
      rowHeightLines: () => 1,
    };
    const store = createScrollbackPagerStore({
      filePath,
      pageRows: 1,
      viewport,
      settings: {
        marginViewports: 0,
        byteFloorBytes: Infinity,
        purgeDebounceMs: 0,
      },
    });
    try {
      await store.resumeFromJournal();
      for (
        let page = 0;
        page < 1100 && !store.getState().atVisibilityFloor;
        page += 1
      )
        await store.pageBack();
      expect(store.getState().error).toBeNull();
      expect(
        labels(store.getState().rows.map((row) => row.item)),
      ).toStrictEqual(expected);
      expect(
        store.getState().rows.map((row) => row.item.rowIdentity),
      ).toStrictEqual(initial.map((item) => item.rowIdentity));
      expect(new Set(store.getState().rows.map((row) => row.key)).size).toBe(6);
      const keys = store.getState().rows.map((row) => row.key);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        viewport.visibleKeys = [keys[0]];
        await repage(store, expected, keys);
      }
    } finally {
      await store.close();
    }
  }
}
