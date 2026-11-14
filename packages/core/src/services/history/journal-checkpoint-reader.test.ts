/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { checkpointRows } from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `checkpoint ${index}` }],
  };
}

describe('native checkpoint reader scope', () => {
  it('counts a suspended row and retires an abandoned reader before releasing its checkpoint pin', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      history.add(row(0));
      history.add(row(1));
      await history.waitForCommit();
      let reader: AsyncIterator<IContent> | undefined;
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        reader = checkpointRows(checkpoint);
        expect((await reader.next()).value).toStrictEqual(
          expect.objectContaining({ blocks: row(0).blocks }),
        );
        expect(owners.snapshot().liveRows).toBe(1);
      });
      expect(owners.snapshot().liveRows).toBe(0);
      if (reader === undefined) throw new Error('Missing admitted reader');
      await expect(reader.next()).rejects.toThrow('closed');
    });
  });

  it('consumes counted rows after its opener is disposed while the checkpoint still owns its pin', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      history.add(row(0));
      history.add(row(1));
      await history.waitForCommit();
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        await history.dispose();
        const values: Array<IContent['blocks']> = [];
        for await (const content of checkpoint) {
          expect(owners.snapshot().liveRows).toBe(1);
          values.push(content.blocks);
        }
        expect(values).toStrictEqual([row(0).blocks, row(1).blocks]);
        expect(owners.snapshot().liveRows).toBe(0);
      });
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('keeps the exact cancellation reason and releases the suspended row', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      history.add(row(0));
      history.add(row(1));
      await history.waitForCommit();
      const abort = new AbortController();
      const reason = new Error('cancel checkpoint reader');
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        const reader = checkpointRows(checkpoint);
        expect((await reader.next()).done).toBe(false);
        expect(owners.snapshot().liveRows).toBe(1);
        abort.abort(reason);
        await expect(reader.next()).rejects.toBe(reason);
        expect(owners.snapshot().liveRows).toBe(0);
      }, abort.signal);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
