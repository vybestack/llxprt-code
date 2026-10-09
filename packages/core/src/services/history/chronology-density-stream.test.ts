/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import type { DensityResult } from '../../core/compression/types.js';
import type { IContent } from './IContent.js';

function density(replacement: IContent): DensityResult {
  return {
    replacements: new Map([[1, replacement]]),
    removals: [2],
    metadata: {
      readWritePairsPruned: 0,
      fileDeduplicationsPruned: 0,
      recencyPruned: 1,
    },
  };
}

describe('density repeatable candidate publication', () => {
  for (const pending of [false, true]) {
    it(`publishes repeatable ${pending ? 'pending' : 'durable'} candidates without an array and restores replacement identity`, async () => {
      await withRollbackFixture(async (history, _recorder, releaseWriter) => {
        const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
        const adding = history.addBatch(before);
        if (pending) releaseWriter();
        await adding;
        await history.waitForCommit();
        const marker = { seq: 700, userTurn: 90, step: 3, recordedAt: 0 };
        const replacement = {
          ...rollbackRow(3),
          metadata: { chronology: marker },
        };
        const primary = new Error('candidate publication');
        history.registerMediaOwner(
          mediaParticipant((input) => ({
            publish: () => {
              expect(Array.isArray(input.next)).toBe(false);
              const first = [...input.next];
              const second = [...input.next];
              expect(second).toStrictEqual(first);
              expect(first).toHaveLength(2);
              expect(first[1].blocks).toStrictEqual(replacement.blocks);
              expect(first[1].metadata?.chronology?.seq).toBe(2);
              throw primary;
            },
            rollback: () => undefined,
          })),
        );
        const operation = rejectedValue(
          history.applyDensityResult(density(replacement)),
        );
        expect(await operation).toBe(primary);
        expect(replacement.metadata.chronology).toStrictEqual(marker);
        expect(await rowsOf(history)).toMatchObject(before);
      }, pending);
    });
  }
});
