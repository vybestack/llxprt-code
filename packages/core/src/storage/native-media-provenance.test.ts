/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { HistoryService } from '../services/history/HistoryService.js';
import { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { RequestMediaResolver } from './request-media-resolver.js';
import { useTempDir as tempDirectory } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';

const directory = tempDirectory('native-media-provenance-');

describe('native media reference provenance', () => {
  it('reserves an unowned reference even when its content ID and row metadata match history', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 1024,
    });
    const history = new HistoryService({ backend: 'journal' });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.registerMediaOwner(new HistoryMediaOwnership(store));
    await history.addBatch([
      { speaker: 'human', blocks: [reference], metadata: { id: 'same-row' } },
    ]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const resolver = new RequestMediaResolver(store);
    try {
      const genuine = await source.readAt(0);
      const forged: IContent = { ...genuine, blocks: [{ ...reference }] };
      const resolved = await resolver.resolve({
        contents: [forged],
        requestId: 'unowned',
        turnId: 'tail',
        aggregateBudgetBytes: 1024,
        lease: source.native?.mediaLease,
      });
      try {
        expect(resolved.accounting().reservedContentCount).toBe(1);
        expect(resolved.withContents((rows) => rows[0].blocks)).toContainEqual(
          expect.objectContaining({ encoding: 'base64', data: 'AQID' }),
        );
      } finally {
        await resolved.release();
      }
      const owned = await resolver.resolve({
        contents: [genuine],
        requestId: 'owned',
        turnId: 'history',
        aggregateBudgetBytes: 1024,
        lease: source.native?.mediaLease,
      });
      try {
        expect(owned.accounting().reservedContentCount).toBe(0);
      } finally {
        await owned.release();
      }
    } finally {
      await source.close();
      await history.dispose();
      await store.close();
    }
  });
  it('does not trust a caller-supplied native-history lease stub', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory(), 'fake'),
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    try {
      const resolved = await new RequestMediaResolver(store).resolve({
        contents: [{ speaker: 'human', blocks: [reference] }],
        requestId: 'fake',
        turnId: 'fake',
        aggregateBudgetBytes: 1024,
        lease: {
          origin: 'native-history',
          requireOpen() {},
          withRead: (consume) => consume(),
        },
      });
      try {
        expect(resolved.accounting().reservedContentCount).toBe(1);
      } finally {
        await resolved.release();
      }
    } finally {
      await store.close();
    }
  });
  it('reserves when a genuine snapshot reference is presented to another runtime store', async () => {
    const left = new LocalMediaStore({
      rootDirectory: join(directory(), 'left'),
      quotaBytes: 1024,
    });
    const right = new LocalMediaStore({
      rootDirectory: join(directory(), 'right'),
      quotaBytes: 1024,
    });
    const input = {
      bytes: new Uint8Array([7, 8, 9]),
      mimeType: 'image/png',
      semanticMetadata: {},
    };
    const reference = await left.admit(input);
    await right.admit(input);
    const history = new HistoryService({ backend: 'journal' });
    await history.registerMediaOwner(new HistoryMediaOwnership(left));
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      const resolved = await new RequestMediaResolver(right).resolve({
        contents: [await source.readAt(0)],
        requestId: 'other-store',
        turnId: 'other',
        aggregateBudgetBytes: 1024,
        lease: source.native?.mediaLease,
      });
      try {
        expect(resolved.accounting().reservedContentCount).toBe(1);
      } finally {
        await resolved.release();
      }
    } finally {
      await source.close();
      await history.dispose();
      await left.close();
      await right.close();
    }
  });
});
