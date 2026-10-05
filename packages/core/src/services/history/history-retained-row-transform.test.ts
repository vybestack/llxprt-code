/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

function rawRow(index: number): IContent {
  return {
    speaker: 'ai',
    blocks: [],
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
      responsesStored: true,
    },
  };
}

describe('retained raw rows in addressed transforms', () => {
  it('retains empty raw AI blocks while changing only stale provider metadata', async () => {
    await withSuffixFixture(
      2,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        await history.transformRows(async (source, sink) => {
          let index = 0;
          for await (const entry of source.streamRows()) {
            const metadata = { ...entry.row.metadata };
            delete metadata.responsesStored;
            sink.appendRetained(index++, { ...entry.row, metadata });
          }
        });
        const result: IContent[] = [];
        for await (const row of history.streamRawHistory()) result.push(row);
        expect(result).toStrictEqual(
          [0, 1].map((index) => {
            const row = rawRow(index);
            const metadata = { ...row.metadata };
            delete metadata.responsesStored;
            return { ...row, metadata };
          }),
        );
      },
      0,
      rawRow,
    );
  });
  it('rejects changed blocks through the retained-row API before publication', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        await expect(
          history.transformRows(async (_source, sink) => {
            sink.appendRetained(0, {
              ...rawRow(0),
              blocks: [{ type: 'text', text: 'replacement' }],
            });
          }),
        ).rejects.toThrow('Retained history row blocks or speaker changed');
        const result: IContent[] = [];
        for await (const row of history.streamRawHistory()) result.push(row);
        expect(result).toStrictEqual([rawRow(0)]);
      },
      0,
      rawRow,
    );
  });
});
