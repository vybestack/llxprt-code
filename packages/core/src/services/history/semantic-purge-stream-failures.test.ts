/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import { rowsOf, exactTokenizer } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import { withPurgeFailureFixture } from './__tests__/support/purge-failure-fixture.js';

function image(id: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: id },
      {
        type: 'media',
        encoding: 'base64',
        data: 'aW1hZ2U=',
        mimeType: 'image/png',
        sourceContentId: `image-${id}`,
      },
    ],
    metadata: { id },
  };
}
const success = { status: 'success', cachePrefixWritten: true } as const;

describe.each(['old', 'journal'] as const)(
  'semantic purge failures on %s',
  (backend) => {
    describe('semantic purge durable rollback and rebase', () => {
      it('persists the candidate in the actual journal and restores the complete previous recording on rollback', async () => {
        await withPurgeFailureFixture(
          backend,
          async (history, persistedRows) => {
            await history.addBatch([image('first'), image('second')]);
            await history.waitForCommit();
            const before = await rowsOf(history);
            const coordinator = new SemanticMediaPurgeStreamCoordinator(
              history,
              {
                enabled: true,
                explicitCacheWriteRequired: false,
              },
            );
            const transaction = await coordinator.begin({ mode: 'remove' });
            if (transaction === undefined)
              throw new Error('Missing transaction');
            try {
              await coordinator.commit(transaction, success);
              await history.waitForCommit();
              const saved = await persistedRows();
              expect(saved[0].blocks).toStrictEqual([
                { type: 'text', text: 'first' },
              ]);
              expect(
                saved[0].metadata?.semanticMediaPurgeFrontier,
              ).toStrictEqual(transaction.nextFrontier);
              await coordinator.rollback(transaction);
              await history.waitForCommit();
              expect(await persistedRows()).toStrictEqual(before);
            } finally {
              transaction.close();
            }
          },
        );
      });

      it('rebases stable media identity across removed rows and blocks instead of purging an earlier new image', async () => {
        await withPurgeFailureFixture(backend, async (history) => {
          await history.addBatch([image('first'), image('second')]);
          await history.waitForCommit();
          const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
            enabled: true,
            explicitCacheWriteRequired: false,
          });
          const first = await coordinator.begin({ mode: 'remove' });
          if (first === undefined) throw new Error('Missing first transaction');
          await coordinator.commit(first, success);
          const frontier = first.nextFrontier;
          first.close();
          const second = image('second');
          await history.replaceBatch([
            {
              ...image('introduced'),
              metadata: {
                id: 'introduced',
                semanticMediaPurgeFrontier: frontier,
              },
            },
            { ...second, blocks: second.blocks.slice(1) },
          ]);
          const transaction = await coordinator.begin({ mode: 'remove' });
          if (transaction === undefined)
            throw new Error('Missing rebased transaction');
          try {
            expect(transaction.changedContentIndex).toBe(1);
            expect(transaction.changedBlockIndex).toBe(0);
            const candidate: IContent[] = [];
            for await (const row of transaction.candidate.streamRows())
              candidate.push(row);
            expect(candidate).toHaveLength(1);
            expect(candidate[0].blocks[1].type).toBe('media');
          } finally {
            transaction.close();
          }
        });
      });
    });

    describe('semantic purge cancellation and compensation errors', () => {
      it('compensates durable callback state when cancellation happens during persistence', async () => {
        await withPurgeFailureFixture(backend, async (history) => {
          const input = [image('first')];
          await history.addBatch(input);
          await history.waitForCommit();
          const before = structuredClone(input);
          const controller = new AbortController();
          const failure = new Error('cancel persistence');
          let writes = 0;
          const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
            enabled: true,
            explicitCacheWriteRequired: false,
            persist: async () => {
              if (++writes === 1) controller.abort(failure);
            },
          });
          const transaction = await coordinator.begin({ mode: 'remove' });
          if (transaction === undefined) throw new Error('Missing transaction');
          try {
            await expect(
              coordinator.commit(transaction, success, controller.signal),
            ).rejects.toBe(failure);
            expect(writes).toBe(2);
            expect(await rowsOf(history)).toMatchObject(before);
          } finally {
            transaction.close();
          }
        });
      });

      it('reports both tokenization and durable compensation errors in their original order', async () => {
        await withPurgeFailureFixture(backend, async (history) => {
          await history.addBatch([image('first')]);
          await history.waitForCommit();
          const primary = new Error('tokenizer');
          const compensation = new Error('compensation');
          let writes = 0;
          const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
            enabled: true,
            explicitCacheWriteRequired: false,
            persist: async () => {
              if (++writes > 1) throw compensation;
            },
          });
          const transaction = await coordinator.begin({ mode: 'remove' });
          if (transaction === undefined) throw new Error('Missing transaction');
          history.setTokenizerFactory(
            exactTokenizer(() => {
              throw primary;
            }),
          );
          try {
            const result: unknown = await coordinator
              .commit(transaction, success)
              .catch((error: unknown) => error);
            if (!(result instanceof AggregateError))
              throw new Error('Missing aggregate error');
            expect(result.errors).toStrictEqual([primary, compensation]);
            expect(writes).toBe(2);
          } finally {
            transaction.close();
          }
        });
      });
    });
  },
);
