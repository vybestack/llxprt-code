/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withRemovalFixture } from './history-removals-test-helpers.js';
import { droppedMediaModelText } from './droppedMediaText.js';
import {
  isMediaDroppedBlock,
  type IContent,
  type MediaDroppedBlock,
  type MediaOrigin,
  type MediaReferenceBlock,
} from './IContent.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';

const READ_AT = '2026-11-19T18:00:00.000Z';
const DROPPED_AT = '2026-11-19T18:30:00.000Z';
const PATH = '/workspace/screens/login.png';

async function image(
  store: LocalMediaStore,
  byte: number,
  origin: MediaOrigin,
): Promise<MediaReferenceBlock> {
  const reference = await store.admit({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  return { ...reference, origin };
}

function rowWith(index: number, block: MediaReferenceBlock): IContent {
  const row = batchRow(index, 64);
  return { ...row, blocks: [...row.blocks, block] };
}

async function rows(
  history: Parameters<Parameters<typeof withRemovalFixture>[0]>[0]['history'],
): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of history.streamRawHistory()) result.push(row);
  return result;
}

function droppedAt(row: IContent): MediaDroppedBlock {
  const block = row.blocks[row.blocks.length - 1];
  if (!isMediaDroppedBlock(block)) throw new Error('expected a dropped block');
  return block;
}

describe('dropping stored media keeps a reference', () => {
  it('stores the file path, releases the blob only after the last row drops it', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const fileOrigin: MediaOrigin = {
        kind: 'file',
        path: PATH,
        readAt: READ_AT,
      };
      const shared = await image(store, 1, fileOrigin);
      const input = [rowWith(0, shared), rowWith(1, shared)];
      await history.detachedValues.append(
        (async function* () {
          yield* input;
        })(),
      );
      await history.settleMediaOwnership();
      const imageIndex = input[0].blocks.length - 1;

      expect(
        await history.dropMedia(
          [{ position: 0, blockIndex: imageIndex }],
          DROPPED_AT,
        ),
      ).toBe(1);
      await history.waitForOwnershipSettlement();
      const afterFirst = await rows(history);
      const expected: MediaDroppedBlock = {
        type: 'media_dropped',
        origin: fileOrigin,
        mimeType: 'image/png',
        byteLength: shared.byteLength,
        contentId: shared.contentId,
        droppedAt: DROPPED_AT,
      };
      expect(droppedAt(afterFirst[0])).toStrictEqual(expected);
      expect(afterFirst[0].blocks.slice(0, -1)).toStrictEqual(
        input[0].blocks.slice(0, -1),
      );
      expect(afterFirst[1]).toStrictEqual(input[1]);
      expect(droppedMediaModelText(expected)).toContain(PATH);
      expect(await store.hasReservations(shared.contentId)).toBe(true);
      expect(await store.readVerified(shared)).toHaveLength(5);

      await history.dropMedia(
        [{ position: 1, blockIndex: imageIndex }],
        DROPPED_AT,
      );
      await history.waitForOwnershipSettlement();
      expect(droppedAt((await rows(history))[1]).origin).toStrictEqual(
        fileOrigin,
      );
      expect(await store.hasReservations(shared.contentId)).toBe(false);
      await store.reclaimUnreferenced(new Set(), 0);
      await expect(store.readVerified(shared)).rejects.toBeInstanceOf(Error);
    });
  }, 60000);

  it('a pasted image retires to a pasted reference with no path', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const pasted = await image(store, 2, { kind: 'pasted', readAt: READ_AT });
      const row = rowWith(0, pasted);
      history.add(row);
      await history.settleMediaOwnership();
      await history.dropMedia(
        [{ position: 0, blockIndex: row.blocks.length - 1 }],
        DROPPED_AT,
      );
      await history.waitForOwnershipSettlement();
      const block = droppedAt((await rows(history))[0]);
      expect(block.origin).toStrictEqual({ kind: 'pasted', readAt: READ_AT });
      expect(droppedMediaModelText(block)).toContain('pasted image');
      expect(await store.hasReservations(pasted.contentId)).toBe(false);
    });
  }, 60000);

  it('addresses a row by the journal label a provider request carries', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const pasted = await image(store, 4, { kind: 'pasted', readAt: READ_AT });
      const input = [rowWith(0, pasted), rowWith(1, pasted)];
      history.add(input[0]);
      history.add(input[1]);
      await history.settleMediaOwnership();
      const request = await history.prepareCuratedForProviderSnapshot();
      const native = request.native;
      if (native === undefined) throw new Error('expected a journal request');
      const labels: bigint[] = [];
      for await (const row of native.indexed.openMediaRows())
        labels.push(row.label);
      await request.close();
      expect(labels).toHaveLength(2);
      const label = labels[1];
      const blockIndex = input[1].blocks.length - 1;

      await history.dropMedia([{ label, blockIndex }], DROPPED_AT);
      await history.waitForOwnershipSettlement();
      const stored = await rows(history);
      expect(stored[0]).toStrictEqual(input[0]);
      expect(droppedAt(stored[1]).contentId).toBe(pasted.contentId);
      await expect(
        history.dropMedia([{ label: label + 1000n, blockIndex }], DROPPED_AT),
      ).rejects.toThrow(`no row labelled ${label + 1000n}`);
      expect(await rows(history)).toStrictEqual(stored);
    });
  }, 60000);

  it('refuses a block that is not stored media and leaves the row unchanged', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const pasted = await image(store, 3, { kind: 'pasted', readAt: READ_AT });
      const row = rowWith(0, pasted);
      history.add(row);
      await history.settleMediaOwnership();
      await expect(
        history.dropMedia([{ position: 0, blockIndex: 0 }], DROPPED_AT),
      ).rejects.toThrow('Only a stored media reference can be dropped');
      await history.waitForOwnershipSettlement();
      expect(await rows(history)).toStrictEqual([row]);
      expect(await store.hasReservations(pasted.contentId)).toBe(true);
    });
  }, 60000);
});
