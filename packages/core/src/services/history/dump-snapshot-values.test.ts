/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `original-${index}` }],
  };
}

describe('dump snapshot scoped values', () => {
  it('captures pending values before returning control to the caller', async () => {
    const history = new HistoryService();
    const original = row(0);
    try {
      history.add(original);
      const expected = structuredClone(original);
      const opening = history.openDumpSnapshot();
      original.blocks = [{ type: 'text', text: 'changed after capture' }];
      history.add(row(1));
      const snapshot = await opening;
      try {
        const values: IContent[] = [];
        for await (const value of snapshot.rows()) values.push(value);
        expect(values).toStrictEqual([expected]);
        const trace = [];
        for await (const entry of snapshot.chronology()) trace.push(entry);
        expect(trace).toHaveLength(1);
      } finally {
        await snapshot.close();
      }
    } finally {
      history.dispose();
    }
  });

  it('keeps repeated reads independent of mutations to a returned row', async () => {
    const history = new HistoryService();
    try {
      history.add(row(0));
      const snapshot = await history.openDumpSnapshot();
      try {
        const first = snapshot.rows()[Symbol.asyncIterator]();
        const original = await first.next();
        if (original.done === true) throw new Error('Missing snapshot row');
        const expected = structuredClone(original.value);
        original.value.blocks = [
          { type: 'text', text: 'changed returned row' },
        ];
        await first.return?.();
        const second = snapshot.rows()[Symbol.asyncIterator]();
        try {
          const reread = await second.next();
          expect(reread.value).toStrictEqual(expected);
        } finally {
          await second.return?.();
        }
      } finally {
        await snapshot.close();
      }
    } finally {
      history.dispose();
    }
  });
});

describe('dump snapshot scoped reader closure', () => {
  it('closes suspended readers and releases their owners immediately', async () => {
    const ownership = new RowOwnership();
    const counters = createRowCounters();
    const history = new HistoryService({
      attachmentCounters: { ...counters.counters, ownership },
    });
    try {
      history.add(row(0));
      await history.waitForCommit();
      const snapshot = await history.openDumpSnapshot();
      const iterator = snapshot.rows()[Symbol.asyncIterator]();
      try {
        const result = await iterator.next();
        expect(result.done).toBe(false);
        expect(ownership.snapshot().liveRows).toBe(1);
        await snapshot.close();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect((await iterator.next()).done).toBe(true);
        await snapshot.close();
        await expect(
          (async () => {
            for await (const value of snapshot.rows()) void value;
          })(),
        ).rejects.toThrow('closed');
      } finally {
        await iterator.return?.();
        await snapshot.close();
      }
    } finally {
      history.dispose();
    }
  });
});
