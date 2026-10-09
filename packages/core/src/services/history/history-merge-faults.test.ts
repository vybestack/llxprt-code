/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { mergeRow } from './history-merge-test-helpers.js';
import {
  withRollbackFixture,
  rowsOf,
  rejectedValue,
  durableRowsOf,
  exactTokenizer,
} from './chronology-rollback-test-helpers.js';

async function withSource(
  action: (source: HistoryService) => Promise<void>,
): Promise<void> {
  const source = new HistoryService();
  source.setTokenizerFactory(exactTokenizer());
  source.addAll([mergeRow(10), mergeRow(11), mergeRow(12)]);
  await source.waitForCommit();
  try {
    await action(source);
  } finally {
    source.dispose();
  }
}

describe('history merge compensation and publication', () => {
  for (const pending of [false, true]) {
    it(`restores ${pending ? 'pending' : 'durable'} values after partial admission and allows a queued mutation`, async () => {
      await withSource(async (source) =>
        withRollbackFixture(async (target, recorder, releaseWriter) => {
          const marker = {
            seq: 1,
            userTurn: 1,
            step: 0,
            recordedAt: 1700000000000,
          };
          const baseline = mergeRow(0, 2048, marker);
          target.add(baseline);
          await target.waitForTokenUpdates();
          if (!pending) await target.waitForCommit();
          const tokens = target.getTotalTokens();
          recorder.failAdmissionAfter(1);
          const merge = target.merge(source);
          const following = mergeRow(30);
          target.add(following);
          expect(await rejectedValue(Promise.resolve(merge))).toBe(
            recorder.failure,
          );
          const rows = await rowsOf(target);
          expect(rows).toStrictEqual([baseline, following]);
          expect(rows[0]).not.toBe(baseline);
          expect(baseline.metadata?.chronology).toBe(marker);
          await target.waitForTokenUpdates();
          expect(target.getTotalTokens()).toBe(tokens * 2);
          releaseWriter();
          await target.waitForCommit();
          expect(await durableRowsOf(recorder)).toStrictEqual([
            baseline,
            following,
          ]);
        }, pending),
      );
    });
  }
});

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
