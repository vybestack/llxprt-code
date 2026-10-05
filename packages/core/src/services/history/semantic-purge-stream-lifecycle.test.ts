/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-helpers.js';
import type { IContent } from './IContent.js';
import { RowOwnership } from '../../recording/rowOwnership.js';

function imageRow(index: number, bytes: number): IContent {
  const row = ownerFixtureRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media' ? { ...block, mimeType: 'image/png' } : block,
    ),
  };
}

describe('stream purge transaction lifecycle', () => {
  it('exposes read-only frozen views without disk writer methods', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          expect(Reflect.has(transaction.candidate, 'append')).toBe(false);
          expect(Object.isFrozen(transaction.base)).toBe(true);
          expect(Object.isFrozen(transaction.candidate)).toBe(true);
        } finally {
          transaction.close();
        }
      },
      2048,
      imageRow,
    );
  });

  it('cancels one cursor and leaves an independent repeated traversal intact', async () => {
    const owners = new RowOwnership();
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          ownership: owners,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          const controller = new AbortController();
          const failure = new Error('cancel cursor');
          const cursor = transaction.base
            .streamRows(controller.signal)
            [Symbol.asyncIterator]();
          expect((await cursor.next()).done).toBe(false);
          controller.abort(failure);
          await expect(cursor.next()).rejects.toBe(failure);
          let count = 0;
          for await (const row of transaction.base.streamRows()) {
            expect(row).toStrictEqual(imageRow(count++, 2048));
          }
          expect(count).toBe(3);
        } finally {
          transaction.close();
        }
        expect(owners.snapshot().liveRows).toBe(0);
      },
      2048,
      imageRow,
      owners,
    );
  });
});

async function verifyCacheRequest(
  transaction: Awaited<
    ReturnType<SemanticMediaPurgeStreamCoordinator['begin']>
  >,
): Promise<void> {
  if (transaction?.preImageBoundaryIdentity === undefined)
    throw new Error('Missing transaction boundary');
  let tagged = 0;
  for await (const row of transaction.requestRows(true)) {
    const tag = row.metadata?.semanticMediaPurgeBoundary;
    if (tag === undefined) continue;
    expect(tag.boundaryId).toBe(transaction.preImageBoundaryIdentity);
    expect(tag.blockIndex).toBe(2);
    expect(row.blocks[3].type).toBe('media');
    tagged++;
  }
  expect(tagged).toBe(1);
}

describe('semantic purge request and abort lifecycle', () => {
  it('keeps the exact boundary identity on every cache request traversal without altering base rows', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing transaction');
        try {
          for (let traversal = 0; traversal < 2; traversal++)
            await verifyCacheRequest(transaction);
          for await (const row of transaction.base.streamRows())
            expect(row.metadata?.semanticMediaPurgeBoundary).toBeUndefined();
        } finally {
          transaction.close();
        }
      },
      2048,
      imageRow,
    );
  });

  it('rejects a pre-aborted begin without acquiring cursor owners', async () => {
    const owners = new RowOwnership();
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          ownership: owners,
        });
        const controller = new AbortController();
        const failure = new Error('cancel begin');
        controller.abort(failure);
        await expect(
          coordinator.begin({ mode: 'remove' }, controller.signal),
        ).rejects.toBe(failure);
        expect(owners.snapshot().acquisitions).toBe(0);
      },
      2048,
      imageRow,
      owners,
    );
  });
});
