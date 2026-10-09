/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import {
  exactTokenizer,
  expectedRange,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-test-helpers.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import { changedTransformRow } from './row-transform-test-helpers.js';

const sizes = [512, 8192];

async function expectMembership(
  history: HistoryService,
  before: IContent[],
): Promise<void> {
  expect(await rowsOf(history)).toStrictEqual(before);
}

describe('disk-backed row transform', () => {
  for (const size of sizes) {
    it(`copies ${size} media/tool rows without a context array and restores every row after GC`, async () => {
      const owners = new RowOwnership();
      await withCoreSuffixFixture(
        size,
        async (history) => {
          history.setTokenizerFactory(exactTokenizer());
          const primary = new Error('publication failed');
          let traversed = 0;
          const operation = history.transformAll(
            async (source, sink) => {
              for await (const entry of source.streamRows()) {
                expect(entry.ownership).toBe('detached');
                expect(entry.row).toStrictEqual(
                  ownerFixtureRow(traversed++, 2048),
                );
                sink.appendDetached(changedTransformRow(entry.row));
              }
            },
            undefined,
            {
              afterPublication: () => {
                const census = owners.snapshot();
                expect(census.liveRows).toBeGreaterThan(0);
                expect(census.liveRows).toBeLessThanOrEqual(440);
                expect(census.liveSerializedBytes).toBeLessThanOrEqual(
                  8 * 1024 * 1024,
                );
                gcAndSweep();
                throw primary;
              },
            },
          );
          expect(await rejectedValue(operation)).toBe(primary);
          expect(traversed).toBe(size);
          let restored = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(ownerFixtureRow(restored++, 2048));
          }
          expect(restored).toBe(size);
          expect(owners.snapshot().liveRows).toBe(0);
        },
        2048,
        ownerFixtureRow,
        owners,
      );
    }, 120_000);
  }
});

describe('row transform marker identity and cancellation', () => {
  it('restores a strongly pinned original marker after displacement and GC', async () => {
    await withRollbackFixture(async (history) => {
      const original = { seq: 300, userTurn: 200, step: 9, recordedAt: 0 };
      const row = { ...rollbackRow(0), metadata: { chronology: original } };
      const fresh = rollbackRow(1);
      const primary = new Error('after publication');
      expect(
        await rejectedValue(
          history.transformAll(
            async (_source, sink) => {
              sink.appendIdentity(row);
              sink.appendBorrowed(fresh);
              sink.appendBorrowed(fresh);
            },
            undefined,
            {
              afterPublication: () => {
                row.metadata.chronology = { ...original, seq: 900 };
                gcAndSweep();
                throw primary;
              },
            },
          ),
        ),
      ).toBe(primary);
      expect(row.metadata.chronology).toBe(original);
      expect(fresh.metadata).toBeUndefined();
      expect(await rowsOf(history)).toStrictEqual([]);
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect(following.metadata?.chronology?.seq).toBe(1);
    });
  });

  it('cancels a partial cursor without publishing and permits a later traversal', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      await history.waitForCommit();
      const controller = new AbortController();
      const cancellation = new Error('cancelled');
      expect(
        await rejectedValue(
          history.transformAll(
            async (source, sink) => {
              for await (const entry of source.streamRows()) {
                sink.appendDetached(entry.row);
                controller.abort(cancellation);
              }
            },
            undefined,
            { signal: controller.signal },
          ),
        ),
      ).toBe(cancellation);
      await expectMembership(history, before);
      await history.transformAll(async (source, sink) => {
        for await (const entry of source.streamRows())
          sink.appendDetached(entry.row);
      });
      await expectMembership(history, before);
      expect(history.getContextRange()).toStrictEqual(expectedRange(3));
    });
  });
});

describe('row transform validation and journal admission', () => {
  it('rejects invalid rows before tokenization and never stamps detached caller values', async () => {
    await withRollbackFixture(async (history) => {
      const fresh = rollbackRow(0);
      await expect(
        history.transformAll(async (_source, sink) => {
          sink.appendDetached(fresh);
          sink.appendDetached({ speaker: 'ai', blocks: [] });
        }),
      ).rejects.toThrow(
        'History batch entry 1 is invalid: content has no blocks',
      );
      expect(fresh.metadata).toBeUndefined();
      expect(await rowsOf(history)).toStrictEqual([]);
    });
  });

  it('rolls back a partial journal admission and preserves its primary error', async () => {
    await withRollbackFixture(async (history, recorder) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      await history.waitForCommit();
      recorder.failAdmissionAfter(2);
      expect(
        await rejectedValue(
          history.transformAll(async (_source, sink) => {
            for (let index = 3; index < 7; index++)
              sink.appendDetached(rollbackRow(index));
          }),
        ),
      ).toBe(recorder.failure);
      await expectMembership(history, before);
      expect(history.getTotalTokens()).toBe(12);
      expect(history.getContextRange()).toStrictEqual(expectedRange(3));
    });
  });

  it('does not publish a binding when the requested media is absent', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0)];
      await history.addBatch(before);
      await expect(
        createHistoryProviderFileBindingStore(history).bind('missing', {
          provider: 'test',
          baseURL: 'https://example.test',
          credentialHash: 'test',
          fileId: 'file',
          byteLength: 4,
          scope: 'session',
          scopeId: 'session',
          createdAt: 0,
          expiresAt: 1000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
          deletionState: 'active',
        }),
      ).rejects.toThrow(
        'Cannot bind provider file to missing media content missing',
      );
      await expectMembership(history, before);
    });
  });
});
