import { observeHistorySynchronouslyForTest } from '../../test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import { EagerSemanticPurgeOracle } from './semantic-purge-eager-test-oracle.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import {
  exactTokenizer,
  rejectedValue,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

export function purgeRow(index: number, bytes = 2048): IContent {
  const row = ownerFixtureRow(index, bytes);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      id: `row-${index}`,
      ...(row.speaker === 'ai' ? { responsesStored: true } : {}),
    },
    blocks: row.blocks.map((block) =>
      block.type === 'media' && index % 17 === 0
        ? {
            ...block,
            mimeType: 'image/png',
            sourceContentId: `image-${index}`,
            caption: `caption-${index}`,
          }
        : block,
    ),
  };
}
const success = { status: 'success', cachePrefixWritten: true } as const;

class NoArrayHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'whole-history materializer seam',
    );
  }
}

describe('journal materialization guard', () => {
  it('NoArrayHistory rejects journal eager materialization', () => {
    const history = new NoArrayHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'whole-history materializer seam',
      );
    } finally {
      history.dispose();
    }
  });
});

function verifyBoundaryIdentity(
  actual: object | undefined,
  expected: object,
): void {
  expect(actual).toBe(expected);
}

async function collect(source: {
  streamRows(): AsyncIterable<IContent>;
}): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source.streamRows()) rows.push(row);
  return rows;
}

async function verifyFullFixture(
  size: number,
): Promise<ReturnType<RowOwnership['snapshot']>> {
  const owners = new RowOwnership();
  await withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      await withSuffixFixture(
        size,
        async (eager) => {
          eager.setTokenizerFactory(exactTokenizer());
          const oracle = new EagerSemanticPurgeOracle(eager, {
            enabled: true,
            explicitCacheWriteRequired: false,
          }).begin({ mode: 'remove' });
          if (oracle === undefined) throw new Error('Missing eager candidate');
          const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
            enabled: true,
            explicitCacheWriteRequired: false,
            ownership: owners,
          });
          const transaction = await coordinator.begin({ mode: 'remove' });
          if (transaction === undefined)
            throw new Error('Missing streaming candidate');
          try {
            expect(await collect(transaction.candidate)).toStrictEqual([
              ...oracle.candidateHistory,
            ]);
            expect(transaction.nextFrontier).toStrictEqual(oracle.nextFrontier);
            expect(transaction.preImageBoundary).toStrictEqual(
              oracle.preImageBoundary,
            );
            await coordinator.commit(transaction, success);
            gcAndSweep();
            let restored = 0;
            for await (const row of transaction.base.streamRows())
              expect(row).toStrictEqual(purgeRow(restored++));
            expect(restored).toBe(size);
            await coordinator.rollback(transaction);
            let index = 0;
            for await (const row of history.streamRawHistory())
              expect(row).toStrictEqual(purgeRow(index++));
            expect(index).toBe(size);
            expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
          } finally {
            transaction.close();
          }
        },
        2048,
        purgeRow,
      );
    },
    2048,
    purgeRow,
    owners,
    (options) => new NoArrayHistory(options),
  );
  return owners.snapshot();
}

describe('complete disk semantic purge membership', () => {
  for (const size of [512, 8192]) {
    it(`pins and restores all ${size} rows while matching legacy eager purge values`, async () => {
      const census = await verifyFullFixture(size);
      expect(census.liveRows).toBe(0);
    }, 300_000);
  }
});

describe('detached semantic purge transactions', () => {
  it('returns frozen detached rows on independent cursors and fails fast after close', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'summary' });
        if (transaction === undefined) throw new Error('Missing transaction');
        const first = await collect(transaction.candidate);
        const second = await collect(transaction.candidate);
        expect(first).toStrictEqual(second);
        expect(first[0]).not.toBe(second[0]);
        expect(Object.isFrozen(first[0].blocks)).toBe(true);
        transaction.close();
        transaction.close();
        await expect(collect(transaction.base)).rejects.toThrow('closed');
        await expect(coordinator.commit(transaction, success)).rejects.toThrow(
          'closed',
        );
      },
      2048,
      purgeRow,
    );
  });

  it('retains the same base and cache-boundary identity after a rejected commit', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: true,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (
          transaction?.preImageBoundaryIdentity === undefined ||
          transaction.preImageBoundary === undefined
        )
          throw new Error('Missing boundary');
        try {
          const identity = transaction.preImageBoundaryIdentity;
          const before = await collect(transaction.base);
          expect(
            await coordinator.commit(transaction, {
              status: 'cancelled',
              cachePrefixWritten: true,
            }),
          ).toBe(false);
          expect(
            await coordinator.commit(transaction, {
              status: 'success',
              cachePrefixWritten: false,
            }),
          ).toBe(false);
          expect(await rowsOf(history)).toStrictEqual(before);
          verifyBoundaryIdentity(
            transaction.preImageBoundaryIdentity,
            identity,
          );
          expect(identity.matches(transaction.preImageBoundary)).toBe(true);
        } finally {
          transaction.close();
        }
      },
      2048,
      purgeRow,
    );
  });
});

describe('stream purge rollback and concurrency', () => {
  it('rejects concurrent target changes before persistence', async () => {
    await withRollbackFixture(async (history) => {
      await history.addBatch([purgeRow(0), purgeRow(1)]);
      await history.waitForCommit();
      let persisted = 0;
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
        persist: async () => {
          persisted++;
        },
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (transaction === undefined) throw new Error('Missing transaction');
      try {
        await history.addBatch([purgeRow(2)]);
        await expect(coordinator.commit(transaction, success)).rejects.toThrow(
          'History changed',
        );
        expect(persisted).toBe(0);
        expect((await rowsOf(history)).length).toBe(3);
      } finally {
        transaction.close();
      }
    });
  });

  it('restores all live rows and durable callback values when admission fails', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.addBatch([purgeRow(0), purgeRow(1), purgeRow(2)]);
      await history.waitForCommit();
      const before = [purgeRow(0), purgeRow(1), purgeRow(2)];
      const writes: IContent[][] = [];
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
        persist: async (source) => {
          writes.push(await collect(source));
        },
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (transaction === undefined) throw new Error('Missing transaction');
      try {
        recorder.failAdmissionAfter(1);
        expect(
          await rejectedValue(
            coordinator.commit(transaction, success).then(() => undefined),
          ),
        ).toBe(recorder.failure);
        expect(await rowsOf(history)).toStrictEqual(before);
        expect(writes).toHaveLength(2);
        expect(writes[1]).toStrictEqual(before);
        expect(coordinator.frontier).toStrictEqual({
          contentIndex: 0,
          blockIndex: 0,
        });
      } finally {
        transaction.close();
      }
    });
  });
});

describe('stream purge persistence and row admission', () => {
  it('preserves a persistence rejection object without rewriting or compensation', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const before = Array.from({ length: 3 }, (_, index) => purgeRow(index));
        const failure = new Error('disk unavailable');
        let writes = 0;
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          persist: async () => {
            writes++;
            throw failure;
          },
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          expect(
            await rejectedValue(
              coordinator.commit(transaction, success).then(() => undefined),
            ),
          ).toBe(failure);
          expect(await rowsOf(history)).toStrictEqual(before);
          expect(writes).toBe(1);
        } finally {
          transaction.close();
        }
      },
      2048,
      purgeRow,
    );
  });

  it('compensates candidate persistence after tokenization rejects and preserves its error', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const failure = new Error('tokenization failed');
        history.setTokenizerFactory(
          exactTokenizer(() => {
            throw failure;
          }),
        );
        const writes: IContent[][] = [];
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          persist: async (source) => {
            writes.push(await collect(source));
          },
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          expect(
            await rejectedValue(
              coordinator.commit(transaction, success).then(() => undefined),
            ),
          ).toBe(failure);
          expect(writes).toHaveLength(2);
          expect(writes[1]).toStrictEqual(
            Array.from({ length: 3 }, (_, index) => purgeRow(index)),
          );
        } finally {
          transaction.close();
        }
      },
      2048,
      purgeRow,
    );
  });
});

describe('semantic purge unrestricted row size', () => {
  it('accepts a valid row larger than the fixture budget without truncating it', async () => {
    const bytes = 8 * 1024 * 1024 + 1;
    await withSuffixFixture(
      1,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'summary' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          const rows = await collect(transaction.candidate);
          const text = rows[0].blocks[0];
          if (text.type !== 'text') throw new Error('Expected text');
          expect(text.text.length).toBeGreaterThan(bytes);
          expect(rows[0].blocks[rows[0].blocks.length - 1]).toStrictEqual({
            type: 'text',
            text: 'caption-0',
          });
        } finally {
          transaction.close();
        }
      },
      bytes,
      purgeRow,
    );
  }, 120_000);
});
