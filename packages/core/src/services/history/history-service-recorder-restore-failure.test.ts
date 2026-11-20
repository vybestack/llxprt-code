/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { persistedMutationRows } from './__tests__/support/service-recorder-mutations.js';
import {
  atomicRig,
  atomicRow,
  diskVersion,
  fileOf,
  reopenedRows,
  writes,
} from './__tests__/support/service-atomicity.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

describe('HistoryService failed restore version publication', () => {
  for (const stage of ['flush', 'trailer'] as const) {
    it(`keeps the acknowledged replacement and its accounting when restore fails at ${stage}, retaining both causes and reopening both files`, async () => {
      const rig = await atomicRig(`restore-failure-${stage}`);
      const { history, primary, mirror } = rig;
      try {
        history.setTokenizerFactory(exactTokenizer());
        await history.addBatch([atomicRow('A'), atomicRow('B')]);
        await rig.flush();
        const beforeVersion = await diskVersion(fileOf(primary.recording));
        const failure = new Error('replacement observer');
        let replacementTokens = 0;
        const reject = (): never => {
          replacementTokens = history.getTotalTokens();
          if (stage === 'flush')
            primary.failures.failFlushAt = primary.seams.events.filter(
              (event) => event.type === 'flush',
            ).length;
          else primary.failures.failWriteAt = writes(primary);
          throw failure;
        };
        history.once('tokensUpdated', reject);
        const result = await history.replaceAll([atomicRow('C')]).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(result).toBeInstanceOf(AggregateError);
        if (!(result instanceof AggregateError))
          throw new Error('Missing compensation aggregate');
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toBe(failure);
        expect(result.errors[1]).toMatchObject({
          message: `injected ${stage === 'flush' ? 'flush' : 'write'} failure`,
        });
        expect(await diskVersion(fileOf(primary.recording))).toBe(
          beforeVersion + 1,
        );
        const kept = await persistedMutationRows(primary.recording);
        expect(kept.map(({ content: { blocks } }) => blocks)).toStrictEqual([
          atomicRow('C').blocks,
        ]);
        expect(replacementTokens).toBeGreaterThan(0);
        expect(history.getTotalTokens()).toBe(replacementTokens);
        expect(history.getContextRange().totalEntries).toBe(1);
        await history.detachedValues.host().journal.settleFanout();
        expect(await persistedMutationRows(mirror.recording)).toStrictEqual(
          kept,
        );
        const bytes = await readFile(fileOf(primary.recording));
        const count = writes(primary);
        await expect(history.replaceAll([atomicRow('forbidden')])).rejects.toBe(
          result.errors[1],
        );
        expect(writes(primary) - count).toBe(0);
        expect((await readFile(fileOf(primary.recording))).compare(bytes)).toBe(
          0,
        );
        await expect(rig.close()).rejects.toBe(result.errors[1]);
        expect(await reopenedRows(primary)).toStrictEqual(kept);
        expect(await reopenedRows(mirror)).toStrictEqual(kept);
      } finally {
        await rig.close();
      }
    });
  }
});
