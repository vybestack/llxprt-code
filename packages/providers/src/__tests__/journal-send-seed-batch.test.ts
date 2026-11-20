/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalSendFixture } from './support/journal-send-fixture.js';

function* rows(count: number): Generator<IContent> {
  for (let index = 0; index < count; index++)
    yield { speaker: 'human', blocks: [{ type: 'text', text: `${index}:` }] };
}

describe('unmeasured journal send fixture batching', () => {
  it('seeds complete batches and the remainder without changing request rows', async () => {
    const add = HistoryService.prototype.addBatch;
    const batches: number[] = [];
    HistoryService.prototype.addBatch = function (...args) {
      batches.push(args[0].length);
      return add.call(this, ...args);
    };
    try {
      const fixture = await journalSendFixture(rows(513), [], {
        seedBatchRows: 512,
      });
      try {
        expect(batches).toStrictEqual([512, 1]);
        expect(fixture.selection.count).toBe(513);
        let index = 0;
        for await (const row of fixture.selection.openReader()) {
          expect(row.speaker).toBe('human');
          expect(row.blocks).toStrictEqual([
            { type: 'text', text: `${index}:` },
          ]);
          index++;
        }
        expect(index).toBe(513);
      } finally {
        await fixture.close();
      }
    } finally {
      HistoryService.prototype.addBatch = add;
    }
  });
});
