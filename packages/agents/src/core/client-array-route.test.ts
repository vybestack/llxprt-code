/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  expectedRange,
  mediaParticipant,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import {
  clientArrayRows,
  clientRows,
  forbidClientArrayRollback,
  recordClientProof,
  withArrayClient,
  withClientOracle,
} from './client-array-test-helpers.js';

function registerScale(size: number): void {
  describe('registerScale', () => {
    it(`publishes every original full ${size} media/tool row without either legacy array engine`, async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client, store }) => {
          const { history, recorder, owners } = fixture;
          const rows = clientArrayRows(size);
          const original = await detachedDigest(clientRows(rows));
          forbidClientArrayRollback(fixture);
          history.setBaseTokenOffset(17);
          history.setCacheAnchorSeq(1);
          const order: string[] = [];
          history.registerMediaOwner(
            mediaParticipant(() => {
              order.push('prepare');
              return {
                publish: () => {
                  order.push('publish');
                },
                finalize: () => {
                  order.push('finalize');
                },
                rollback: () => {
                  order.push('rollback');
                },
              };
            }),
          );
          history.on('contentBatchAdded', (published) => {
            order.push('batch');
            expect(published.length).toBe(size);
          });
          history.on('tokensUpdated', () => {
            order.push('tokens');
          });
          history.on('contextRangeChanged', () => {
            order.push('range');
          });
          const expected = await withClientOracle(store, rows, (admitted) =>
            detachedDigest(clientRows(admitted)),
          );
          expect(await client.restoreHistory(rows)).toBeUndefined();
          const live = await detachedDigest(history.streamRawHistory());
          expect(live).toStrictEqual(expected);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          expect(rows).toStrictEqual(clientArrayRows(size));
          expect(history.getTotalTokens()).toBe(size * 4 + 17);
          expect(history.getContextRange()).toStrictEqual(expectedRange(size));
          expect(history.getCacheAnchorSeq()).toBe(0);
          expect(order).toStrictEqual([
            'prepare',
            'publish',
            'batch',
            'tokens',
            'finalize',
            'range',
          ]);
          expect(owners.snapshot().liveRows).toBe(0);
          recordClientProof({
            kind: 'route',
            size,
            original,
            expected,
            live,
            order,
          });
        }),
      );
    }, 180_000);
  });
}
function registerFrozenAliases(): void {
  describe('registerFrozenAliases', () => {
    it('preserves frozen stamped marker values and repeated aliases without requiring post-ack identity', async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client }) => {
          forbidClientArrayRollback(fixture);
          const source = clientArrayRows(1)[0];
          const row: IContent = {
            ...source,
            speaker: 'ai',
            metadata: {
              ...source.metadata,
              model: 'original-model',
              providerBaseURL: 'https://original-provider.test',
            },
          };
          Object.freeze(row.metadata?.chronology);
          Object.freeze(row.metadata);
          Object.freeze(row);
          await client.restoreHistory([row, row]);
          const cursor = fixture.history.streamRawHistory();
          try {
            const first = await cursor.next();
            const second = await cursor.next();
            if (first.done === true || second.done === true)
              throw new Error('Lost repeated alias');
            expect(first.value.metadata?.chronology).toStrictEqual(
              row.metadata?.chronology,
            );
            expect(second.value.metadata?.chronology).toStrictEqual(
              row.metadata?.chronology,
            );
            expect(first.value.metadata?.chronology).not.toBe(
              row.metadata?.chronology,
            );
            expect(first.value.metadata?.model).toBe('original-model');
            expect(second.value.metadata?.providerBaseURL).toBe(
              'https://original-provider.test',
            );
            expect((await cursor.next()).done).toBe(true);
          } finally {
            await cursor.return();
          }
        }),
      );
    });
  });
}
function registerLargeRow(): void {
  describe('registerLargeRow', () => {
    it('does not truncate a valid nine MiB original row', async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client, store }) => {
          const rows = clientArrayRows(1, 9 * 1024 * 1024);
          forbidClientArrayRollback(fixture);
          const expected = await withClientOracle(store, rows, (admitted) =>
            detachedDigest(clientRows(admitted)),
          );
          await client.restoreHistory(rows);
          expect(
            await detachedDigest(fixture.history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            expected,
          );
          expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
        }),
      );
    }, 180_000);
  });
}
function registerFreshValues(): void {
  describe('registerFreshValues', () => {
    it('leaves empty restore as a no-op and fresh AI values unstamped with a model', async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client }) => {
          forbidClientArrayRollback(fixture);
          const row: IContent = {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'restored model provenance' }],
          };
          Object.freeze(row.blocks);
          Object.freeze(row);
          await client.restoreHistory([row]);
          const before = await detachedDigest(
            fixture.history.streamRawHistory(),
          );
          await client.restoreHistory([]);
          expect(
            await detachedDigest(fixture.history.streamRawHistory()),
          ).toStrictEqual(before);
          const cursor = fixture.history.streamRawHistory();
          try {
            const first = await cursor.next();
            if (first.done === true) throw new Error('Missing restored row');
            expect(first.value.metadata?.model).toBeUndefined();
            expect(first.value.metadata?.chronology?.seq).toBe(1);
            expect(row).not.toHaveProperty('metadata');
          } finally {
            await cursor.return();
          }
        }),
      );
    });
  });
}
describe('AgentClient admitted array restore scoped values', () => {
  for (const size of [512, 8192]) registerScale(size);
  registerFrozenAliases();
  registerLargeRow();
  registerFreshValues();
});
