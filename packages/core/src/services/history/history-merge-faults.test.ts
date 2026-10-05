/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { readFile } from 'node:fs/promises';
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
    it(`restores ${pending ? 'pending identities' : 'durable values'} after partial admission and allows a queued mutation`, async () => {
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
          expect(rows[0] === baseline).toBe(pending);
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

  it('compensates serialization failure after an earlier row has been admitted', async () => {
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
        await expect(
          Promise.resolve().then(() => target.merge(source)),
        ).rejects.toThrow('BigInt');
        expect(await rowsOf(target)).toStrictEqual([baseline]);
        await target.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([baseline]);
        const path = recorder.getFilePath();
        if (path === null) throw new Error('Missing compensation journal');
        expect(await readFile(path, 'utf8')).toContain(
          '"timestamp":1700000000010',
        );
      });
      later.blocks.pop();
      releaseSource();
      await source.waitForCommit();
    }, true);
  });
});
