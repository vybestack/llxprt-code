/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativePurgeFixture } from './__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import type { IContent } from './IContent.js';

async function collect(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

describe('native semantic purge durable callback compensation', () => {
  it('restores the candidate callback state when rollback media publication fails', async () => {
    await withNativePurgeFixture(
      async ({ history, store, owner, assertDurable }) => {
        const image = await store.admit({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await history.addBatch([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'before image' }, image],
          },
        ]);
        let persisted: IContent[] = [];
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          persist: async (source) => {
            persisted = await collect(source.streamRows());
          },
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined)
          throw new Error('Missing compensated transaction');
        try {
          expect(
            await coordinator.commit(transaction, {
              status: 'success',
              cachePrefixWritten: true,
            }),
          ).toBe(true);
          const candidate = await collect(history.streamRawHistory());
          expect(persisted).toStrictEqual(candidate);
          owner.rejectPublication = true;
          await expect(coordinator.rollback(transaction)).rejects.toBe(
            owner.failure,
          );
          expect(persisted).toStrictEqual(candidate);
          expect(await collect(history.streamRawHistory())).toStrictEqual(
            candidate,
          );
          await assertDurable(candidate);
        } finally {
          await transaction.close();
        }
      },
    );
  });
});
