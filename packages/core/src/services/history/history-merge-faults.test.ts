/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { mergeRow } from './__tests__/support/history-merge-test-helpers.js';
import {
  durableRowsOf,
  exactTokenizer,
  rejectedValue,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

async function withSource(
  action: (source: HistoryService) => Promise<void>,
): Promise<void> {
  const source = new HistoryService({});
  source.setTokenizerFactory(exactTokenizer());
  source.addAll([mergeRow(10), mergeRow(11), mergeRow(12)]);
  await source.waitForCommit();
  try {
    await action(source);
  } finally {
    await source.dispose();
  }
}

describe('history merge observer and serialization compensation', () => {
  it('emits appended rows in order and compensates a throwing content observer', async () => {
    await withSource(async (source) =>
      withRollbackFixture(async (target, recorder) => {
        const baseline = mergeRow(0);
        target.add(baseline);
        await target.waitForCommit();
        const observed: number[] = [];
        const primary = new Error('merge content observer failure');
        target.once('contentAdded', (row) => {
          observed.push(row.metadata?.chronology?.seq ?? -1);
          throw primary;
        });
        expect(await rejectedValue(Promise.resolve(target.merge(source)))).toBe(
          primary,
        );
        expect(observed).toStrictEqual([11]);
        expect(await rowsOf(target)).toStrictEqual([baseline]);
        await target.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
      }),
    );
  });

  it('merges the admitted source value when the caller mutates its row after admission', async () => {
    await withRollbackFixture(async (source, _recorder, releaseSource) => {
      const first = mergeRow(10);
      const later = mergeRow(11);
      source.addAll([first, later]);
      releaseSource();
      await source.waitForTokenUpdates();
      later.blocks.push({
        type: 'tool_response',
        callId: 'bad',
        toolName: 'bad',
        result: 1n,
      });
      await withRollbackFixture(async (target, recorder) => {
        const baseline = mergeRow(0);
        target.add(baseline);
        await target.waitForCommit();
        await target.merge(source);
        expect(await rowsOf(target)).toStrictEqual([
          baseline,
          mergeRow(10),
          mergeRow(11),
        ]);
        await target.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([
          baseline,
          mergeRow(10),
          mergeRow(11),
        ]);
      });
      later.blocks.pop();
      releaseSource();
      await source.waitForCommit();
    }, true);
  });
});
