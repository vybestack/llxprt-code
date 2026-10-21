/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import { diskSummaryRequestSelection } from '../middleOutDiskPlan.js';
import { referenceSummaryRequest } from './summary-request-reference.js';

function text(speaker: 'human' | 'ai', value: string): IContent {
  return { speaker, blocks: [{ type: 'text', text: value }] };
}

const history: IContent[] = [
  text('human', 'first'),
  text('ai', 'reply'),
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'calling' },
      {
        type: 'tool_call',
        id: 'c1',
        name: 'read',
        parameters: { path: 'a.ts' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'read',
        result: 'file body',
      },
    ],
  },
  text('ai', '<state_snapshot>earlier</state_snapshot>'),
  text('human', 'last'),
];

function indexed(rows: readonly IContent[]): HistoryIndexedRows {
  return {
    length: rows.length,
    readRow: (index) => rows[index],
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

async function drain(reader: AsyncIterable<IContent>): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of reader) rows.push(row);
  return rows;
}

describe('disk summary request selection', () => {
  const injections = [text('human', 'todo context')];
  const planInjection = [text('human', 'long last prompt')];
  const cases: Array<[string, number, number, IContent[]]> = [
    ['plain range without a prior snapshot', 0, 4, []],
    ['range containing a prior snapshot', 1, 6, []],
    ['plan injection after context injections', 0, 5, planInjection],
  ];

  it.each(cases)(
    'streams request bytes identical to the reference for a %s',
    async (_name, top, bottom, planRows) => {
      const selection = diskSummaryRequestSelection(
        indexed(history),
        { top, bottom, injection: planRows },
        'compress this',
        injections,
        new RowOwnership(),
      );
      const reference = referenceSummaryRequest(
        history,
        top,
        bottom,
        'compress this',
        [...injections, ...planRows],
      );
      const streamed = await drain({
        [Symbol.asyncIterator]: () => selection.openReader(),
      });
      expect(JSON.stringify(streamed)).toBe(JSON.stringify(reference));
      expect(selection.count).toBe(reference.length);
      // Random access returns the same row as the sequential reader, and the
      // trigger row (which depends on every journal row) is read last or first.
      for (const index of [reference.length - 1, 0, 2, 1]) {
        expect(JSON.stringify(await selection.readAt(index))).toBe(
          JSON.stringify(reference[index]),
        );
      }
      await expect(selection.readAt(reference.length)).rejects.toThrow(
        RangeError,
      );
      // The selection is repeatable: a second reader sees the same bytes.
      const again = await drain({
        [Symbol.asyncIterator]: () => selection.openReader(),
      });
      expect(JSON.stringify(again)).toBe(JSON.stringify(reference));
    },
  );

  it('owns one journal row at a time and releases on early return', async () => {
    const ownership = new RowOwnership();
    const selection = diskSummaryRequestSelection(
      indexed(history),
      { top: 0, bottom: 5, injection: [] },
      'p',
      [],
      ownership,
    );
    const reader = selection.openReader();
    for (let pulled = 0; pulled < 4; pulled++) await reader.next();
    expect(ownership.snapshot().liveRows).toBe(1);
    await reader.return(undefined);
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(ownership.snapshot().peakRows).toBe(1);
  });

  it('retires an admitted reader before closing the indexed source', async () => {
    const ownership = new RowOwnership();
    const selection = diskSummaryRequestSelection(
      indexed(history),
      { top: 0, bottom: 5, injection: [] },
      'p',
      [],
      ownership,
    );
    const reader = selection.openReader();
    for (let pulled = 0; pulled < 3; pulled++) await reader.next();
    expect(ownership.snapshot().liveRows).toBe(1);
    await selection.close();
    expect(ownership.snapshot().liveRows).toBe(0);
    await expect(selection.readAt(2)).rejects.toThrow('closed');
    await expect(reader.next()).rejects.toThrow('closed');
  });

  it('waits for an admitted asynchronous read and preserves cancellation after I/O', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel during source read');
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const source = indexed(history);
    const selection = diskSummaryRequestSelection(
      {
        ...source,
        async readRow(index) {
          enter();
          await pending;
          return source.readRow(index);
        },
      },
      { top: 0, bottom: 5, injection: [] },
      'p',
      [],
      new RowOwnership(),
    );
    const read = selection.readAt(2, controller.signal);
    await entered;
    controller.abort(reason);
    let retired = false;
    const closing = Promise.resolve(selection.close()).then(() => {
      retired = true;
    });
    await Promise.resolve();
    expect(retired).toBe(false);
    release();
    await expect(read).rejects.toBe(reason);
    await closing;
    expect(retired).toBe(true);
  });

  it('stops a pass when the signal aborts', async () => {
    const controller = new AbortController();
    const selection = diskSummaryRequestSelection(
      indexed(history),
      { top: 0, bottom: 5, injection: [] },
      'p',
      [],
      new RowOwnership(),
    );
    const reader = selection.openReader(controller.signal);
    await reader.next();
    controller.abort(new Error('stop'));
    await expect(
      drain({ [Symbol.asyncIterator]: () => reader }),
    ).rejects.toThrow('stop');
  });
});
